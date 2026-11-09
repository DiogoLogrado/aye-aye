import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BSON, ObjectId } from 'mongodb';
import { UserFacingError } from '../server/errors';
import { buildSort, collectFields, formatDocument, parseUserFilter } from '../server/query';

describe('parseUserFilter', () => {
  it('returns an empty filter for blank input', () => {
    assert.deepEqual(parseUserFilter('   '), {});
    assert.deepEqual(parseUserFilter('{}'), {});
  });

  it('parses shell syntax into driver-compatible BSON types', () => {
    const filter = parseUserFilter(
      '{ name: /ada/i, _id: ObjectId("64b7f0c2a1d3e4f5a6b7c8d9"), createdAt: { $gte: ISODate("2024-01-01") } }',
    );
    assert.ok(filter._id instanceof ObjectId, 'ObjectId must come from the driver bson version');
    assert.ok(filter.createdAt.$gte instanceof Date);
    // The driver must be able to serialize everything the parser produced.
    assert.doesNotThrow(() => BSON.serialize(filter));
  });

  it('never executes code embedded in the filter', () => {
    for (const input of ['{ a: process.exit(1) }', '{ a: (function () { return 1 })() }', '{ a: require("fs") }', 'this.constructor']) {
      assert.throws(() => parseUserFilter(input), UserFacingError, input);
    }
  });

  it('rejects operators that run JavaScript on the server, at any depth', () => {
    assert.throws(() => parseUserFilter('{ $where: "this.a == 1" }'), /\$where is not allowed/);
    assert.throws(
      () => parseUserFilter('{ $and: [{ $expr: { $function: { body: "x", args: [], lang: "js" } } }] }'),
      /\$function is not allowed/,
    );
  });

  it('rejects arrays and oversized input', () => {
    assert.throws(() => parseUserFilter('[1, 2]'), UserFacingError);
    assert.throws(() => parseUserFilter(`{ a: "${'x'.repeat(25_000)}" }`), /too long/);
  });
});

describe('buildSort', () => {
  it('adds an _id tie-breaker for stable pagination', () => {
    assert.deepEqual(buildSort('updatedAt', -1), { updatedAt: -1, _id: -1 });
    assert.deepEqual(buildSort('_id', 1), { _id: 1 });
  });
});

describe('formatDocument', () => {
  it('formats in shell syntax with a short summary', () => {
    const id = new ObjectId('64b7f0c2a1d3e4f5a6b7c8d9');
    const formatted = formatDocument({ _id: id, name: 'Ada', createdAt: new Date('2024-01-01T00:00:00Z') });
    assert.match(formatted.text, /ObjectId\('64b7f0c2a1d3e4f5a6b7c8d9'\)/);
    assert.match(formatted.text, /ISODate\('2024-01-01T00:00:00.000Z'\)/);
    assert.equal(formatted.summary, "ObjectId('64b7f0c2a1d3e4f5a6b7c8d9')  ·  Ada");
  });
});

describe('collectFields', () => {
  it('collects nested paths, including through arrays of sub-documents', () => {
    const fields = collectFields([
      { _id: new ObjectId(), name: 'a', billing: { type: 'VAT' }, roles: [{ code: 'x' }] },
      { _id: new ObjectId(), name: null, createdAt: new Date() },
    ]);
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f.types]));
    assert.deepEqual(byPath._id, ['objectId']);
    assert.deepEqual(byPath.name, ['null', 'string']);
    assert.deepEqual(byPath['billing.type'], ['string']);
    assert.deepEqual(byPath['roles.code'], ['string']);
    assert.deepEqual(byPath.createdAt, ['date']);
  });
});
