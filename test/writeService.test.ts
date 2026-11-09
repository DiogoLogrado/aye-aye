import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { ObjectId, type Document } from 'mongodb';
import { BackupStore } from '../server/backupStore';
import { encodeId, documentVersion } from '../server/query';
import { WriteService, diffDocuments, type CommandResponse, type Target } from '../server/writeService';
import { FakeCollection, MemoryStore } from './helpers';

const tmpDirs: string[] = [];
after(() => Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

async function setup(docs: Document[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aye-aye-test-'));
  tmpDirs.push(dir);
  const store = new MemoryStore();
  const meta = await store.add('dev', 'mongodb://localhost');
  const coll = new FakeCollection(docs);
  const backups = new BackupStore(dir);
  const service = new WriteService(async () => coll.asCollection(), store, backups);
  const target: Target = { connectionId: meta.id, db: 'app', collection: 'users' };
  return { service, coll, store, target, dir, backups };
}

const user = (name: string, category = 'old') => ({ _id: new ObjectId(), name, category });
const ref = (doc: Document) => ({ id: encodeId(doc._id), version: documentVersion(doc) });

describe('WriteService: reads', () => {
  it('runs read commands without a confirmation step and without writing', async () => {
    const { service, coll, target } = await setup([user('a')]);
    const read = await service.runCommand(target, 'db.users.countDocuments({})');
    assert.equal(read.kind, 'value');
    assert.deepEqual(coll.log, []);
  });
});

describe('WriteService: edit document', () => {
  let doc: Document;
  beforeEach(() => {
    doc = { _id: new ObjectId(), name: 'Ada', profile: { lang: 'pt' }, roles: ['a'] };
  });

  it('previews a field-level diff without writing', async () => {
    const { service, coll, target } = await setup([doc]);
    const { changes } = await service.replaceDocument(target, {
      ...ref(doc),
      document: '{ name: "Ada L", profile: { lang: "en" }, roles: ["a"], extra: 1 }',
      dryRun: true,
    });
    assert.deepEqual(
      changes.map((c) => `${c.kind}:${c.path}`),
      ['changed:name', 'changed:profile.lang', 'added:extra'],
    );
    assert.deepEqual(coll.log, []);
  });

  it('saves after backing up, and undo restores the previous version', async () => {
    const { service, coll, target, backups } = await setup([doc]);
    const { backupId } = await service.replaceDocument(target, { ...ref(doc), document: '{ name: "New" }', dryRun: false });
    assert.ok(backupId);
    assert.equal(coll.docs[0]?.name, 'New');
    assert.equal(coll.docs[0]?.profile, undefined);
    assert.equal((await backups.get(backupId)).before[0]?.name, 'Ada');

    await service.undo(backupId);
    assert.equal(coll.docs[0]?.name, 'Ada');
    assert.deepEqual(coll.docs[0]?.profile, { lang: 'pt' });
    await assert.rejects(service.undo(backupId), /already undone/);
  });

  it('refuses to overwrite a document that changed since it was loaded', async () => {
    const { service, coll, target } = await setup([doc]);
    const stale = ref(doc);
    coll.docs[0]!.name = 'changed by someone else';
    await assert.rejects(service.replaceDocument(target, { ...stale, document: '{ name: "x" }', dryRun: false }), /changed since/);
    assert.equal(coll.docs[0]?.name, 'changed by someone else');
  });

  it('refuses to change the _id', async () => {
    const { service, target } = await setup([doc]);
    await assert.rejects(
      service.replaceDocument(target, { ...ref(doc), document: `{ _id: ObjectId("${new ObjectId().toHexString()}") }`, dryRun: true }),
      /_id cannot be changed/,
    );
  });
});

describe('WriteService: insert document', () => {
  it('inserts with a generated _id and undo removes exactly that document', async () => {
    const existing = user('existing');
    const { service, coll, target } = await setup([existing]);
    const { backupId } = await service.insertDocument(target, { document: '{ name: "new", age: 3 }' });
    assert.equal(coll.docs.length, 2);
    assert.ok(coll.docs[1]?._id instanceof ObjectId);
    await service.undo(backupId);
    assert.deepEqual(coll.docs.map((d) => d.name), ['existing']);
  });

  it('refuses empty documents, $ fields and invalid syntax', async () => {
    const { service, target } = await setup([]);
    await assert.rejects(service.insertDocument(target, { document: '{}' }), /empty/);
    await assert.rejects(service.insertDocument(target, { document: '{ $set: { a: 1 } }' }), /cannot start with/);
    await assert.rejects(service.insertDocument(target, { document: '{ a: ' }), /not valid/);
  });

  it('never creates an undo record that would delete a pre-existing document', async () => {
    const existing = user('existing');
    const { service, coll, target, dir } = await setup([existing]);
    await assert.rejects(
      service.insertDocument(target, { document: `{ _id: ObjectId("${existing._id.toHexString()}"), name: "clash" }` }),
      /already exists/,
    );
    assert.deepEqual(await fs.readdir(dir), [], 'no backup file may be left behind');
    assert.equal(coll.docs.length, 1);
  });

  it('after a partial insertMany failure, undo only removes what was really inserted', async () => {
    const { service, coll, target, dir } = await setup([]);
    const command = 'db.users.insertMany([{ _id: 1, n: "a" }, { _id: 2, n: "b" }, { _id: 3, n: "c" }])';
    const preview = await service.runCommand(target, command);
    assert.equal(preview.kind, 'confirm');
    // Someone inserts _id 2 between the preview and the execution.
    coll.docs.push({ _id: 2, n: 'someone else' });
    const token = (preview as Extract<CommandResponse, { kind: 'confirm' }>).confirmToken;
    await assert.rejects(service.runCommand(target, command, token), /already exists/);
    assert.equal(coll.docs.length, 1, 'the clash check stops the whole insert');

    // Simulate a clash the pre-check can't see (inserted after the check, mid-batch).
    const original = coll.findOne.bind(coll);
    coll.findOne = async () => null;
    await assert.rejects(service.runCommand(target, command, token), /duplicate/);
    coll.findOne = original;
    const inserted = coll.docs.filter((d) => d.n !== 'someone else').map((d) => d._id);
    assert.deepEqual(inserted, [1]);

    // The failed command's backup must list only _id 1; undoing it must leave "someone else" alone.
    const files = await fs.readdir(dir);
    assert.equal(files.length, 1);
    await service.undo(files[0]!.replace(/\.json$/, ''));
    assert.deepEqual(coll.docs, [{ _id: 2, n: 'someone else' }]);
  });
});

describe('WriteService: delete document', () => {
  it('deletes exactly one document and undo brings it back', async () => {
    const a = user('a');
    const b = user('b');
    const { service, coll, target } = await setup([a, b]);
    const { backupId } = await service.deleteDocument(target, ref(a));
    assert.deepEqual(coll.docs.map((d) => d.name), ['b']);
    await service.undo(backupId);
    assert.deepEqual(coll.docs.map((d) => d.name).sort(), ['a', 'b']);
  });
});

describe('WriteService: commands', () => {
  const confirmOf = (r: CommandResponse) => {
    assert.equal(r.kind, 'confirm');
    return r as Extract<CommandResponse, { kind: 'confirm' }>;
  };

  it('previews bulk updates and only executes with the matching confirmation token', async () => {
    const { service, coll, target } = await setup([user('a'), user('b'), user('c', 'other')]);
    const command = 'db.users.updateMany({ category: "old" }, { $set: { category: "new" } })';

    const preview = confirmOf(await service.runCommand(target, command));
    assert.equal(preview.affected, 2);
    assert.equal(preview.requireTyping, true);
    assert.deepEqual(coll.log, [], 'preview must not write');

    assert.equal((await service.runCommand(target, command, 'forged-token')).kind, 'confirm');
    assert.deepEqual(coll.log, []);

    const done = await service.runCommand(target, command, preview.confirmToken);
    assert.equal(done.kind, 'written');
    assert.deepEqual(coll.docs.map((d) => d.category), ['new', 'new', 'other']);
  });

  it('a token for one command cannot confirm a different command', async () => {
    const { service, coll, target } = await setup([user('a')]);
    const preview = confirmOf(await service.runCommand(target, 'db.users.updateMany({ name: "a" }, { $set: { x: 1 } })'));
    const other = await service.runCommand(target, 'db.users.updateMany({}, { $set: { x: 2 } })', preview.confirmToken);
    assert.equal(other.kind, 'confirm');
    assert.deepEqual(coll.log, []);
  });

  it('warns loudly when there is no filter', async () => {
    const { service, target } = await setup([user('a')]);
    const preview = confirmOf(await service.runCommand(target, 'db.users.updateMany({}, { $set: { x: 1 } })'));
    assert.ok(preview.warnings.some((w) => w.includes('EVERY document')));
  });

  it('bulk writes only touch the documents that were backed up, and undo restores them', async () => {
    const { service, coll, target } = await setup([user('a'), user('b')]);
    const command = 'db.users.updateMany({ category: "old" }, { $set: { category: "new" } })';
    const preview = confirmOf(await service.runCommand(target, command));
    const done = await service.runCommand(target, command, preview.confirmToken);
    assert.equal(done.kind, 'written');
    const backupId = (done as Extract<CommandResponse, { kind: 'written' }>).backupId!;
    await service.undo(backupId);
    assert.deepEqual(coll.docs.map((d) => d.category), ['old', 'old']);
  });

  it('insertMany can be undone by removing exactly the inserted documents', async () => {
    const { service, coll, target } = await setup([user('existing')]);
    const command = 'db.users.insertMany([{ name: "t1" }, { name: "t2" }])';
    const preview = confirmOf(await service.runCommand(target, command));
    const done = (await service.runCommand(target, command, preview.confirmToken)) as Extract<CommandResponse, { kind: 'written' }>;
    assert.equal(coll.docs.length, 3);
    await service.undo(done.backupId!);
    assert.deepEqual(coll.docs.map((d) => d.name), ['existing']);
  });

  it('refuses commands aimed at another collection than the open tab', async () => {
    const { service, target } = await setup([]);
    await assert.rejects(service.runCommand(target, 'db.orders.find({})'), /this tab is "users"/);
  });

  it('runs reads immediately without confirmation', async () => {
    const { service, target } = await setup([user('a'), user('b')]);
    const result = await service.runCommand(target, 'db.users.find({ name: "a" })');
    assert.equal(result.kind, 'documents');
  });
});

describe('diffDocuments', () => {
  it('reports removed fields', () => {
    assert.deepEqual(diffDocuments({ a: 1, b: 2 }, { a: 1 }), [{ path: 'b', kind: 'removed', before: '2' }]);
  });
});
