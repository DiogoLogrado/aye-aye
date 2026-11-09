import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { MongoError, MongoNetworkError, MongoServerError, MongoServerSelectionError } from 'mongodb';
import { z } from 'zod';
import { QUERY_LIMITS } from './config';
import type { ConnectionMeta, ConnectionStore } from './connectionStore';
import { describeUri } from './connectionStore';
import { UserFacingError, redactSecrets } from './errors';
import { parseCommand, toFindQuery, type FindQuery } from './command';
import type { FindParams, MongoService } from './mongoService';
import { buildSort, formatDocument, parseUserFilter } from './query';
import { contentSecurityPolicy, hostGuard, originGuard, tokenGuard } from './security';
import type { WriteService } from './writeService';

export type MongoReader = Pick<
  MongoService,
  'listDatabases' | 'listCollections' | 'sampleFields' | 'find' | 'count' | 'disconnect'
>;
export type Writer = Pick<WriteService, 'insertDocument' | 'replaceDocument' | 'deleteDocument' | 'undo' | 'runCommand'>;

export interface AppOptions {
  port: number;
  token: string;
  isProd: boolean;
  store: ConnectionStore;
  mongo: MongoReader;
  writes: Writer;
  verifyUri: (uri: string) => Promise<void>;
  log?: (message: string) => void;
}

const connectionId = z.uuid({ message: 'Invalid connection id' });
// Mirrors MongoDB's own naming restrictions.
const databaseName = z.string().min(1).max(63).regex(/^[^/\\. "$*<>:|?\0]+$/, 'Invalid database name');
const collectionName = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('\0') && !s.includes('$'), 'Invalid collection name');

const addConnectionBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60),
    uri: z.string().trim().min(1, 'Connection string is required').max(4096),
  })
  .strict();

const findBody = z
  .object({
    filter: z.string().max(QUERY_LIMITS.maxFilterLength).default(''),
    sort: z.object({
      field: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/, 'Invalid sort field'),
      direction: z.union([z.literal(1), z.literal(-1)]),
    }),
    limit: z.number().int().min(1).max(QUERY_LIMITS.maxLimit),
    skip: z.number().int().min(0).max(QUERY_LIMITS.maxSkip),
  })
  .strict();

/** Raw mode: a full db.collection.find(...).sort(...).limit(...) command; `skip` is the paging offset. */
const findCommandBody = z
  .object({
    command: z.string().min(1).max(100_000),
    skip: z.number().int().min(0).max(QUERY_LIMITS.maxSkip),
  })
  .strict();

const documentRef = {
  id: z.string().min(1).max(10_000),
  version: z.string().min(1).max(100),
};

const replaceBody = z
  .object({ ...documentRef, document: z.string().min(1).max(5_000_000), dryRun: z.boolean() })
  .strict();

const deleteBody = z.object(documentRef).strict();

const insertBody = z.object({ document: z.string().min(1).max(5_000_000) }).strict();

const countBody = z.union([
  z.object({ filter: z.string().max(QUERY_LIMITS.maxFilterLength).default('') }).strict(),
  z.object({ command: z.string().min(1).max(100_000) }).strict(),
]);

/** Parses a Raw find command and checks it targets this tab's collection. */
function findQueryFor(commandText: string, collection: string): FindQuery {
  const command = parseCommand(commandText);
  if (command.method !== 'find') {
    throw new UserFacingError(`Expected a find(...) command here, got ${command.method}(...)`);
  }
  if (command.collection !== collection) {
    throw new UserFacingError(
      `This command targets "${command.collection}" but this tab is "${collection}". Open that collection to run it.`,
    );
  }
  return toFindQuery(command);
}

const commandBody = z
  .object({ command: z.string().min(1).max(100_000), confirmToken: z.string().max(100).optional() })
  .strict();

const setFavoriteBody = z.object({ db: databaseName, collection: collectionName, favorite: z.boolean() }).strict();

const toPublic = ({ id, name, hosts, favorites }: ConnectionMeta) => ({ id, name, hosts, favorites });

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function apiRouter(options: AppOptions): express.Router {
  const { store, mongo, writes, verifyUri } = options;
  const router = express.Router();

  const target = (params: Record<string, string>) => ({
    id: connectionId.parse(params.id),
    db: databaseName.parse(params.db),
    collection: params.coll === undefined ? '' : collectionName.parse(params.coll),
  });

  router.get('/connections', async (_req, res) => {
    res.json((await store.list()).map(toPublic));
  });

  router.post('/connections', async (req, res) => {
    const { name, uri } = addConnectionBody.parse(req.body);
    describeUri(uri);
    try {
      await verifyUri(uri);
    } catch (error) {
      throw new UserFacingError(`Could not connect: ${describeMongoError(error)}`);
    }
    res.status(201).json(toPublic(await store.add(name, uri)));
  });

  router.delete('/connections/:id', async (req, res) => {
    const id = connectionId.parse(req.params.id);
    await mongo.disconnect(id);
    await store.remove(id);
    res.status(204).end();
  });

  router.put('/connections/:id/favorites', async (req, res) => {
    const id = connectionId.parse(req.params.id);
    const { db, collection, favorite } = setFavoriteBody.parse(req.body);
    res.json(toPublic(await store.setFavorite(id, { db, collection }, favorite)));
  });

  router.get('/connections/:id/databases', async (req, res) => {
    res.json(await mongo.listDatabases(connectionId.parse(req.params.id)));
  });

  router.get('/connections/:id/databases/:db/collections', async (req, res) => {
    const { id, db } = target(req.params);
    res.json(await mongo.listCollections(id, db));
  });

  router.get('/connections/:id/databases/:db/collections/:coll/fields', async (req, res) => {
    const { id, db, collection } = target(req.params);
    res.json(await mongo.sampleFields(id, db, collection));
  });

  router.post('/connections/:id/databases/:db/collections/:coll/find', async (req, res) => {
    const { id, db, collection } = target(req.params);
    const started = performance.now();
    let params: FindParams;
    if (req.body && typeof req.body === 'object' && 'command' in req.body) {
      const body = findCommandBody.parse(req.body);
      const query = findQueryFor(body.command, collection);
      params = { ...query, skip: query.skip + body.skip };
    } else {
      const body = findBody.parse(req.body);
      params = {
        filter: parseUserFilter(body.filter),
        sort: buildSort(body.sort.field, body.sort.direction),
        limit: body.limit,
        skip: body.skip,
      };
    }
    const result = await mongo.find(id, db, collection, params);
    res.json({
      docs: result.docs.map(formatDocument),
      hasMore: result.hasMore,
      limit: params.limit,
      durationMs: Math.round(performance.now() - started),
    });
  });

  router.post('/connections/:id/databases/:db/collections/:coll/count', async (req, res) => {
    const { id, db, collection } = target(req.params);
    const body = countBody.parse(req.body);
    const filter = 'command' in body ? findQueryFor(body.command, collection).filter : parseUserFilter(body.filter);
    const started = performance.now();
    const result = await mongo.count(id, db, collection, filter);
    res.json({ ...result, durationMs: Math.round(performance.now() - started) });
  });

  router.post('/connections/:id/databases/:db/collections/:coll/documents/insert', async (req, res) => {
    const { id, db, collection } = target(req.params);
    const body = insertBody.parse(req.body);
    res.status(201).json(await writes.insertDocument({ connectionId: id, db, collection }, body));
  });

  router.post('/connections/:id/databases/:db/collections/:coll/documents/replace', async (req, res) => {
    const { id, db, collection } = target(req.params);
    const body = replaceBody.parse(req.body);
    res.json(await writes.replaceDocument({ connectionId: id, db, collection }, body));
  });

  router.post('/connections/:id/databases/:db/collections/:coll/documents/delete', async (req, res) => {
    const { id, db, collection } = target(req.params);
    const body = deleteBody.parse(req.body);
    res.json(await writes.deleteDocument({ connectionId: id, db, collection }, body));
  });

  router.post('/connections/:id/databases/:db/collections/:coll/command', async (req, res) => {
    const { id, db, collection } = target(req.params);
    const body = commandBody.parse(req.body);
    const started = performance.now();
    const result = await writes.runCommand({ connectionId: id, db, collection }, body.command, body.confirmToken);
    res.json({ ...result, durationMs: Math.round(performance.now() - started) });
  });

  router.post('/backups/:backupId/undo', async (req, res) => {
    const backupId = z.string().max(40).parse(req.params.backupId);
    res.json(await writes.undo(backupId));
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return router;
}

function describeMongoError(error: unknown): string {
  if (error instanceof MongoServerSelectionError || error instanceof MongoNetworkError) {
    return 'server unreachable. Check host, port and VPN/IP allowlist. If other tools connect but this does not, add &directConnection=true to the connection string.';
  }
  if (error instanceof MongoError) return redactSecrets(error.message);
  return 'unknown error';
}

function errorHandler(log: (message: string) => void): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    if (error instanceof UserFacingError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    if (error instanceof MongoServerError || error instanceof MongoServerSelectionError || error instanceof MongoNetworkError) {
      res.status(502).json({ error: describeMongoError(error) });
      return;
    }
    log(`Unhandled error: ${redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error))}`);
    res.status(500).json({ error: 'Internal error' });
  };
}

/** Builds the app with security guards and the API. The caller mounts the client UI afterwards. */
export function createApp(options: AppOptions): Express {
  const log = options.log ?? ((m: string) => console.error(m));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(hostGuard(options.port));
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: contentSecurityPolicy(options.isProd, options.port) },
      strictTransportSecurity: false, // plain http on loopback
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    '/api',
    noStore,
    originGuard(options.port),
    tokenGuard(options.token),
    express.json({ limit: '100kb' }),
    apiRouter(options),
    errorHandler(log),
  );

  return app;
}
