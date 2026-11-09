import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { DEFAULT_FIND_LIMIT, looksLikeCommand, parseCommand, toFindQuery } from '../server/command';
import { UserFacingError } from '../server/errors';

describe('parseCommand', () => {
  it('parses the three collection notations', () => {
    for (const text of [
      'db.users.find({ name: "x" })',
      'db.getCollection("users").find({ name: "x" })',
      "db['users'].find({ name: 'x' });",
    ]) {
      const cmd = parseCommand(text);
      assert.equal(cmd.collection, 'users', text);
      assert.equal(cmd.method, 'find');
      assert.deepEqual(cmd.args, [{ name: 'x' }]);
      assert.equal(cmd.isWrite, false);
    }
  });

  it('parses a typical migration with shell types', () => {
    const cmd = parseCommand(`
      db.users.updateMany(
        { category: "old", company: ObjectId("650a1b2c3d4e5f6071829304") },
        { $set: { category: "new", migratedAt: ISODate("2026-11-06") } }
      )`);
    assert.equal(cmd.method, 'updateMany');
    assert.equal(cmd.isWrite, true);
    const [filter, update] = cmd.args as [Record<string, unknown>, { $set: Record<string, unknown> }];
    assert.ok(filter.company instanceof ObjectId);
    assert.ok(update.$set.migratedAt instanceof Date);
  });

  it('handles parentheses inside strings and regexes', () => {
    const cmd = parseCommand('db.logs.find({ msg: "a (b) c", re: /x\\(y\\)[)]/i })');
    assert.equal(cmd.method, 'find');
    assert.equal((cmd.args[0] as { msg: string }).msg, 'a (b) c');
  });

  it('accepts update pipelines and $rename', () => {
    assert.equal(parseCommand('db.u.updateMany({}, [{ $set: { b: "$a" } }])').method, 'updateMany');
    assert.equal(parseCommand('db.u.updateMany({ a: { $exists: true } }, { $rename: { a: "b" } })').method, 'updateMany');
  });

  it('refuses destructive and unknown methods', () => {
    assert.throws(() => parseCommand('db.users.drop()'), /not allowed/);
    assert.throws(() => parseCommand('db.dropDatabase()'), UserFacingError);
    assert.throws(() => parseCommand('db.users.renameCollection("x")'), /not allowed/);
    assert.throws(() => parseCommand('db.users.deleteMany({})'), /every document/);
    assert.throws(() => parseCommand('db.users.createIndex({ a: 1 })'), /Unsupported method/);
  });

  it('refuses aggregation stages that write', () => {
    assert.throws(() => parseCommand('db.users.aggregate([{ $match: {} }, { $out: "copy" }])'), /\$out/);
    assert.throws(() => parseCommand('db.users.aggregate([{ $merge: { into: "x" } }])'), /\$merge/);
  });

  it('refuses server-side JavaScript and code execution', () => {
    assert.throws(() => parseCommand('db.users.find({ $where: "1" })'), /\$where/);
    assert.throws(() => parseCommand('db.users.find(process.exit(1))'), UserFacingError);
    assert.throws(() => parseCommand('db.users.find({ a: (() => 1)() })'), UserFacingError);
  });

  it('parses the exact multi-line command the Builder hands to Raw', () => {
    const cmd = parseCommand(`db.getCollection("users")
  .find({ "name": { "$regex": "ada", "$options": "i" } })
  .sort({ createdAt: -1, _id: -1 })
  .limit(20)`);
    assert.deepEqual(toFindQuery(cmd), {
      filter: { name: { $regex: 'ada', $options: 'i' } },
      projection: undefined,
      sort: { createdAt: -1, _id: -1 },
      limit: 20,
      skip: 0,
    });
  });

  it('supports skip, projection, and ignores pretty()/toArray()', () => {
    const cmd = parseCommand('db.users.find({}).projection({ name: 1 }).skip(40).limit(10).pretty()');
    assert.deepEqual(toFindQuery(cmd), { filter: {}, projection: { name: 1 }, sort: undefined, limit: 10, skip: 40 });
    assert.equal(toFindQuery(parseCommand('db.users.find()')).limit, DEFAULT_FIND_LIMIT);
  });

  it('validates cursor calls', () => {
    assert.throws(() => parseCommand('db.users.find({}).sort({ a: "asc" })'), /1 \(ascending\) or -1/);
    assert.throws(() => parseCommand('db.users.find({}).limit(0)'), /between 1 and 200/);
    assert.throws(() => parseCommand('db.users.find({}).limit(5000)'), /between 1 and 200/);
    assert.throws(() => parseCommand('db.users.find({}).skip(-1)'), /whole number/);
    assert.throws(() => parseCommand('db.users.find({}).limit(5).limit(6)'), /appears twice/);
    assert.throws(() => parseCommand('db.users.find({}).count()'), /not supported after find/);
    assert.throws(() => toFindQuery(parseCommand('db.users.find({}, { a: 1 }).projection({ b: 1 })')), /not both/);
    assert.throws(() => parseCommand('db.users.find({}).sort({ a: 1 }) extra'), /Unexpected text/);
  });

  it('only allows cursor chains after find, and refuses malformed input', () => {
    assert.throws(() => parseCommand('db.users.updateMany({}, { $set: { a: 1 } }).limit(1)'), /can only follow find/);
    assert.throws(() => parseCommand('db.users.find({ a: 1 }'), /Unbalanced/);
    assert.throws(() => parseCommand('users.find({})'), /must look like/);
  });

  it('validates update documents', () => {
    assert.throws(() => parseCommand('db.u.updateOne({ _id: 1 }, { name: "x" })'), /operators like/);
    assert.throws(() => parseCommand('db.u.replaceOne({ _id: 1 }, { $set: { a: 1 } })'), /cannot contain \$/);
    assert.throws(() => parseCommand('db.u.updateOne({}, { $set: { a: 1 } }, { writeConcern: {} })'), /unsupported option/);
  });

  it('detects command text', () => {
    assert.ok(looksLikeCommand('  db.users.find()'));
    assert.ok(looksLikeCommand('db["users"].find()'));
    assert.ok(!looksLikeCommand('{ name: "db.users" }'));
  });
});
