import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { applyFavorite, describeUri, KeyringConnectionStore, MAX_FAVORITES_PER_CONNECTION } from '../server/connectionStore';
import { UserFacingError } from '../server/errors';

const tmpDirs: string[] = [];
after(() => Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

describe('favorites', () => {
  const users = { db: 'shop', collection: 'users' };
  const orders = { db: 'shop', collection: 'orders' };

  it('adds idempotently, keeps order, and removes', () => {
    let favs = applyFavorite([], users, true);
    favs = applyFavorite(favs, orders, true);
    favs = applyFavorite(favs, users, true);
    assert.deepEqual(favs, [orders, users]);
    assert.deepEqual(applyFavorite(favs, orders, false), [users]);
    assert.deepEqual(applyFavorite([], orders, false), []);
  });

  it('enforces the per-connection cap', () => {
    const full = Array.from({ length: MAX_FAVORITES_PER_CONNECTION }, (_, i) => ({ db: 'd', collection: `c${i}` }));
    assert.throws(() => applyFavorite(full, users, true), UserFacingError);
  });

  it('loads files from older versions and persists favorites', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aye-aye-store-'));
    tmpDirs.push(dir);
    const id = '72806508-1d03-4930-b86f-b45c0210d979';
    // Written by an older version: no favorites yet, plus a setting that no longer exists.
    await fs.writeFile(
      path.join(dir, 'connections.json'),
      JSON.stringify([{ id, name: 'dev', hosts: ['h:1'], createdAt: '2026-11-06T00:00:00Z', allowWrites: true }]),
    );
    const store = new KeyringConnectionStore(dir);
    const [legacy] = await store.list();
    assert.ok(legacy && !('allowWrites' in legacy), 'settings from older versions are dropped');
    assert.deepEqual(legacy?.favorites, []);

    await store.setFavorite(id, users, true);
    assert.deepEqual((await new KeyringConnectionStore(dir).get(id))?.favorites, [users]);
    await store.setFavorite(id, users, false);
    assert.deepEqual((await store.get(id))?.favorites, []);
    await assert.rejects(store.setFavorite('00000000-0000-4000-8000-000000000000', users, true), /not found/);
  });
});

describe('describeUri', () => {
  it('extracts credential-free hosts and the default database', () => {
    const info = describeUri('mongodb://user:pass@10.0.0.1:27017,10.0.0.2:27018/appdb?authSource=admin');
    assert.deepEqual(info.hosts, ['10.0.0.1:27017', '10.0.0.2:27018']);
    assert.equal(info.defaultDatabase, 'appdb');
    assert.ok(!JSON.stringify(info).includes('pass'));
  });

  it('treats a URI without a path as having no default database', () => {
    assert.equal(describeUri('mongodb://user:pass@localhost:27017/?authSource=admin').defaultDatabase, undefined);
    assert.equal(describeUri('mongodb://localhost:27017').defaultDatabase, undefined);
  });

  it('supports mongodb+srv without resolving DNS', () => {
    assert.deepEqual(describeUri('mongodb+srv://u:p@cluster0.example.mongodb.net/db').hosts, ['cluster0.example.mongodb.net']);
  });

  it('rejects other schemes and malformed strings without echoing them', () => {
    assert.throws(() => describeUri('postgres://u:secret@x'), UserFacingError);
    assert.throws(
      () => describeUri('mongodb://u:secret@'),
      (e: unknown) => e instanceof UserFacingError && !e.message.includes('secret'),
    );
  });
});

describe('clientAppName', () => {
  it('identifies the person and machine, sanitized', async () => {
    const { clientAppName } = await import('../server/config');
    assert.equal(
      clientAppName('jane.doe', 'LAPTOP-42'),
      'Aye-aye (local MongoDB query tool) jane.doe@LAPTOP-42',
    );
    assert.equal(clientAppName('evil"; drop', 'host name\n'), 'Aye-aye (local MongoDB query tool) evildrop@hostname');
    assert.equal(clientAppName('', ''), 'Aye-aye (local MongoDB query tool) unknown@unknown');
  });

  it('stays within MongoDB\'s 128-byte limit', async () => {
    const { clientAppName } = await import('../server/config');
    assert.ok(Buffer.byteLength(clientAppName('u'.repeat(500), 'h'.repeat(500))) <= 128);
    assert.ok(Buffer.byteLength(clientAppName()) <= 128);
  });
});
