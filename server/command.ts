import type { Document } from 'mongodb';
import { QUERY_LIMITS } from './config';
import { UserFacingError } from './errors';
import { assertSafe, parseShellObject } from './query';

/**
 * Parses mongo shell commands such as
 *   db.users.updateMany({ category: "old" }, { $set: { category: "new" } })
 *   db.getCollection("users").find({ name: /ada/i })
 * into a structured, allowlisted operation. Nothing is ever evaluated as JavaScript:
 * the call shape is matched textually and the arguments go through the BSON shell parser.
 */

export const READ_METHODS = ['find', 'findOne', 'countDocuments', 'distinct', 'aggregate'] as const;
export const WRITE_METHODS = [
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
] as const;

export type ReadMethod = (typeof READ_METHODS)[number];
export type WriteMethod = (typeof WRITE_METHODS)[number];
export type CommandMethod = ReadMethod | WriteMethod;

/** Options from a cursor chain after find(...): .sort() .limit() .skip() .projection(). */
export interface CursorOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Document;
}

export interface ParsedCommand {
  collection: string;
  method: CommandMethod;
  args: unknown[];
  isWrite: boolean;
  /** Only for find; empty object when there is no chain. */
  cursor: CursorOptions;
}

/** A find command flattened into query parts, as the results view runs it. */
export interface FindQuery {
  filter: Document;
  projection?: Document;
  sort?: Record<string, 1 | -1>;
  /** Page size; defaults to DEFAULT_FIND_LIMIT when the command has no .limit(). */
  limit: number;
  skip: number;
}

export const DEFAULT_FIND_LIMIT = 20;

/** Chained cursor calls accepted after find(...). pretty/toArray are accepted and ignored (pasted from shells). */
const CURSOR_METHODS = new Set(['sort', 'limit', 'skip', 'projection', 'pretty', 'toArray']);

/** Methods that destroy structure or data wholesale. Aye-aye never runs them. */
const FORBIDDEN_METHODS = new Set([
  'drop',
  'dropDatabase',
  'dropIndex',
  'dropIndexes',
  'renameCollection',
  'remove',
  'bulkWrite',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'mapReduce',
  'runCommand',
  'adminCommand',
  'eval',
]);

const MAX_COMMAND_LENGTH = 100_000;
const UPDATE_OPTIONS = new Set(['upsert', 'arrayFilters', 'collation', 'hint']);
const WRITE_STAGES = new Set(['$out', '$merge']);

const COMMAND_PREFIXES: RegExp[] = [
  // db.getCollection("name").method(
  /^db\s*\.\s*getCollection\s*\(\s*(?<q>["'])(?<name>(?:\\.|(?!\k<q>).)*)\k<q>\s*\)\s*\.\s*(?<method>[A-Za-z]\w*)\s*\(/s,
  // db["name"].method(
  /^db\s*\[\s*(?<q>["'])(?<name>(?:\\.|(?!\k<q>).)*)\k<q>\s*\]\s*\.\s*(?<method>[A-Za-z]\w*)\s*\(/s,
  // db.name.method(
  /^db\s*\.\s*(?<name>[A-Za-z_][\w-]*)\s*\.\s*(?<method>[A-Za-z]\w*)\s*\(/s,
];

export function looksLikeCommand(text: string): boolean {
  return /^\s*db\s*[.[]/.test(text);
}

/**
 * Finds the index of the parenthesis that closes the one just before `start`,
 * skipping over string and regex literals.
 */
function findClosingParen(text: string, start: number): number {
  let depth = 1;
  let prevSignificant = '(';
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(text, i, ch);
      prevSignificant = ch;
      continue;
    }
    // A slash after one of these starts a regex literal (it can't be division in an argument list).
    if (ch === '/' && '(,:[{'.includes(prevSignificant)) {
      i = skipRegex(text, i);
      prevSignificant = '/';
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return ch === ')' ? i : -1;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
  }
  return -1;
}

function skipQuoted(text: string, start: number, quote: string): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  throw new UserFacingError('Unterminated string in command');
}

function skipRegex(text: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      while (/[a-z]/i.test(text[i + 1] ?? '')) i++; // flags
      return i;
    }
    else if (ch === '\n') break;
  }
  throw new UserFacingError('Unterminated regular expression in command');
}

function unquote(name: string): string {
  return name.replace(/\\(.)/g, '$1');
}

const isPlainObject = (v: unknown): v is Document =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !('_bsontype' in v);

function requireObject(value: unknown, what: string, method: string): Document {
  if (!isPlainObject(value)) throw new UserFacingError(`${method}: ${what} must be an object like { ... }`);
  return value;
}

function hasOperatorKeys(doc: Document): boolean {
  return Object.keys(doc).some((k) => k.startsWith('$'));
}

function validateArgs(method: CommandMethod, args: unknown[]): void {
  const argCount = (min: number, max: number) => {
    if (args.length < min || args.length > max) {
      throw new UserFacingError(
        `${method} takes ${min === max ? min : `${min}–${max}`} argument${max === 1 ? '' : 's'}, got ${args.length}`,
      );
    }
  };

  switch (method) {
    case 'find':
    case 'findOne':
      argCount(0, 2);
      args.forEach((a, i) => requireObject(a, i === 0 ? 'the filter' : 'the projection', method));
      return;
    case 'countDocuments':
      argCount(0, 1);
      if (args[0] !== undefined) requireObject(args[0], 'the filter', method);
      return;
    case 'distinct':
      argCount(1, 2);
      if (typeof args[0] !== 'string') throw new UserFacingError('distinct: the first argument must be a field name string');
      if (args[1] !== undefined) requireObject(args[1], 'the filter', method);
      return;
    case 'aggregate': {
      argCount(1, 1);
      const pipeline = args[0];
      if (!Array.isArray(pipeline)) throw new UserFacingError('aggregate: the pipeline must be an array [ ... ]');
      for (const stage of pipeline) {
        const stageDoc = requireObject(stage, 'each pipeline stage', method);
        const writeStage = Object.keys(stageDoc).find((k) => WRITE_STAGES.has(k));
        if (writeStage) throw new UserFacingError(`aggregate: ${writeStage} writes to a collection and is not allowed`);
      }
      return;
    }
    case 'insertOne':
      argCount(1, 1);
      requireObject(args[0], 'the document', method);
      return;
    case 'insertMany': {
      argCount(1, 1);
      const docs = args[0];
      if (!Array.isArray(docs) || docs.length === 0) throw new UserFacingError('insertMany: pass a non-empty array of documents');
      docs.forEach((d) => requireObject(d, 'each document', method));
      return;
    }
    case 'updateOne':
    case 'updateMany': {
      argCount(2, 3);
      requireObject(args[0], 'the filter', method);
      const update = args[1];
      if (Array.isArray(update)) {
        update.forEach((stage) => requireObject(stage, 'each update pipeline stage', method));
      } else {
        const updateDoc = requireObject(update, 'the update', method);
        if (Object.keys(updateDoc).length === 0 || !Object.keys(updateDoc).every((k) => k.startsWith('$'))) {
          throw new UserFacingError(
            `${method}: the update must use operators like { $set: { field: value } }. To replace a whole document use replaceOne.`,
          );
        }
      }
      if (args[2] !== undefined) {
        const options = requireObject(args[2], 'the options', method);
        const unknown = Object.keys(options).filter((k) => !UPDATE_OPTIONS.has(k));
        if (unknown.length) throw new UserFacingError(`${method}: unsupported option(s) ${unknown.join(', ')}`);
      }
      return;
    }
    case 'replaceOne': {
      argCount(2, 3);
      requireObject(args[0], 'the filter', method);
      const replacement = requireObject(args[1], 'the replacement document', method);
      if (hasOperatorKeys(replacement)) {
        throw new UserFacingError('replaceOne: the replacement cannot contain $ operators. Use updateOne for $set etc.');
      }
      if (args[2] !== undefined) {
        const options = requireObject(args[2], 'the options', method);
        const unknown = Object.keys(options).filter((k) => !UPDATE_OPTIONS.has(k));
        if (unknown.length) throw new UserFacingError(`${method}: unsupported option(s) ${unknown.join(', ')}`);
      }
      return;
    }
    case 'deleteOne':
    case 'deleteMany': {
      argCount(1, 1);
      const filter = requireObject(args[0], 'the filter', method);
      if (method === 'deleteMany' && Object.keys(filter).length === 0) {
        throw new UserFacingError('deleteMany({}) would delete every document in the collection and is not allowed.');
      }
      return;
    }
  }
}

export function parseCommand(input: string): ParsedCommand {
  const text = input.trim().replace(/;+\s*$/, '');
  if (text.length > MAX_COMMAND_LENGTH) throw new UserFacingError('Command is too long');

  const match = COMMAND_PREFIXES.map((re) => re.exec(text)).find(Boolean);
  if (!match?.groups) {
    throw new UserFacingError('Commands must look like db.collection.method(...) or db.getCollection("name").method(...)');
  }
  const collection = unquote(match.groups.name ?? '');
  const methodName = match.groups.method ?? '';

  if (FORBIDDEN_METHODS.has(methodName)) {
    throw new UserFacingError(`${methodName} is not allowed. Aye-aye never drops, renames or runs raw commands.`);
  }
  const isRead = (READ_METHODS as readonly string[]).includes(methodName);
  const isWrite = (WRITE_METHODS as readonly string[]).includes(methodName);
  if (!isRead && !isWrite) {
    throw new UserFacingError(`Unsupported method "${methodName}". Supported: ${[...READ_METHODS, ...WRITE_METHODS].join(', ')}`);
  }
  const method = methodName as CommandMethod;

  const argsStart = match[0].length;
  const close = findClosingParen(text, argsStart);
  if (close === -1) throw new UserFacingError('Unbalanced parentheses or brackets in command');

  const args = parseArgs(text.slice(argsStart, close), method);
  assertSafe(args);
  validateArgs(method, args);

  const cursor = parseCursorChain(text, close + 1, method);
  return { collection, method, args, isWrite, cursor };
}

function parseArgs(argsText: string, method: string): unknown[] {
  const trimmed = argsText.trim();
  if (trimmed === '') return [];
  const wrapped = parseShellObject(`{ "args": [ ${trimmed} ] }`);
  if (!wrapped || !Array.isArray(wrapped.args)) {
    throw new UserFacingError(`Could not parse the arguments of ${method}(...). Check brackets, quotes and commas.`);
  }
  const args = wrapped.args as unknown[];
  if (args.length > QUERY_LIMITS.maxFilterDepth) throw new UserFacingError('Too many arguments');
  return args;
}

/** Parses `.sort({…}).limit(n)…` after find(...). Anything else after the main call is an error. */
function parseCursorChain(text: string, from: number, method: CommandMethod): CursorOptions {
  const cursor: CursorOptions = {};
  const seen = new Set<string>();
  let pos = from;

  while (text.slice(pos).trim() !== '') {
    const call = /^\s*\.\s*([A-Za-z]\w*)\s*\(/.exec(text.slice(pos));
    if (!call) throw new UserFacingError('Unexpected text after the command. Check for a missing "." or bracket.');
    const name = call[1] ?? '';
    if (method !== 'find') {
      throw new UserFacingError(`.${name}() can only follow find(...).`);
    }
    if (!CURSOR_METHODS.has(name)) {
      throw new UserFacingError(`.${name}() is not supported after find. Use .sort(), .limit(), .skip() or .projection().`);
    }
    if (seen.has(name)) throw new UserFacingError(`.${name}() appears twice.`);
    seen.add(name);

    const start = pos + call[0].length;
    const end = findClosingParen(text, start);
    if (end === -1) throw new UserFacingError('Unbalanced parentheses or brackets in command');
    const args = parseArgs(text.slice(start, end), name);
    assertSafe(args);
    applyCursorCall(cursor, name, args);
    pos = end + 1;
  }
  return cursor;
}

function applyCursorCall(cursor: CursorOptions, name: string, args: unknown[]): void {
  const single = () => {
    if (args.length !== 1) throw new UserFacingError(`.${name}() takes exactly one argument`);
    return args[0];
  };
  const count = (min: number, max: number) => {
    const value = single();
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new UserFacingError(`.${name}() needs a whole number between ${min} and ${max.toLocaleString('en-US')}`);
    }
    return value;
  };

  switch (name) {
    case 'sort': {
      const sort = requireObject(single(), 'the sort', 'sort');
      for (const [field, direction] of Object.entries(sort)) {
        if (direction !== 1 && direction !== -1) {
          throw new UserFacingError(`.sort(): use 1 (ascending) or -1 (descending) for "${field}"`);
        }
      }
      cursor.sort = sort as Record<string, 1 | -1>;
      return;
    }
    case 'limit':
      cursor.limit = count(1, QUERY_LIMITS.maxLimit);
      return;
    case 'skip':
      cursor.skip = count(0, QUERY_LIMITS.maxSkip);
      return;
    case 'projection':
      cursor.projection = requireObject(single(), 'the projection', 'projection');
      return;
    default:
      // pretty() / toArray(): accepted for convenience, no effect.
      if (args.length !== 0) throw new UserFacingError(`.${name}() takes no arguments`);
  }
}

/** Flattens a parsed find command (main args + cursor chain) into the parts the results view runs. */
export function toFindQuery(command: ParsedCommand): FindQuery {
  if (command.method !== 'find') {
    throw new UserFacingError(`Expected a find(...) command, got ${command.method}(...)`);
  }
  const [filter, projection] = command.args as [Document | undefined, Document | undefined];
  if (projection && command.cursor.projection) {
    throw new UserFacingError('Give the projection either as find(filter, projection) or .projection(), not both');
  }
  return {
    filter: filter ?? {},
    projection: projection ?? command.cursor.projection,
    sort: command.cursor.sort,
    limit: command.cursor.limit ?? DEFAULT_FIND_LIMIT,
    skip: command.cursor.skip ?? 0,
  };
}
