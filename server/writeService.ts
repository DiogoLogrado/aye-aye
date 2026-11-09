import { createHash } from 'node:crypto';
import { BSON, ObjectId, type Collection, type Document, type Filter } from 'mongodb';
import { toJSString } from 'mongodb-query-parser';
import type { BackupRecord, BackupStore } from './backupStore';
import { parseCommand, toFindQuery, type ParsedCommand } from './command';
import { QUERY_LIMITS } from './config';
import type { ConnectionStore } from './connectionStore';
import { UserFacingError } from './errors';
import { decodeId, documentVersion, encodeId, formatDocument, parseShellObject, type FormattedDocument } from './query';
import { toViewNode, type ViewNode } from './viewTree';

export const WRITE_LIMITS = {
  /** Every affected document is backed up first; beyond this a command is refused. */
  maxAffectedDocs: 50_000,
  maxResultDocs: 200,
  maxDistinctValues: 1_000,
  restoreBatchSize: 1_000,
} as const;

export type GetCollection = (connectionId: string, db: string, collection: string) => Promise<Collection>;

export interface Target {
  connectionId: string;
  db: string;
  collection: string;
}

export interface FieldChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

export type CommandResponse =
  | {
      kind: 'confirm';
      method: string;
      description: string;
      warnings: string[];
      affected: number;
      requireTyping: boolean;
      confirmToken: string;
    }
  | { kind: 'documents'; method: string; docs: FormattedDocument[]; hasMore: boolean }
  | { kind: 'value'; method: string; tree: ViewNode; text: string }
  | { kind: 'written'; method: string; summary: string; backupId?: string };

const isPlainObject = (v: unknown): v is Document =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !('_bsontype' in v);

const canonical = (value: unknown) => BSON.EJSON.stringify({ v: value }, { relaxed: false });

/** Assigns an ObjectId to documents without _id, so undo records know every id before inserting. */
const withIds = (docs: Document[]): Document[] => docs.map((d) => ('_id' in d ? d : { _id: new ObjectId(), ...d }));
const display = (value: unknown) => toJSString(value) ?? String(value);
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Field-level diff (nested objects by path; arrays compared as whole values). */
export function diffDocuments(before: Document, after: Document): FieldChange[] {
  const flatten = (doc: Document, prefix: string, out: Map<string, unknown>) => {
    for (const [key, value] of Object.entries(doc)) {
      const path = `${prefix}${key}`;
      if (isPlainObject(value) && Object.keys(value).length > 0) flatten(value, `${path}.`, out);
      else out.set(path, value);
    }
    return out;
  };
  const a = flatten(before, '', new Map());
  const b = flatten(after, '', new Map());
  const changes: FieldChange[] = [];
  for (const [path, value] of a) {
    if (!b.has(path)) changes.push({ path, kind: 'removed', before: display(value) });
    else if (canonical(value) !== canonical(b.get(path))) {
      changes.push({ path, kind: 'changed', before: display(value), after: display(b.get(path)) });
    }
  }
  for (const [path, value] of b) {
    if (!a.has(path)) changes.push({ path, kind: 'added', after: display(value) });
  }
  return changes;
}

/**
 * The only code path that writes to a database. Rules enforced here (not in the UI):
 * - single-document edits/deletes are refused if the document changed since it was loaded
 * - affected documents are backed up to disk BEFORE every write, enabling undo
 * - bulk writes only touch the exact documents that were backed up
 * - write commands need a confirmation token tied to the previewed command
 */
export class WriteService {
  constructor(
    private readonly getCollection: GetCollection,
    private readonly store: ConnectionStore,
    private readonly backups: BackupStore,
  ) {}

  async replaceDocument(
    target: Target,
    input: { id: string; version: string; document: string; dryRun: boolean },
  ): Promise<{ changes: FieldChange[]; backupId?: string }> {
    await this.assertConnectionExists(target.connectionId);
    const coll = await this.collectionOf(target);
    const _id = decodeId(input.id);
    const current = await this.loadUnchanged(coll, _id, input.version);

    const parsed = parseShellObject(input.document);
    if (!parsed) throw new UserFacingError('The document is not valid. Check brackets, quotes and commas.');
    const operatorKey = Object.keys(parsed).find((k) => k.startsWith('$'));
    if (operatorKey) throw new UserFacingError(`Top-level field names cannot start with "$" (found ${operatorKey}).`);
    if ('_id' in parsed && encodeId(parsed._id) !== encodeId(current._id)) {
      throw new UserFacingError('The _id cannot be changed.');
    }
    const replacement: Document = { _id: current._id, ...parsed };

    const changes = diffDocuments(current, replacement);
    if (input.dryRun || changes.length === 0) return { changes };

    const backup = await this.backup(target, 'edit document', [current]);
    const result = await coll.replaceOne({ _id } as Filter<Document>, replacement);
    if (result.matchedCount === 0) throw new UserFacingError('The document was deleted before it could be saved.', 409);
    return { changes, backupId: backup.id };
  }

  async insertDocument(target: Target, input: { document: string }): Promise<{ backupId: string; id: string }> {
    await this.assertConnectionExists(target.connectionId);
    const coll = await this.collectionOf(target);

    const parsed = parseShellObject(input.document);
    if (!parsed) throw new UserFacingError('The document is not valid. Check brackets, quotes and commas.');
    if (Object.keys(parsed).length === 0) throw new UserFacingError('The document is empty. Add at least one field.');
    const operatorKey = Object.keys(parsed).find((k) => k.startsWith('$'));
    if (operatorKey) throw new UserFacingError(`Top-level field names cannot start with "$" (found ${operatorKey}).`);

    const [doc] = withIds([parsed]);
    const { backup } = await this.insertWithBackup(coll, target, 'insert document', [doc!]);
    return { backupId: backup.id, id: encodeId(doc!._id) };
  }

  /**
   * Inserts with an undo record that never points at documents we didn't create:
   * existing _ids are refused up front, and after a failure the record keeps only
   * the documents that really went in (ordered insert: the first `insertedCount`).
   */
  private async insertWithBackup(coll: Collection, target: Target, operation: string, docs: Document[]) {
    const ids = docs.map((d) => d._id);
    const clash = await coll.findOne({ _id: { $in: ids } } as Filter<Document>, { projection: { _id: 1 } });
    if (clash) {
      throw new UserFacingError(`A document with _id ${display(clash._id)} already exists in this collection.`, 409);
    }
    const backup = await this.backup(target, operation, [], ids);
    try {
      const result = await coll.insertMany(docs, { ordered: true });
      return { backup, insertedCount: result.insertedCount };
    } catch (error) {
      const inserted = (error as { insertedCount?: number }).insertedCount ?? 0;
      if (inserted > 0) await this.backups.setInsertedIds(backup, ids.slice(0, inserted));
      else await this.backups.discard(backup);
      throw error;
    }
  }

  async deleteDocument(target: Target, input: { id: string; version: string }): Promise<{ backupId: string }> {
    await this.assertConnectionExists(target.connectionId);
    const coll = await this.collectionOf(target);
    const _id = decodeId(input.id);
    const current = await this.loadUnchanged(coll, _id, input.version);

    const backup = await this.backup(target, 'delete document', [current]);
    const result = await coll.deleteOne({ _id } as Filter<Document>);
    if (result.deletedCount === 0) throw new UserFacingError('The document was already deleted.', 409);
    return { backupId: backup.id };
  }

  async undo(backupId: string): Promise<{ summary: string }> {
    const record = await this.backups.get(backupId);
    if (record.undoneAt) throw new UserFacingError('This change was already undone.', 409);
    await this.assertConnectionExists(record.connectionId);
    const coll = await this.collectionOf(record);

    for (let i = 0; i < record.before.length; i += WRITE_LIMITS.restoreBatchSize) {
      const batch = record.before.slice(i, i + WRITE_LIMITS.restoreBatchSize);
      await coll.bulkWrite(
        batch.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
        { ordered: false },
      );
    }
    let removed = 0;
    if (record.insertedIds.length > 0) {
      removed = (await coll.deleteMany({ _id: { $in: record.insertedIds } } as Filter<Document>)).deletedCount;
    }
    await this.backups.markUndone(record);

    const parts = [];
    if (record.before.length) parts.push(`restored ${plural(record.before.length, 'document')}`);
    if (record.insertedIds.length) parts.push(`removed ${plural(removed, 'inserted document')}`);
    return { summary: `Undone: ${parts.join(', ') || 'nothing to restore'}.` };
  }

  async runCommand(target: Target, text: string, confirmToken?: string): Promise<CommandResponse> {
    const command = parseCommand(text);
    if (command.collection !== target.collection) {
      throw new UserFacingError(
        `This command targets "${command.collection}" but this tab is "${target.collection}". Open that collection to run it.`,
      );
    }
    const coll = await this.collectionOf(target);
    if (!command.isWrite) return this.runRead(coll, command);

    await this.assertConnectionExists(target.connectionId);
    const plan = await this.planWrite(coll, command, target);
    const token = createHash('sha256')
      .update(`${target.connectionId}\n${target.db}\n${target.collection}\n${canonical([command.method, command.args])}`)
      .digest('base64url');
    if (confirmToken !== token) return { kind: 'confirm', ...plan, method: command.method, confirmToken: token };
    return this.executeWrite(coll, command, target);
  }

  // ---------------------------------------------------------------- reads

  private async runRead(coll: Collection, command: ParsedCommand): Promise<CommandResponse> {
    const { method, args } = command;
    const maxTimeMS = QUERY_LIMITS.maxTimeMS;
    const limit = WRITE_LIMITS.maxResultDocs;
    switch (method) {
      case 'find': {
        const query = toFindQuery(command);
        const pageSize = command.cursor.limit ?? limit;
        const docs = await coll
          .find(query.filter as Filter<Document>, {
            ...(query.sort ? { sort: query.sort } : {}),
            ...(query.projection ? { projection: query.projection } : {}),
            skip: query.skip,
            limit: pageSize + 1,
            maxTimeMS,
          })
          .toArray();
        return { kind: 'documents', method, docs: docs.slice(0, pageSize).map(formatDocument), hasMore: docs.length > pageSize };
      }
      case 'findOne': {
        const doc = await coll.findOne((args[0] ?? {}) as Filter<Document>, { projection: args[1] as Document | undefined, maxTimeMS });
        return doc
          ? { kind: 'documents', method, docs: [formatDocument(doc)], hasMore: false }
          : { kind: 'value', method, tree: toViewNode(null), text: 'null' };
      }
      case 'countDocuments': {
        const count = await coll.countDocuments((args[0] ?? {}) as Filter<Document>, { maxTimeMS });
        return { kind: 'value', method, tree: toViewNode(count), text: String(count) };
      }
      case 'distinct': {
        const values = await coll.distinct(args[0] as string, (args[1] ?? {}) as Filter<Document>, { maxTimeMS });
        const shown = values.slice(0, WRITE_LIMITS.maxDistinctValues);
        return { kind: 'value', method, tree: toViewNode(shown), text: toJSString(shown, 2) ?? '' };
      }
      case 'aggregate': {
        const pipeline = [...(args[0] as Document[]), { $limit: limit + 1 }];
        const docs = await coll.aggregate(pipeline, { maxTimeMS }).toArray();
        return { kind: 'documents', method, docs: docs.slice(0, limit).map(formatDocument), hasMore: docs.length > limit };
      }
      default:
        throw new UserFacingError(`${method} is not a read operation`);
    }
  }

  // ---------------------------------------------------------------- writes

  private async planWrite(coll: Collection, { method, args }: ParsedCommand, target: Target) {
    const ns = `${target.db}.${target.collection}`;
    const warnings: string[] = [];

    if (method === 'insertOne' || method === 'insertMany') {
      const count = method === 'insertOne' ? 1 : (args[0] as unknown[]).length;
      return {
        description: `${method} will insert ${plural(count, 'document')} into ${ns}.`,
        warnings,
        affected: count,
        requireTyping: count > 1,
      };
    }

    const filter = args[0] as Document;
    const emptyFilter = Object.keys(filter).length === 0;
    const matched = await coll.countDocuments(filter as Filter<Document>, { maxTimeMS: QUERY_LIMITS.maxTimeMS });
    const single = method.endsWith('One');
    const affected = single ? Math.min(matched, 1) : matched;
    const options = (args[2] ?? {}) as { upsert?: boolean };

    if (affected > WRITE_LIMITS.maxAffectedDocs) {
      throw new UserFacingError(
        `This would affect ${plural(affected, 'document')}. The limit is ${WRITE_LIMITS.maxAffectedDocs.toLocaleString('en-US')} ` +
          'because every affected document is backed up first. Narrow the filter and run it in parts.',
      );
    }
    if (emptyFilter) warnings.push('No filter: this applies to EVERY document in the collection.');
    if (single && matched > 1) warnings.push(`${plural(matched, 'document')} match, but only the first one will be changed.`);
    if (matched === 0 && options.upsert) warnings.push('No document matches, so upsert will insert a new one.');
    if (matched === 0 && !options.upsert) warnings.push('No document matches this filter; nothing will change.');

    const verb = method.startsWith('delete') ? 'delete' : method.startsWith('replace') ? 'replace' : 'modify';
    return {
      description: `${method} will ${verb} ${single ? '' : 'up to '}${plural(affected, 'document')} in ${ns}.`,
      warnings,
      affected,
      requireTyping: !single || emptyFilter || affected > 1,
    };
  }

  private async executeWrite(coll: Collection, { method, args }: ParsedCommand, target: Target): Promise<CommandResponse> {
    switch (method) {
      case 'insertOne':
      case 'insertMany': {
        const docs = withIds((method === 'insertOne' ? [args[0]] : (args[0] as unknown[])) as Document[]);
        const { backup, insertedCount } = await this.insertWithBackup(coll, target, method, docs);
        return { kind: 'written', method, summary: `Inserted ${plural(insertedCount, 'document')}.`, backupId: backup.id };
      }

      case 'updateOne':
      case 'replaceOne':
      case 'deleteOne': {
        const filter = args[0] as Filter<Document>;
        const current = await coll.findOne(filter);
        const backup = await this.backup(target, method, current ? [current] : []);
        // Pin the write to the exact document that was backed up.
        const pinned = (current ? { _id: current._id } : filter) as Filter<Document>;
        if (method === 'deleteOne') {
          const r = await coll.deleteOne(pinned);
          return { kind: 'written', method, summary: `Deleted ${plural(r.deletedCount, 'document')}.`, backupId: backup.id };
        }
        const options = args[2] as Document | undefined;
        const r =
          method === 'updateOne'
            ? await coll.updateOne(pinned, args[1] as Document, options)
            : await coll.replaceOne(pinned, args[1] as Document, options);
        if (r.upsertedId != null) await this.backups.appendInserted(backup, [r.upsertedId]);
        return { kind: 'written', method, summary: this.updateSummary(r), backupId: backup.id };
      }

      case 'updateMany':
      case 'deleteMany': {
        const filter = args[0] as Filter<Document>;
        const affected = await coll.find(filter, { limit: WRITE_LIMITS.maxAffectedDocs + 1 }).toArray();
        if (affected.length > WRITE_LIMITS.maxAffectedDocs) {
          throw new UserFacingError('Too many documents now match this filter. Preview it again.');
        }
        const backup = await this.backup(target, method, affected);
        // Only touch the documents that were backed up (documents matching later are left alone).
        const pinned = (
          affected.length > 0 ? { $and: [filter, { _id: { $in: affected.map((d) => d._id) } }] } : filter
        ) as Filter<Document>;
        if (method === 'deleteMany') {
          const r = await coll.deleteMany(pinned);
          return { kind: 'written', method, summary: `Deleted ${plural(r.deletedCount, 'document')}.`, backupId: backup.id };
        }
        const r = await coll.updateMany(pinned, args[1] as Document, args[2] as Document | undefined);
        if (r.upsertedId != null) await this.backups.appendInserted(backup, [r.upsertedId]);
        return { kind: 'written', method, summary: this.updateSummary(r), backupId: backup.id };
      }

      default:
        throw new UserFacingError(`${method} is not a write operation`);
    }
  }

  private updateSummary(r: { matchedCount: number; modifiedCount: number; upsertedCount: number }): string {
    const parts = [`Matched ${plural(r.matchedCount, 'document')}, modified ${r.modifiedCount.toLocaleString('en-US')}`];
    if (r.upsertedCount) parts.push(`inserted ${r.upsertedCount} (upsert)`);
    return `${parts.join(', ')}.`;
  }

  // ---------------------------------------------------------------- helpers

  private async assertConnectionExists(connectionId: string): Promise<void> {
    if (!(await this.store.get(connectionId))) throw new UserFacingError('Connection not found', 404);
  }

  private collectionOf(target: Pick<Target, 'connectionId' | 'db' | 'collection'>): Promise<Collection> {
    return this.getCollection(target.connectionId, target.db, target.collection);
  }

  private async loadUnchanged(coll: Collection, _id: unknown, version: string): Promise<Document> {
    const current = await coll.findOne({ _id } as Filter<Document>);
    if (!current) throw new UserFacingError('This document no longer exists. Refresh the results.', 404);
    if (documentVersion(current) !== version) {
      throw new UserFacingError('This document was changed since you loaded it. Refresh and try again.', 409);
    }
    return current;
  }

  private backup(target: Target, operation: string, before: Document[], insertedIds: unknown[] = []): Promise<BackupRecord> {
    return this.backups.create({ ...target, operation, before, insertedIds });
  }
}
