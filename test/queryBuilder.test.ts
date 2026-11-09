import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BSON, ObjectId } from 'mongodb';
import { buildFilter, mixesJoins, toLiteral, type FilterRow, type Join } from '../client/queryBuilder';
import { parseUserFilter } from '../server/query';

let seq = 0;
const row = (field: string, op: FilterRow['op'], value = '', join: Join = 'and'): FilterRow => ({
  id: String(seq++),
  join,
  field,
  op,
  value,
});
const or = (field: string, op: FilterRow['op'], value = '') => row(field, op, value, 'or');

describe('toLiteral', () => {
  it('uses sampled field types as hints', () => {
    assert.equal(toLiteral('123', ['string']), '"123"');
    assert.equal(toLiteral('123', ['number']), '123');
    assert.equal(toLiteral('64b7f0c2a1d3e4f5a6b7c8d9', ['objectId']), 'ObjectId("64b7f0c2a1d3e4f5a6b7c8d9")');
    assert.equal(toLiteral('2024-05-01', ['date']), 'ISODate("2024-05-01")');
  });

  it('infers types when there are no hints, and quotes force a string', () => {
    assert.equal(toLiteral('true'), 'true');
    assert.equal(toLiteral('42'), '42');
    assert.equal(toLiteral('"42"'), '"42"');
    assert.equal(toLiteral('null'), 'null');
    assert.equal(toLiteral('Ada Lovelace'), '"Ada Lovelace"');
  });
});

describe('buildFilter', () => {
  it('returns {} when no row is complete', () => {
    assert.equal(buildFilter([row('', 'eq', 'x'), row('name', 'eq', '')]), '{}');
  });

  it('builds a case-insensitive, regex-escaped contains', () => {
    const filter = parseUserFilter(buildFilter([row('email', 'contains', 'a.b+c@x')]));
    assert.deepEqual(Object.keys(filter), ['email']);
    const { $regex: pattern, $options: options } = filter.email as { $regex: string; $options: string };
    assert.equal(options, 'i');
    assert.equal(pattern, 'a\\.b\\+c@x');
    assert.ok(new RegExp(pattern, options).test('A.B+C@X.com'));
    assert.ok(!new RegExp(pattern, options).test('aXb+c@x'));
    assert.doesNotThrow(() => BSON.serialize(filter));
  });

  it('merges "and" rows into one object', () => {
    const rows = [row('name', 'eq', 'Ada'), row('enabled', 'eq', 'true')];
    assert.deepEqual(parseUserFilter(buildFilter(rows)), { name: 'Ada', enabled: true });
  });

  it('turns "or" rows into $or', () => {
    const rows = [row('name', 'eq', 'Ada'), or('enabled', 'eq', 'true')];
    assert.deepEqual(parseUserFilter(buildFilter(rows)), { $or: [{ name: 'Ada' }, { enabled: true }] });
  });

  it('applies "and" before "or", like SQL', () => {
    // a and b or c  ==  (a and b) or c
    const rows = [row('a', 'eq', '1'), row('b', 'eq', '2'), or('c', 'eq', '3')];
    assert.deepEqual(parseUserFilter(buildFilter(rows)), { $or: [{ a: 1, b: 2 }, { c: 3 }] });
    // a or b and c  ==  a or (b and c)
    const rows2 = [row('a', 'eq', '1'), or('b', 'eq', '2'), row('c', 'eq', '3')];
    assert.deepEqual(parseUserFilter(buildFilter(rows2)), { $or: [{ a: 1 }, { b: 2, c: 3 }] });
  });

  it('ignores the join of the first filled-in row, even if an empty row precedes it', () => {
    const rows = [row('', 'eq'), or('name', 'eq', 'Ada'), row('enabled', 'eq', 'true')];
    assert.deepEqual(parseUserFilter(buildFilter(rows)), { name: 'Ada', enabled: true });
  });

  it('uses $and when the same field appears twice within an "and" group', () => {
    const rows = [row('age', 'gte', '18'), row('age', 'lt', '65')];
    assert.deepEqual(parseUserFilter(buildFilter(rows)), { $and: [{ age: { $gte: 18 } }, { age: { $lt: 65 } }] });
  });

  it('supports exists / not exists / in', () => {
    const filter = parseUserFilter(
      buildFilter(
        [row('deletedAt', 'notExists'), row('phone', 'exists'), row('_id', 'in', '64b7f0c2a1d3e4f5a6b7c8d9, 64b7f0c2a1d3e4f5a6b7c8da')],
        { _id: ['objectId'] },
      ),
    );
    assert.deepEqual(filter.deletedAt, { $exists: false });
    assert.deepEqual(filter.phone, { $exists: true });
    assert.ok(filter._id.$in.every((v: unknown) => v instanceof ObjectId));
  });
});

describe('mixesJoins', () => {
  it('is true only when filled-in rows use both "and" and "or"', () => {
    assert.equal(mixesJoins([row('a', 'eq', '1'), row('b', 'eq', '2')]), false);
    assert.equal(mixesJoins([row('a', 'eq', '1'), or('b', 'eq', '2'), or('c', 'eq', '3')]), false);
    assert.equal(mixesJoins([row('a', 'eq', '1'), or('b', 'eq', '2'), row('c', 'eq', '3')]), true);
    assert.equal(mixesJoins([row('', 'eq'), or('b', 'eq', '2'), row('c', 'eq', '3')]), false);
  });
});
