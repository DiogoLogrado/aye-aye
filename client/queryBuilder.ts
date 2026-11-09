/**
 * Turns simple "field / operator / value" rows into a MongoDB filter written in shell syntax.
 * The output is exactly what gets sent to the server, so the preview is the real query.
 */

export type Operator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'startsWith'
  | 'exists'
  | 'notExists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

/** How a row connects to the rows before it (ignored on the first row, shown as "where"). */
export type Join = 'and' | 'or';

export interface FilterRow {
  id: string;
  join: Join;
  field: string;
  op: Operator;
  value: string;
}

export const OPERATORS: { value: Operator; label: string; needsValue: boolean }[] = [
  { value: 'eq', label: 'equals', needsValue: true },
  { value: 'ne', label: 'not equals', needsValue: true },
  { value: 'contains', label: 'contains (any case)', needsValue: true },
  { value: 'startsWith', label: 'starts with (any case)', needsValue: true },
  { value: 'exists', label: 'exists', needsValue: false },
  { value: 'notExists', label: 'does not exist', needsValue: false },
  { value: 'gt', label: '>', needsValue: true },
  { value: 'gte', label: '>=', needsValue: true },
  { value: 'lt', label: '<', needsValue: true },
  { value: 'lte', label: '<=', needsValue: true },
  { value: 'in', label: 'is one of (comma separated)', needsValue: true },
];

const HEX_24 = /^[0-9a-fA-F]{24}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const quote = (text: string) => JSON.stringify(text);
const isValidDate = (text: string) => ISO_DATE.test(text) && !Number.isNaN(Date.parse(text));

/**
 * Converts what the user typed into a shell literal, using the field's sampled types as hints.
 * Wrapping the value in double quotes always forces a string.
 */
export function toLiteral(raw: string, types: string[] = []): string {
  const value = raw.trim();
  const forced = /^"(.*)"$/s.exec(value);
  if (forced) return quote(forced[1] ?? '');
  if (value === 'null') return 'null';

  const has = (t: string) => types.includes(t);
  if (types.length > 0) {
    if (has('objectId') && HEX_24.test(value)) return `ObjectId(${quote(value)})`;
    if (has('date') && isValidDate(value)) return `ISODate(${quote(value)})`;
    if (has('number') && NUMBER.test(value)) return value;
    if (has('bool') && (value === 'true' || value === 'false')) return value;
    if (has('string')) return quote(value);
  }

  if (HEX_24.test(value)) return `ObjectId(${quote(value)})`;
  if (value === 'true' || value === 'false') return value;
  if (NUMBER.test(value)) return value;
  if (isValidDate(value)) return `ISODate(${quote(value)})`;
  return quote(value);
}

function condition(row: FilterRow, types: string[]): string | null {
  const value = row.value.trim();
  const needsValue = OPERATORS.find((o) => o.value === row.op)?.needsValue ?? true;
  if (needsValue && value === '') return null;

  switch (row.op) {
    case 'eq':
      return toLiteral(value, types);
    case 'ne':
      return `{ "$ne": ${toLiteral(value, types)} }`;
    case 'contains':
      return `{ "$regex": ${quote(escapeRegex(value))}, "$options": "i" }`;
    case 'startsWith':
      return `{ "$regex": ${quote(`^${escapeRegex(value)}`)}, "$options": "i" }`;
    case 'exists':
      return '{ "$exists": true }';
    case 'notExists':
      return '{ "$exists": false }';
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return `{ "$${row.op}": ${toLiteral(value, types)} }`;
    case 'in': {
      const items = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => toLiteral(v, types));
      return items.length === 0 ? null : `{ "$in": [${items.join(', ')}] }`;
    }
  }
}

export function buildFilter(rows: FilterRow[], fieldTypes: Record<string, string[]> = {}): string {
  const parts = rows
    .map((row) => {
      const field = row.field.trim();
      if (field === '') return null;
      const cond = condition(row, fieldTypes[field] ?? []);
      return cond === null ? null : { join: row.join, field, text: `${quote(field)}: ${cond}` };
    })
    .filter((p): p is Part => p !== null);

  if (parts.length === 0) return '{}';

  // Like SQL, "and" binds tighter than "or": a and b or c  ==  (a and b) or c.
  // Each "or" starts a new group; groups are combined with $or.
  const groups: Part[][] = [];
  parts.forEach((part, i) => {
    if (i === 0 || part.join === 'or') groups.push([part]);
    else groups[groups.length - 1]!.push(part);
  });

  const expressions = groups.map(andGroup);
  return expressions.length === 1 ? expressions[0]! : `{ "$or": [${expressions.join(', ')}] }`;
}

interface Part {
  join: Join;
  field: string;
  text: string;
}

/** ANDs conditions: merged into one object, or $and when a field repeats (keys can't repeat). */
function andGroup(parts: Part[]): string {
  if (parts.length === 1) return `{ ${parts[0]!.text} }`;
  const hasDuplicates = new Set(parts.map((p) => p.field)).size !== parts.length;
  return hasDuplicates
    ? `{ "$and": [${parts.map((p) => `{ ${p.text} }`).join(', ')}] }`
    : `{ ${parts.map((p) => p.text).join(', ')} }`;
}

/** True when rows mix "and" and "or", so the UI can explain how they are grouped. */
export function mixesJoins(rows: FilterRow[]): boolean {
  // The first filled-in row has no join of its own, whatever its position.
  const filled = rows.filter((r) => r.field.trim() !== '');
  return new Set(filled.slice(1).map((r) => r.join)).size > 1;
}
