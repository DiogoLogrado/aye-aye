import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncEntry } from '@napi-rs/keyring';
import { MongoClient } from 'mongodb';
import { z } from 'zod';
import { APP_NAME } from './config';
import { UserFacingError } from './errors';

/** Non-secret metadata. The connection string itself is only ever stored in the OS keychain. */
export interface ConnectionMeta {
  id: string;
  name: string;
  hosts: string[];
  createdAt: string;
  /** Starred collections, shown in the sidebar's Favorites section. */
  favorites: FavoriteCollection[];
}

export interface FavoriteCollection {
  db: string;
  collection: string;
}

export const MAX_FAVORITES_PER_CONNECTION = 500;

export interface ConnectionStore {
  list(): Promise<ConnectionMeta[]>;
  get(id: string): Promise<ConnectionMeta | undefined>;
  getUri(id: string): Promise<string>;
  add(name: string, uri: string): Promise<ConnectionMeta>;
  remove(id: string): Promise<void>;
  setFavorite(id: string, favorite: FavoriteCollection, isFavorite: boolean): Promise<ConnectionMeta>;
}

/** Adds or removes a favorite; idempotent, keeps insertion order, enforces the cap. */
export function applyFavorite(
  favorites: FavoriteCollection[],
  favorite: FavoriteCollection,
  isFavorite: boolean,
): FavoriteCollection[] {
  const same = (f: FavoriteCollection) => f.db === favorite.db && f.collection === favorite.collection;
  const without = favorites.filter((f) => !same(f));
  if (!isFavorite) return without;
  if (without.length >= MAX_FAVORITES_PER_CONNECTION) {
    throw new UserFacingError(`You can have up to ${MAX_FAVORITES_PER_CONNECTION} favorites per connection.`);
  }
  return [...without, { db: favorite.db, collection: favorite.collection }];
}

const metaFileSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    hosts: z.array(z.string()),
    createdAt: z.string(),
    // Absent in files written by earlier versions. Unknown keys from older versions are dropped.
    favorites: z.array(z.object({ db: z.string(), collection: z.string() })).default([]),
  }),
);

/** Validates a connection string and extracts the credential-free parts we can display. */
export function describeUri(uri: string): { hosts: string[]; defaultDatabase: string | undefined } {
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new UserFacingError('Connection string must start with mongodb:// or mongodb+srv://');
  }
  try {
    // Constructing a client only parses and validates the string; it does not connect.
    const { hosts, dbName, srvHost } = new MongoClient(uri).options;
    return {
      hosts: srvHost ? [srvHost] : hosts.map((h) => h.toString()),
      // The driver defaults dbName to "test" when the URI has no path; treat that as "none".
      defaultDatabase: /^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/i.test(uri) ? dbName : undefined,
    };
  } catch {
    // Never echo the parser's message: it can contain the connection string.
    throw new UserFacingError('Connection string is not valid');
  }
}

const KEYRING_SERVICE = APP_NAME;

export class KeyringConnectionStore implements ConnectionStore {
  private readonly file: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'connections.json');
  }

  async list(): Promise<ConnectionMeta[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return metaFileSchema.parse(JSON.parse(raw));
  }

  async get(id: string): Promise<ConnectionMeta | undefined> {
    return (await this.list()).find((c) => c.id === id);
  }

  async getUri(id: string): Promise<string> {
    const uri = await new AsyncEntry(KEYRING_SERVICE, id).getPassword().catch(() => undefined);
    if (!uri) {
      throw new UserFacingError('Credentials for this connection are missing from the OS keychain. Remove and re-add it.', 404);
    }
    return uri;
  }

  add(name: string, uri: string): Promise<ConnectionMeta> {
    return this.serialized(async () => {
      const { hosts } = describeUri(uri);
      const meta: ConnectionMeta = {
        id: randomUUID(),
        name,
        hosts,
        createdAt: new Date().toISOString(),
        favorites: [],
      };
      const entry = new AsyncEntry(KEYRING_SERVICE, meta.id);
      await entry.setPassword(uri);
      try {
        await this.write([...(await this.list()), meta]);
      } catch (error) {
        await entry.deleteCredential().catch(() => false);
        throw error;
      }
      return meta;
    });
  }

  remove(id: string): Promise<void> {
    return this.serialized(async () => {
      await this.write((await this.list()).filter((c) => c.id !== id));
      await new AsyncEntry(KEYRING_SERVICE, id).deleteCredential().catch(() => false);
    });
  }

  setFavorite(id: string, favorite: FavoriteCollection, isFavorite: boolean): Promise<ConnectionMeta> {
    return this.serialized(async () => {
      const connections = await this.list();
      const target = connections.find((c) => c.id === id);
      if (!target) throw new UserFacingError('Connection not found', 404);
      target.favorites = applyFavorite(target.favorites, favorite, isFavorite);
      await this.write(connections);
      return target;
    });
  }

  /** Atomic write: temp file + rename, so a crash never leaves a half-written file. */
  private async write(connections: ConnectionMeta[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(connections, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, this.file);
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}
