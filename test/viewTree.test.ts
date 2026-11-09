import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Binary, Decimal128, Int32, Long, ObjectId, Timestamp } from 'mongodb';
import { toViewNode } from '../server/viewTree';

describe('toViewNode', () => {
  it('maps JSON primitives', () => {
    assert.deepEqual(toViewNode('hi'), { t: 'string', v: 'hi' });
    assert.deepEqual(toViewNode(4.5), { t: 'number', v: '4.5' });
    assert.deepEqual(toViewNode(false), { t: 'bool', v: false });
    assert.deepEqual(toViewNode(null), { t: 'null' });
  });

  it('renders BSON types shell-style as constructor + args', () => {
    assert.deepEqual(toViewNode(new ObjectId('64b7f0c2a1d3e4f5a6b7c8d9')), {
      t: 'bson',
      ctor: 'ObjectId',
      args: "'64b7f0c2a1d3e4f5a6b7c8d9'",
    });
    assert.deepEqual(toViewNode(new Date('2024-01-01T00:00:00Z')), {
      t: 'bson',
      ctor: 'ISODate',
      args: "'2024-01-01T00:00:00.000Z'",
    });
    const cases: [unknown, string][] = [
      [Long.fromString('9007199254740993'), 'NumberLong'],
      [Decimal128.fromString('1.50'), 'NumberDecimal'],
      [new Int32(7), 'NumberInt'],
      [/abc/i, 'RegExp'],
      [new Binary(Buffer.from('hi')), 'BinData'],
      [new Timestamp({ t: 1, i: 2 }), 'Timestamp'],
    ];
    for (const [value, ctor] of cases) {
      const node = toViewNode(value);
      assert.equal(node.t, 'bson', ctor);
      assert.equal(node.t === 'bson' && node.ctor, ctor);
    }
  });

  it('preserves field order and nesting', () => {
    const node = toViewNode({ b: 1, a: { c: [true, null] } });
    assert.deepEqual(node, {
      t: 'object',
      e: [
        ['b', { t: 'number', v: '1' }],
        ['a', { t: 'object', e: [['c', { t: 'array', e: [{ t: 'bool', v: true }, { t: 'null' }] }]] }],
      ],
    });
  });

  it('stops at a maximum depth instead of overflowing the stack', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 200; i++) deep = deep.x = {};
    let node = toViewNode(root);
    let depth = 0;
    while (node.t === 'object' && node.e[0]) {
      node = node.e[0][1];
      depth++;
    }
    assert.equal(node.t, 'truncated');
    assert.ok(depth < 100);
  });
});

describe('TtlCache', () => {
  it('expires entries, caps size and clears by prefix', async () => {
    const { TtlCache } = await import('../server/ttlCache');
    let now = 0;
    const cache = new TtlCache<number>(1_000, 2, () => now);
    cache.set('a/1', 1);
    cache.set('a/2', 2);
    cache.set('b/1', 3); // evicts the oldest (a/1)
    assert.equal(cache.get('a/1'), undefined);
    assert.equal(cache.get('a/2'), 2);
    cache.deletePrefix('a/');
    assert.equal(cache.get('a/2'), undefined);
    now = 1_000;
    assert.equal(cache.get('b/1'), undefined, 'expired');
  });
});
