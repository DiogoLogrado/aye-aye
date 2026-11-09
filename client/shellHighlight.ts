/**
 * Minimal tokenizer for mongo shell text, for display-only syntax coloring
 * (e.g. db.getCollection("users").find({ name: /x/i }).sort({ _id: -1 })).
 * It never evaluates anything; unknown characters fall back to plain text.
 */

export type TokenKind =
  | 'string'
  | 'number'
  | 'keyword' // true, false, null, undefined
  | 'func' // identifier called as a function: getCollection, find, ObjectId
  | 'operator' // $set, "$regex"
  | 'key' // object key: name, "name"
  | 'regex'
  | 'punct'
  | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined']);
const REGEX_CAN_START_AFTER = new Set(['(', ',', ':', '[', '{', '']);

function nextNonSpace(text: string, from: number): string {
  for (let i = from; i < text.length; i++) if (!/\s/.test(text[i]!)) return text[i]!;
  return '';
}

export function tokenizeShell(text: string): Token[] {
  const tokens: Token[] = [];
  let prevSignificant = '';
  let i = 0;

  const push = (kind: TokenKind, value: string) => {
    tokens.push({ kind, text: value });
    if (kind !== 'plain' || value.trim() !== '') prevSignificant = value.trim().slice(-1);
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (/\s/.test(ch)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      tokens.push({ kind: 'plain', text: text.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, text.length);
      const literal = text.slice(i, j);
      const inner = literal.slice(1, -1);
      const isKey = nextNonSpace(text, j) === ':';
      push(inner.startsWith('$') ? 'operator' : isKey ? 'key' : 'string', literal);
      i = j;
      continue;
    }

    if (ch === '/' && REGEX_CAN_START_AFTER.has(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n') {
        const c = text[j];
        if (c === '\\') j++;
        else if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      if (text[j] === '/') {
        j++;
        while (j < text.length && /[a-z]/i.test(text[j]!)) j++;
        push('regex', text.slice(i, j));
        i = j;
        continue;
      }
    }

    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(text[i + 1] ?? '') && REGEX_CAN_START_AFTER.has(prevSignificant))) {
      const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      if (match) {
        push('number', match[0]);
        i += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))!;
      const word = match[0];
      const after = nextNonSpace(text, i + word.length);
      const kind: TokenKind = KEYWORDS.has(word)
        ? 'keyword'
        : word.startsWith('$')
          ? 'operator'
          : after === '('
            ? 'func'
            : after === ':'
              ? 'key'
              : 'plain';
      push(kind, word);
      i += word.length;
      continue;
    }

    push('punct', ch);
    i++;
  }

  return tokens;
}
