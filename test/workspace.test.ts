import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  buildWorkspace,
  cleanTabState,
  createWorkspaceSaver,
  defaultTabState,
  restoreWorkspace,
  rowsFromState,
  type TabState,
  type Workspace,
} from '../client/workspace';
import { createApp, type MongoReader, type Writer } from '../server/app';
import { TOKEN_HEADER } from '../server/security';
import { FileWorkspaceStore } from '../server/workspaceStore';
import { MemoryStore } from './helpers';

const CONN_A = '72806508-1d03-4930-b86f-b45c0210d979';
const CONN_B = '0b5c3f8e-2a41-4c47-9d0e-6c1f3a2b4d5e';

const state = (overrides: Partial<TabState> = {}): TabState => ({ ...defaultTabState(), ...overrides });
const workspaceOf = (tabs: Workspace['tabs'], activeIndex = 0): Workspace => ({ version: 1, tabs, activeIndex });
const tab = (connectionId: string, collection: string, s: TabState = state()) => ({
  connectionId,
  db: 'shop',
  collection,
  state: s,
});

describe('cleanTabState', () => {
  it('keeps a valid state as it is', () => {
    const valid = state({
      mode: 'raw',
      rows: [{ join: 'or', field: 'address.city', op: 'contains', value: 'Paris' }],
      raw: 'db.orders.find({})',
      rawEdited: true,
      sortId: 'oldest',
      limit: 50,
    });
    assert.deepEqual(cleanTabState(valid), valid);
  });

  it('turns anything malformed into safe defaults instead of failing', () => {
    for (const input of [null, undefined, 42, 'text', [], { rows: 'nope', limit: -3, mode: 'other' }]) {
      const s = cleanTabState(input);
      assert.equal(s.mode, 'builder');
      assert.deepEqual(s.rows, []);
      assert.equal(s.limit, 20);
      assert.equal(s.sortId, 'newest');
    }
    const s = cleanTabState({ rows: [null, { join: 'xor', op: 'drop', field: 7, value: {} }], limit: 2.5 });
    assert.deepEqual(s.rows, [
      { join: 'and', field: '', op: 'eq', value: '' },
      { join: 'and', field: '', op: 'eq', value: '' },
    ]);
    assert.equal(s.limit, 20);
  });

  it('cuts oversized text and row lists', () => {
    const s = cleanTabState({ raw: 'x'.repeat(200_000), rows: Array.from({ length: 80 }, () => ({})) });
    assert.equal(s.raw.length, 100_000);
    assert.equal(s.rows.length, 50);
  });
});

describe('rowsFromState', () => {
  it('gives every row a fresh id, and an empty row when there are none', () => {
    const rows = rowsFromState(state({ rows: [{ join: 'and', field: 'name', op: 'eq', value: 'Ada' }] }));
    assert.equal(rows.length, 1);
    assert.match(rows[0]?.id ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(rows[0]?.field, 'name');
    const empty = rowsFromState(state());
    assert.equal(empty.length, 1);
    assert.equal(empty[0]?.field, '');
  });
});

describe('buildWorkspace', () => {
  it('saves tabs in order, with their latest query and the active index', () => {
    const tabs = [
      { key: 'k1', connectionId: CONN_A, db: 'shop', collection: 'orders' },
      { key: 'k2', connectionId: CONN_A, db: 'shop', collection: 'orders', initial: state({ raw: 'restored' }) },
      { key: 'k3', connectionId: CONN_B, db: 'logs', collection: 'events' },
    ];
    const states = new Map([['k1', state({ limit: 100 })]]);
    const w = buildWorkspace(tabs, 'k3', states);
    assert.equal(w.activeIndex, 2);
    assert.deepEqual(
      w.tabs.map((t) => [t.collection, t.state.limit, t.state.raw]),
      [
        ['orders', 100, ''],
        ['orders', 20, 'restored'],
        ['events', 20, ''],
      ],
    );
  });

  it('caps the number of saved tabs and tolerates no active tab', () => {
    const tabs = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, connectionId: CONN_A, db: 'shop', collection: `c${i}` }));
    const w = buildWorkspace(tabs, null, new Map());
    assert.equal(w.tabs.length, 50);
    assert.equal(w.activeIndex, 0);
  });
});

describe('restoreWorkspace', () => {
  it('drops tabs of deleted connections and keeps the active tab when it survives', () => {
    const w = workspaceOf([tab(CONN_B, 'gone'), tab(CONN_A, 'orders'), tab(CONN_A, 'users')], 2);
    const restored = restoreWorkspace(w, new Set([CONN_A]));
    assert.deepEqual(
      restored.tabs.map((t) => t.collection),
      ['orders', 'users'],
    );
    assert.equal(restored.activeIndex, 1);
  });

  it('falls back to the nearest earlier tab when the active one was dropped', () => {
    const w = workspaceOf([tab(CONN_A, 'orders'), tab(CONN_B, 'gone'), tab(CONN_A, 'users')], 1);
    assert.equal(restoreWorkspace(w, new Set([CONN_A])).activeIndex, 0);
  });

  it('copes with nothing saved, junk entries and an out-of-range active index', () => {
    assert.deepEqual(restoreWorkspace(null, new Set([CONN_A])), { tabs: [], activeIndex: 0 });
    assert.deepEqual(restoreWorkspace(undefined, new Set()), { tabs: [], activeIndex: 0 });
    const junk = {
      version: 1,
      activeIndex: 99,
      tabs: [null, { connectionId: CONN_A, db: '', collection: 'x' }, tab(CONN_A, 'orders')],
    } as unknown as Workspace;
    const restored = restoreWorkspace(junk, new Set([CONN_A]));
    assert.deepEqual(
      restored.tabs.map((t) => t.collection),
      ['orders'],
    );
    assert.equal(restored.activeIndex, 0);
  });
});

describe('createWorkspaceSaver', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("doesn't save before it's enabled, then saves once per change after a short delay", async () => {
    let current = workspaceOf([tab(CONN_A, 'orders')]);
    const saved: Workspace[] = [];
    const saver = createWorkspaceSaver(
      () => current,
      async (w) => {
        saved.push(w);
      },
      10,
    );
    saver.schedule();
    await saver.flush();
    assert.equal(saved.length, 0, 'disabled until the saved workspace was read');

    saver.enable();
    saver.schedule();
    saver.schedule();
    await wait(40);
    assert.equal(saved.length, 1, 'quick changes are coalesced');

    await saver.flush();
    assert.equal(saved.length, 1, 'unchanged: no save');

    current = workspaceOf([tab(CONN_A, 'users')]);
    await saver.flush();
    assert.equal(saved.length, 2);
  });

  it('retries after a failed save', async () => {
    let fail = true;
    let attempts = 0;
    const saver = createWorkspaceSaver(
      () => workspaceOf([]),
      async () => {
        attempts++;
        if (fail) throw new Error('offline');
      },
      10,
    );
    saver.enable();
    await saver.flush();
    fail = false;
    await saver.flush();
    assert.equal(attempts, 2);
  });
});

describe('workspace API', () => {
  const TOKEN = 'workspace-token';
  let server: http.Server;
  let base: string;
  let dataDir: string;

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aye-aye-workspace-'));
    const workspace = new FileWorkspaceStore(dataDir, () => {});
    let app: ReturnType<typeof createApp> | undefined;
    server = http.createServer((req, res) => {
      const port = (server.address() as AddressInfo).port;
      app ??= createApp({
        port,
        token: TOKEN,
        isProd: true,
        store: new MemoryStore(),
        mongo: {} as MongoReader,
        writes: {} as Writer,
        workspace,
        verifyUri: async () => {},
        log: () => {},
      });
      app(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspace`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const get = () => fetch(base, { headers: { [TOKEN_HEADER]: TOKEN } });
  const put = (body: unknown) =>
    fetch(base, {
      method: 'PUT',
      headers: { [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns null when nothing is saved, then what was saved', async () => {
    assert.deepEqual(await (await get()).json(), { workspace: null });
    const w = workspaceOf([tab(CONN_A, 'orders', state({ raw: 'db.orders.find({})', rawEdited: true }))]);
    assert.equal((await put(w)).status, 204);
    assert.deepEqual(await (await get()).json(), { workspace: w });
  });

  it('accepts long Raw commands beyond the general 100 kB body limit', async () => {
    const big = 'x'.repeat(90_000);
    const w = workspaceOf([tab(CONN_A, 'a', state({ raw: big })), tab(CONN_A, 'b', state({ raw: big }))]);
    assert.equal((await put(w)).status, 204);
  });

  it('refuses invalid workspaces and requests without the session token', async () => {
    assert.equal((await put({ version: 2, tabs: [], activeIndex: 0 })).status, 400);
    assert.equal((await put(workspaceOf([{ ...tab('not-a-uuid', 'orders') }]))).status, 400);
    assert.equal((await put({ ...workspaceOf([]), extra: true })).status, 400);
    assert.equal((await fetch(base)).status, 401);
  });

  it('moves an unreadable file aside and starts fresh instead of failing', async () => {
    await fs.writeFile(path.join(dataDir, 'workspace.json'), '{ not json');
    assert.deepEqual(await (await get()).json(), { workspace: null });
    assert.equal(await fs.readFile(path.join(dataDir, 'workspace.unreadable.json'), 'utf8'), '{ not json');
    assert.equal((await put(workspaceOf([]))).status, 204);
    assert.deepEqual(await (await get()).json(), { workspace: workspaceOf([]) });
  });
});
