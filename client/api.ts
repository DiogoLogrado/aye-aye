import type { ViewNode } from '../shared/viewNode';

export type { ViewNode };

export interface ConnectionInfo {
  id: string;
  name: string;
  hosts: string[];
  favorites: { db: string; collection: string }[];
}

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

export type CommandResponse = { durationMs: number } & (
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
  | { kind: 'written'; method: string; summary: string; backupId?: string }
);

export interface CollectionInfo {
  name: string;
  type: string;
}

export interface FieldInfo {
  path: string;
  types: string[];
}

export interface FormattedDocument {
  /** Shell-syntax text, used for copy to clipboard. */
  text: string;
  summary: string;
  tree: ViewNode;
  /** Lossless _id for edit/delete; absent when the document has no _id. */
  id?: string;
  /** Content fingerprint; the server refuses edits if the document changed since. */
  version: string;
}

export interface FindRequest {
  filter: string;
  sort: { field: string; direction: 1 | -1 };
  limit: number;
  skip: number;
}

export interface FindResult {
  docs: FormattedDocument[];
  hasMore: boolean;
  /** Page size the server used (from the Builder's Show, or the command's .limit()). */
  limit: number;
  durationMs: number;
}

/** Raw mode: a full find command; `skip` is the paging offset on top of any .skip() in it. */
export interface FindCommandRequest {
  command: string;
  skip: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const token = document.querySelector<HTMLMetaElement>('meta[name="aye-aye-token"]')?.content ?? '';

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-aye-aye-token': token };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Aye-aye server is not running.', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const seg = encodeURIComponent;
const collectionPath = (connectionId: string, db: string, collection: string) =>
  `/connections/${seg(connectionId)}/databases/${seg(db)}/collections/${seg(collection)}`;

export const api = {
  listConnections: () => request<ConnectionInfo[]>('GET', '/connections'),
  addConnection: (name: string, uri: string) => request<ConnectionInfo>('POST', '/connections', { name, uri }),
  removeConnection: (id: string) => request<void>('DELETE', `/connections/${seg(id)}`),
  listDatabases: (id: string) => request<string[]>('GET', `/connections/${seg(id)}/databases`),
  listCollections: (id: string, db: string) =>
    request<CollectionInfo[]>('GET', `/connections/${seg(id)}/databases/${seg(db)}/collections`),
  sampleFields: (id: string, db: string, collection: string) =>
    request<FieldInfo[]>('GET', `${collectionPath(id, db, collection)}/fields`),
  find: (id: string, db: string, collection: string, query: FindRequest | FindCommandRequest) =>
    request<FindResult>('POST', `${collectionPath(id, db, collection)}/find`, query),

  setFavorite: (id: string, db: string, collection: string, favorite: boolean) =>
    request<ConnectionInfo>('PUT', `/connections/${seg(id)}/favorites`, { db, collection, favorite }),
  count: (t: Target, query: { filter: string } | { command: string }) =>
    request<{ count: number; estimated: boolean; durationMs: number }>(
      'POST',
      `${collectionPath(t.connectionId, t.db, t.collection)}/count`,
      query,
    ),
  insertDocument: (t: Target, document: string) =>
    request<{ backupId: string; id: string }>(
      'POST',
      `${collectionPath(t.connectionId, t.db, t.collection)}/documents/insert`,
      { document },
    ),
  replaceDocument: (t: Target, body: { id: string; version: string; document: string; dryRun: boolean }) =>
    request<{ changes: FieldChange[]; backupId?: string }>(
      'POST',
      `${collectionPath(t.connectionId, t.db, t.collection)}/documents/replace`,
      body,
    ),
  deleteDocument: (t: Target, body: { id: string; version: string }) =>
    request<{ backupId: string }>('POST', `${collectionPath(t.connectionId, t.db, t.collection)}/documents/delete`, body),
  runCommand: (t: Target, command: string, confirmToken?: string) =>
    request<CommandResponse>('POST', `${collectionPath(t.connectionId, t.db, t.collection)}/command`, {
      command,
      ...(confirmToken ? { confirmToken } : {}),
    }),
  undo: (backupId: string) => request<{ summary: string }>('POST', `/backups/${seg(backupId)}/undo`),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error');
