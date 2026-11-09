import { toJSString } from 'mongodb-query-parser';
import type { ViewNode } from '../shared/viewNode';

export type { ViewNode };

const MAX_DEPTH = 64;
const SHELL_CALL = /^(?:new\s+)?([A-Za-z][\w]*)\(([\s\S]*)\)$/;

function bsonNode(value: unknown): ViewNode {
  const text = toJSString(value) ?? String(value);
  const match = SHELL_CALL.exec(text.trim());
  return match ? { t: 'bson', ctor: match[1] ?? 'BSON', args: match[2] ?? '' } : { t: 'bson', ctor: '', args: text };
}

export function toViewNode(value: unknown, depth = 0): ViewNode {
  if (depth > MAX_DEPTH) return { t: 'truncated' };
  if (value === null) return { t: 'null' };
  if (value === undefined) return { t: 'undefined' };

  switch (typeof value) {
    case 'string':
      return { t: 'string', v: value };
    case 'number':
      return { t: 'number', v: Number.isFinite(value) ? String(value) : `Number("${value}")` };
    case 'bigint':
      return { t: 'bson', ctor: 'NumberLong', args: `'${value}'` };
    case 'boolean':
      return { t: 'bool', v: value };
    case 'object':
      break;
    default:
      return { t: 'string', v: String(value) };
  }

  if (Array.isArray(value)) return { t: 'array', e: value.map((item) => toViewNode(item, depth + 1)) };
  if (value instanceof Date || value instanceof RegExp || '_bsontype' in value) return bsonNode(value);
  return {
    t: 'object',
    e: Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toViewNode(v, depth + 1)]),
  };
}
