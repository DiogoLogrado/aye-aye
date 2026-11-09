import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenizeShell, type TokenKind } from '../client/shellHighlight';

const kinds = (text: string) =>
  tokenizeShell(text)
    .filter((t) => t.text.trim() !== '' && t.kind !== 'punct')
    .map((t) => `${t.kind}:${t.text}`);

describe('tokenizeShell', () => {
  it('colors the generated find command', () => {
    assert.deepEqual(kinds('db.getCollection("users").find({ "name": "Ada" }).sort({ createdAt: -1 }).limit(20)'), [
      'plain:db',
      'func:getCollection',
      'string:"users"',
      'func:find',
      'key:"name"',
      'string:"Ada"',
      'func:sort',
      'key:createdAt',
      'number:-1',
      'func:limit',
      'number:20',
    ]);
  });

  it('recognizes operators, regexes, keywords and BSON constructors', () => {
    const result = kinds(
      String.raw`{ "email": { "$regex": "a\\.b", "$options": "i" }, $or: [{ ok: true }, { x: null }], r: /a\/b/i, id: ObjectId("x") }`,
    );
    assert.ok(result.includes('operator:"$regex"'));
    assert.ok(result.includes('operator:$or'));
    assert.ok(result.includes('keyword:true'));
    assert.ok(result.includes('keyword:null'));
    assert.ok(result.includes(String.raw`regex:/a\/b/i`));
    assert.ok(result.includes('string:"i"'));
    assert.ok(result.includes('func:ObjectId'));
  });

  it('round-trips the exact text, including unterminated strings', () => {
    for (const text of ['db.users.find({ a: "unterminated', 'a / b / c', '{ "x": 1.5e3 }', '']) {
      assert.equal(tokenizeShell(text).map((t) => t.text).join(''), text);
    }
  });

  it('only uses known token kinds', () => {
    const known: TokenKind[] = ['string', 'number', 'keyword', 'func', 'operator', 'key', 'regex', 'punct', 'plain'];
    for (const t of tokenizeShell('db.x.updateMany({}, { $set: { a: [1, "2", /3/] } })')) assert.ok(known.includes(t.kind));
  });
});
