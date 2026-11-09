import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp, type MongoReader, type Writer } from '../server/app';
import type { FindParams } from '../server/mongoService';
import { TOKEN_HEADER } from '../server/security';
import { MemoryStore } from './helpers';

const TOKEN = 'find-route-token';

describe('find route with a Raw command', () => {
  let server: http.Server;
  let base: string;
  let lastFind: FindParams | undefined;
  let lastCountFilter: unknown;
  const connectionId = '72806508-1d03-4930-b86f-b45c0210d979';

  const mongo: MongoReader = {
    listDatabases: async () => [],
    listCollections: async () => [],
    sampleFields: async () => [],
    find: async (_id, _db, _coll, params) => {
      lastFind = params;
      return { docs: [], hasMore: false };
    },
    count: async (_id, _db, _coll, filter) => {
      lastCountFilter = filter;
      return { count: 0, estimated: false };
    },
    disconnect: async () => undefined,
  };
  const writes = {} as Writer;

  before(async () => {
    let app: ReturnType<typeof createApp> | undefined;
    server = http.createServer((req, res) => {
      const port = (server.address() as AddressInfo).port;
      app ??= createApp({ port, token: TOKEN, isProd: true, store: new MemoryStore(), mongo, writes, verifyUri: async () => {}, log: () => {} });
      app(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/connections/${connectionId}/databases/app/collections/users`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('runs the command\'s filter, sort, projection and limit, adding the paging offset to .skip()', async () => {
    const res = await post('find', {
      command: 'db.getCollection("users")\n  .find({ name: "Ada" })\n  .projection({ name: 1 })\n  .sort({ createdAt: -1 })\n  .skip(10)\n  .limit(5)',
      skip: 5,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).limit, 5);
    assert.deepEqual(lastFind, { filter: { name: 'Ada' }, projection: { name: 1 }, sort: { createdAt: -1 }, limit: 5, skip: 15 });
  });

  it('uses natural order and the default page size when the command has no .sort()/.limit()', async () => {
    await post('find', { command: 'db.users.find()', skip: 0 });
    assert.equal(lastFind?.sort, undefined);
    assert.equal(lastFind?.limit, 20);
  });

  it('refuses other collections and non-find commands', async () => {
    const other = await post('find', { command: 'db.orders.find({})', skip: 0 });
    assert.equal(other.status, 400);
    assert.match((await other.json()).error, /this tab is "users"/);
    const write = await post('find', { command: 'db.users.deleteMany({ a: 1 })', skip: 0 });
    assert.equal(write.status, 400);
  });

  it('counts using the command\'s filter', async () => {
    const res = await post('count', { command: 'db.users.find({ enabled: true }).limit(5)' });
    assert.equal(res.status, 200);
    assert.deepEqual(lastCountFilter, { enabled: true });
  });

  it('still accepts the Builder\'s structured query', async () => {
    const res = await post('find', { filter: '{ a: 1 }', sort: { field: 'createdAt', direction: -1 }, limit: 50, skip: 0 });
    assert.equal(res.status, 200);
    assert.deepEqual(lastFind, { filter: { a: 1 }, sort: { createdAt: -1, _id: -1 }, limit: 50, skip: 0 });
  });
});
