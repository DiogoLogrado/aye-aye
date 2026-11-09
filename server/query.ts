import { createHash } from 'node:crypto';
import { BSON, type Document, type Sort } from 'mongodb';
import { parseFilter, toJSString } from 'mongodb-query-parser';
import { QUERY_LIMITS } from './config';
import { UserFacingError } from './errors';
import { toViewNode, type ViewNode } from './viewTree';

/** Operators that run server-side JavaScript; never allowed. */
const FORBIDDEN_OPERATORS = new Set(['$where', '$function', '$accumulator']);

/** Rejects server-side JavaScript operators anywhere in a parsed value. */
export function assertSafe(value: unknown, depth = 0): void {
  if (depth > QUERY_LIMITS.maxFilterDepth) {
    throw new UserFacingError('Filter is nested too deeply');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafe(item, depth + 1);
    return;
  }
  if (value === null || typeof value !== 'object' || '_bsontype' in value || value instanceof Date) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OPERATORS.has(key)) {
      throw new UserFacingError(`Operator ${key} is not allowed (it executes JavaScript on the server)`);
    }
    assertSafe(child, depth + 1);
  }
}

/**
 * Parses a mongo-shell-syntax object (`{ name: /ada/i, _id: ObjectId("...") }`) without
 * evaluating any code. Function calls other than BSON constructors are rejected by the parser.
 * Returns undefined when the text isn't a valid object.
 */
export function parseShellObject(input: string): Document | undefined {
  try {
    const parsed: unknown = parseFilter(input);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Document) : undefined;
  } catch {
    return undefined;
  }
}

export function parseUserFilter(input: string): Document {
  const trimmed = input.trim();
  if (trimmed === '') return {};
  if (trimmed.length > QUERY_LIMITS.maxFilterLength) {
    throw new UserFacingError('Filter is too long');
  }
  const filter = parseShellObject(trimmed);
  if (!filter) {
    throw new UserFacingError('Invalid filter. Use shell syntax, e.g. { name: "Ada" } or { name: /ada/i }');
  }
  assertSafe(filter);
  return filter;
}

/** Stable fingerprint of a document's exact current contents (optimistic concurrency for edits). */
export function documentVersion(doc: Document): string {
  return createHash('sha256').update(BSON.EJSON.stringify(doc, { relaxed: false })).digest('base64url');
}

/** Encodes an _id so the client can send it back losslessly (ObjectId, string, number, UUID…). */
export function encodeId(id: unknown): string {
  return BSON.EJSON.stringify({ _id: id }, { relaxed: false });
}

export function decodeId(encoded: string): unknown {
  try {
    const parsed = BSON.EJSON.parse(encoded, { relaxed: false }) as { _id?: unknown };
    if (parsed && typeof parsed === 'object' && '_id' in parsed) return parsed._id;
  } catch {
    // fall through
  }
  throw new UserFacingError('Invalid document id');
}

export function buildSort(field: string, direction: 1 | -1): Sort {
  // Tie-break on _id so pagination is stable when the sort field has duplicates.
  return field === '_id' ? { _id: direction } : { [field]: direction, _id: direction };
}

const SUMMARY_FIELDS = ['name', 'title', 'email', 'username', 'code', 'status', 'type'];

export interface FormattedDocument {
  /** Shell-syntax text, used for copy to clipboard. */
  text: string;
  summary: string;
  /** Typed tree for the colored, collapsible viewer. */
  tree: ViewNode;
  /** Lossless _id for edit/delete requests; absent when the document has no _id. */
  id?: string;
  /** Content fingerprint; edits are refused if the stored document no longer matches it. */
  version: string;
}

export function formatDocument(doc: Document): FormattedDocument {
  const id = doc._id === undefined ? '' : toJSString(doc._id) ?? '';
  const label = SUMMARY_FIELDS.map((f) => doc[f]).find((v): v is string => typeof v === 'string' && v !== '');
  return {
    text: toJSString(doc, 2) ?? '',
    summary: [id, label].filter(Boolean).join('  ·  '),
    tree: toViewNode(doc),
    id: doc._id === undefined ? undefined : encodeId(doc._id),
    version: documentVersion(doc),
  };
}

export interface FieldInfo {
  path: string;
  types: string[];
}

const MAX_FIELD_DEPTH = 4;
const MAX_FIELDS = 500;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object') {
    const bsonType = (value as { _bsontype?: string })._bsontype;
    if (bsonType === 'ObjectId') return 'objectId';
    if (bsonType === 'Decimal128' || bsonType === 'Long' || bsonType === 'Int32' || bsonType === 'Double') return 'number';
    return bsonType ? bsonType.toLowerCase() : 'object';
  }
  if (typeof value === 'boolean') return 'bool';
  return typeof value; // string | number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !('_bsontype' in value);
}

/** Collects dotted field paths and observed types from sampled documents. */
export function collectFields(docs: Document[]): FieldInfo[] {
  const fields = new Map<string, Set<string>>();

  const visit = (value: unknown, prefix: string, depth: number) => {
    if (!isPlainObject(value) || depth > MAX_FIELD_DEPTH) return;
    for (const [key, child] of Object.entries(value)) {
      if (fields.size >= MAX_FIELDS && !fields.has(`${prefix}${key}`)) return;
      const path = `${prefix}${key}`;
      const types = fields.get(path) ?? new Set<string>();
      types.add(typeOf(child));
      fields.set(path, types);
      // Dot notation reaches into arrays of sub-documents, so descend into their elements too.
      const nested = Array.isArray(child) ? child : [child];
      for (const item of nested) visit(item, `${path}.`, depth + 1);
    }
  };

  for (const doc of docs) visit(doc, '', 0);

  return [...fields.entries()]
    .map(([path, types]) => ({ path, types: [...types].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
