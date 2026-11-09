import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp, type MongoReader, type Writer } from '../server/app';
import { redactSecrets } from '../server/errors';
import { TOKEN_HEADER } from '../server/security';
import { MemoryStore } from './helpers';

const TOKEN = 'test-token';
const SECRET_URI = 'mongodb://admin:s3cr3t@db.example.com:27017/app';

const unusedMongo: MongoReader = {
  listDatabases: async () => [],
  listCollections: async () => [],
  sampleFields: async () => [],
  find: async () => ({ docs: [], hasMore: false }),
  count: async () => ({ count: 0, estimated: true }),
  disconnect: async () => undefined,
};

const unusedWrites: Writer = {
  insertDocument: async () => ({ backupId: '', id: '' }),
  replaceDocument: async () => ({ changes: [] }),
  deleteDocument: async () => ({ backupId: '' }),
  undo: async () => ({ summary: '' }),
  runCommand: async () => ({ kind: 'value', method: 'countDocuments', tree: { t: 'null' }, text: '' }),
};

describe('API security', () => {
  let server: Server;
  let port: number;
  const store = new MemoryStore();
  let verifyShouldFail = false;

  before(async () => {
    // Port is only known after listen, so build the app lazily on the first request.
    let app: ReturnType<typeof createApp> | undefined;
    const { createServer } = await import('node:http');
    server = createServer((req, res) => {
      app ??= createApp({
        port,
        token: TOKEN,
        isProd: true,
        store,
        mongo: unusedMongo,
        writes: unusedWrites,
        verifyUri: async () => {
          if (verifyShouldFail) throw new Error(`failed to connect to ${SECRET_URI}`);
        },
        log: () => undefined,
      });
      app(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, init);

  it('rejects requests without the session token', async () => {
    assert.equal((await call('/api/connections')).status, 401);
    assert.equal((await call('/api/connections', { headers: { [TOKEN_HEADER]: 'wrong' } })).status, 401);
    assert.equal((await call('/api/connections', { headers: { [TOKEN_HEADER]: TOKEN } })).status, 200);
  });

  it('rejects cross-origin requests even with a token', async () => {
    const res = await call('/api/connections', { headers: { [TOKEN_HEADER]: TOKEN, origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/connections', headers: { host: `evil.example:${port}`, [TOKEN_HEADER]: TOKEN } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });

  it('never returns the connection string, even on failure', async () => {
    const headers = { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' };

    const created = await call('/api/connections', { method: 'POST', headers, body: JSON.stringify({ name: 'dev', uri: SECRET_URI }) });
    assert.equal(created.status, 201);
    const createdBody = await created.text();
    assert.ok(!createdBody.includes('s3cr3t'));

    const listed = await (await call('/api/connections', { headers })).text();
    assert.ok(!listed.includes('s3cr3t') && !listed.includes('mongodb://'));

    verifyShouldFail = true;
    const failed = await call('/api/connections', { method: 'POST', headers, body: JSON.stringify({ name: 'x', uri: SECRET_URI }) });
    assert.equal(failed.status, 400);
    assert.ok(!(await failed.text()).includes('s3cr3t'));
    verifyShouldFail = false;
  });

  it('validates input', async () => {
    const headers = { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' };
    const badScheme = await call('/api/connections', { method: 'POST', headers, body: JSON.stringify({ name: 'x', uri: 'http://x' }) });
    assert.equal(badScheme.status, 400);
    const badId = await call('/api/connections/not-a-uuid/databases', { headers });
    assert.equal(badId.status, 400);
  });

  it('stars and unstars collections, validating names', async () => {
    const headers = { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' };
    const { id } = await store.add('fav', 'mongodb://localhost');
    const put = (body: unknown) => call(`/api/connections/${id}/favorites`, { method: 'PUT', headers, body: JSON.stringify(body) });

    const starred = await put({ db: 'shop', collection: 'users', favorite: true });
    assert.equal(starred.status, 200);
    assert.deepEqual((await starred.json()).favorites, [{ db: 'shop', collection: 'users' }]);

    const unstarred = await put({ db: 'shop', collection: 'users', favorite: false });
    assert.deepEqual((await unstarred.json()).favorites, []);

    assert.equal((await put({ db: 'bad/name', collection: 'users', favorite: true })).status, 400);
    assert.equal((await put({ db: 'ok', collection: 'has$dollar', favorite: true })).status, 400);
    assert.equal((await put({ db: 'ok', collection: 'users', favorite: true, extra: 1 })).status, 400);
  });

  it('sets a strict content security policy', async () => {
    const res = await call('/api/connections', { headers: { [TOKEN_HEADER]: TOKEN } });
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

describe('redactSecrets', () => {
  it('removes connection strings from messages', () => {
    assert.equal(redactSecrets(`cannot reach ${SECRET_URI} now`), 'cannot reach mongodb://<redacted> now');
    assert.equal(redactSecrets('mongodb+srv://u:p@c.mongodb.net/db?x=1'), 'mongodb://<redacted>');
  });
});
