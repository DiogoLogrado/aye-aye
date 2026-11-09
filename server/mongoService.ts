import { MongoClient, MongoServerError, type Collection, type Document, type MongoClientOptions, type Sort } from 'mongodb';
import { QUERY_LIMITS, clientAppName } from './config';
import { describeUri, type ConnectionStore } from './connectionStore';
import { UserFacingError } from './errors';
import { collectFields, type FieldInfo } from './query';
import { TtlCache } from './ttlCache';

/**
 * Kept deliberately light so Aye-aye never weighs on a database other apps depend on:
 * few connections, idle sockets closed, and every read capped by maxTimeMS (see QUERY_LIMITS).
 * `appName` shows who runs this (user@machine) in db.currentOp(), the server logs and the profiler.
 */
const CLIENT_OPTIONS: MongoClientOptions = {
  appName: clientAppName(),
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
  maxPoolSize: 5,
  maxIdleTimeMS: 60_000,
};

/** Field samples are only for autocomplete; reuse them instead of re-sampling on every tab. */
const FIELD_CACHE_TTL_MS = 5 * 60_000;
const FIELD_CACHE_MAX_ENTRIES = 200;

export interface CountResult {
  count: number;
  /** True when taken from collection metadata (no filter): instant, but may be slightly off. */
  estimated: boolean;
}

const UNAUTHORIZED = 13;

export interface FindParams {
  filter: Document;
  /** Omitted: natural order (as a raw find(...) without .sort() would run). */
  sort?: Sort;
  projection?: Document;
  limit: number;
  skip: number;
}

export interface FindResult {
  docs: Document[];
  hasMore: boolean;
}

export interface CollectionInfo {
  name: string;
  type: string;
}

/**
 * Read access layer: listing, sampling and find.
 * All writes go through WriteService, which enforces the safety rules (permission switch,
 * concurrency checks, backups before every write).
 */
export class MongoService {
  private readonly clients = new Map<string, Promise<MongoClient>>();
  private readonly fieldCache = new TtlCache<FieldInfo[]>(FIELD_CACHE_TTL_MS, FIELD_CACHE_MAX_ENTRIES);

  constructor(private readonly store: ConnectionStore) {}

  /** Connects with a throwaway client to verify a connection string before saving it. */
  static async verify(uri: string): Promise<void> {
    const client = new MongoClient(uri, CLIENT_OPTIONS);
    try {
      await client.connect();
      await client.db('admin').command({ ping: 1 });
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async listDatabases(connectionId: string): Promise<string[]> {
    const client = await this.client(connectionId);
    try {
      const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
      return databases.map((d) => d.name).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      // Users scoped to a single database may not be allowed to list databases.
      if (error instanceof MongoServerError && error.code === UNAUTHORIZED) {
        const { defaultDatabase } = describeUri(await this.store.getUri(connectionId));
        if (defaultDatabase) return [defaultDatabase];
      }
      throw error;
    }
  }

  async listCollections(connectionId: string, db: string): Promise<CollectionInfo[]> {
    const client = await this.client(connectionId);
    const collections = await client
      .db(db)
      .listCollections({}, { nameOnly: true, authorizedCollections: true })
      .toArray();
    return collections
      .map((c) => ({ name: c.name, type: c.type ?? 'collection' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async sampleFields(connectionId: string, db: string, collection: string): Promise<FieldInfo[]> {
    const key = `${connectionId}/${db}/${collection}`;
    const cached = this.fieldCache.get(key);
    if (cached) return cached;

    const client = await this.client(connectionId);
    const docs = await client
      .db(db)
      .collection(collection)
      .aggregate([{ $sample: { size: QUERY_LIMITS.sampleSize } }], { maxTimeMS: QUERY_LIMITS.maxTimeMS })
      .toArray();
    const fields = collectFields(docs);
    this.fieldCache.set(key, fields);
    return fields;
  }

  /**
   * Without a filter, uses collection metadata (instant, no scan). With a filter, runs an
   * exact count, bounded by maxTimeMS. Only called on demand, never automatically for filters.
   */
  async count(connectionId: string, db: string, collection: string, filter: Document): Promise<CountResult> {
    const coll = (await this.client(connectionId)).db(db).collection(collection);
    const maxTimeMS = QUERY_LIMITS.maxTimeMS;
    if (Object.keys(filter).length === 0) {
      return { count: await coll.estimatedDocumentCount({ maxTimeMS }), estimated: true };
    }
    return { count: await coll.countDocuments(filter, { maxTimeMS }), estimated: false };
  }

  async find(connectionId: string, db: string, collection: string, params: FindParams): Promise<FindResult> {
    const client = await this.client(connectionId);
    // Fetch one extra document to know whether a next page exists without a costly count.
    const docs = await client
      .db(db)
      .collection(collection)
      .find(params.filter, {
        ...(params.sort ? { sort: params.sort } : {}),
        ...(params.projection ? { projection: params.projection } : {}),
        skip: params.skip,
        limit: params.limit + 1,
        maxTimeMS: QUERY_LIMITS.maxTimeMS,
      })
      .toArray();
    return { docs: docs.slice(0, params.limit), hasMore: docs.length > params.limit };
  }

  /** Raw collection handle, for the WriteService (which owns all write safety checks). */
  async collection(connectionId: string, db: string, collection: string): Promise<Collection> {
    return (await this.client(connectionId)).db(db).collection(collection);
  }

  async disconnect(connectionId: string): Promise<void> {
    const pending = this.clients.get(connectionId);
    this.clients.delete(connectionId);
    this.fieldCache.deletePrefix(`${connectionId}/`);
    if (pending) await (await pending.catch(() => undefined))?.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.disconnect(id)));
  }

  private client(connectionId: string): Promise<MongoClient> {
    const cached = this.clients.get(connectionId);
    if (cached) return cached;

    const pending = (async () => {
      if (!(await this.store.get(connectionId))) {
        throw new UserFacingError('Connection not found', 404);
      }
      return new MongoClient(await this.store.getUri(connectionId), CLIENT_OPTIONS).connect();
    })();
    this.clients.set(connectionId, pending);
    // Don't cache failures; the next request retries.
    pending.catch(() => this.clients.delete(connectionId));
    return pending;
  }
}
