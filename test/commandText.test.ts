import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFindCommand, isBareFilter, isFindCommand, isWriteCommand } from '../client/commandText';
import { parseCommand, toFindQuery } from '../server/command';

describe('buildFindCommand', () => {
  it('produces a command the server parses back to the same query', () => {
    const text = buildFindCommand('users', '{ "name": { "$regex": "ada", "$options": "i" } }', { field: 'createdAt', direction: -1 }, 20, true);
    assert.equal(
      text,
      'db.getCollection("users")\n  .find({ "name": { "$regex": "ada", "$options": "i" } })\n  .sort({ createdAt: -1, _id: -1 })\n  .limit(20)',
    );
    assert.deepEqual(toFindQuery(parseCommand(text)), {
      filter: { name: { $regex: 'ada', $options: 'i' } },
      projection: undefined,
      sort: { createdAt: -1, _id: -1 },
      limit: 20,
      skip: 0,
    });
  });

  it('handles _id sorts, odd field names, empty filters and single-line output', () => {
    assert.equal(buildFindCommand('users', '', { field: '_id', direction: -1 }, 50, false), 'db.getCollection("users").find({}).sort({ _id: -1 }).limit(50)');
    const dotted = buildFindCommand('my-coll', '{}', { field: 'a.b', direction: 1 }, 20, false);
    assert.equal(dotted, 'db.getCollection("my-coll").find({}).sort({ "a.b": 1, _id: 1 }).limit(20)');
    assert.equal(toFindQuery(parseCommand(dotted)).sort?.['a.b'], 1);
  });
});

describe('command detection', () => {
  it('recognizes find commands in all notations', () => {
    assert.ok(isFindCommand('db.users.find({})'));
    assert.ok(isFindCommand('  db.getCollection("users")\n  .find({ a: 1 })\n  .limit(5)'));
    assert.ok(isFindCommand("db['users'].find()"));
    assert.ok(!isFindCommand('db.users.findOne({})'));
    assert.ok(!isFindCommand('db.users.updateMany({}, { $set: { find: 1 } })'));
  });

  it('recognizes write commands', () => {
    assert.ok(isWriteCommand('db.users.updateMany({ a: 1 }, { $set: { b: 2 } })'));
    assert.ok(isWriteCommand('db.getCollection("users").deleteOne({ _id: 1 })'));
    assert.ok(!isWriteCommand('db.users.find({ updateMany: 1 })'));
  });

  it('recognizes bare filters', () => {
    assert.ok(isBareFilter('  { name: "x" }'));
    assert.ok(!isBareFilter('db.users.find({})'));
  });
});
