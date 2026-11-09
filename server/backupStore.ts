import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BSON, type Document } from 'mongodb';
import { UserFacingError } from './errors';

/**
 * Every write is preceded by a backup file holding what's needed to undo it:
 * - `before`: full previous versions of modified/deleted documents (restored with upsert-replace)
 * - `insertedIds`: ids created by the write (removed on undo)
 * Files are canonical Extended JSON, so they can also be restored by hand if ever needed.
 */
export interface BackupRecord {
  id: string;
  createdAt: string;
  connectionId: string;
  db: string;
  collection: string;
  operation: string;
  before: Document[];
  insertedIds: unknown[];
  undoneAt?: string;
}

const BACKUP_ID = /^\d{13}-[0-9a-f]{8}$/;

function isBackupRecord(value: unknown): value is BackupRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    BACKUP_ID.test(r.id) &&
    typeof r.connectionId === 'string' &&
    typeof r.db === 'string' &&
    typeof r.collection === 'string' &&
    typeof r.operation === 'string' &&
    Array.isArray(r.before) &&
    Array.isArray(r.insertedIds)
  );
}

export class BackupStore {
  constructor(private readonly dir: string) {}

  async create(record: Omit<BackupRecord, 'id' | 'createdAt'>): Promise<BackupRecord> {
    const full: BackupRecord = {
      id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
      createdAt: new Date().toISOString(),
      ...record,
    };
    await this.write(full);
    return full;
  }

  async get(id: string): Promise<BackupRecord> {
    if (!BACKUP_ID.test(id)) throw new UserFacingError('Invalid backup id');
    let raw: string;
    try {
      raw = await fs.readFile(this.file(id), 'utf8');
    } catch {
      throw new UserFacingError('Backup not found', 404);
    }
    const parsed: unknown = BSON.EJSON.parse(raw, { relaxed: false });
    if (!isBackupRecord(parsed)) throw new UserFacingError('Backup file is corrupted', 500);
    return parsed;
  }

  /** Replaces the recorded inserted ids (e.g. only the documents a failed batch actually inserted). */
  async setInsertedIds(record: BackupRecord, ids: unknown[]): Promise<void> {
    record.insertedIds = [...ids];
    await this.write(record);
  }

  /** Removes a backup for a write that never happened, so it can't be "undone". */
  async discard(record: BackupRecord): Promise<void> {
    await fs.rm(this.file(record.id), { force: true });
  }

  /** Records ids created by an upsert (only known after the write). */
  async appendInserted(record: BackupRecord, ids: unknown[]): Promise<void> {
    record.insertedIds.push(...ids);
    await this.write(record);
  }

  async markUndone(record: BackupRecord): Promise<void> {
    await this.write({ ...record, undoneAt: new Date().toISOString() });
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  /** Atomic write; the backup must be durable before the database write happens. */
  private async write(record: BackupRecord): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(record.id);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, BSON.EJSON.stringify(record, undefined, 2, { relaxed: false }), 'utf8');
    await fs.rename(tmp, target);
  }
}
