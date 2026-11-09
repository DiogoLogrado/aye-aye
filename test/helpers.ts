import { BSON, type Collection, type Document } from 'mongodb';
import { applyFavorite, type ConnectionMeta, type ConnectionStore, type FavoriteCollection } from '../server/connectionStore';

export class MemoryStore implements ConnectionStore {
  readonly items: (ConnectionMeta & { uri: string })[] = [];

  async list() {
    return this.items.map(({ uri: _uri, ...meta }) => meta);
  }
  async get(id: string) {
    return (await this.list()).find((c) => c.id === id);
  }
  async getUri(id: string) {
    return this.items.find((c) => c.id === id)?.uri ?? '';
  }
  async add(name: string, uri: string) {
    const meta = {
      id: crypto.randomUUID(),
      name,
      hosts: ['db.example.com:27017'],
      createdAt: new Date().toISOString(),
      favorites: [] as FavoriteCollection[],
    };
    this.items.push({ ...meta, uri });
    return meta;
  }
  async setFavorite(id: string, favorite: FavoriteCollection, isFavorite: boolean) {
    const item = this.items.find((c) => c.id === id);
    if (!item) throw new Error('not found');
    item.favorites = applyFavorite(item.favorites, favorite, isFavorite);
    const { uri: _uri, ...meta } = item;
    return meta;
  }
  async remove(id: string) {
    this.items.splice(this.items.findIndex((c) => c.id === id), 1);
  }
}

const canonical = (v: unknown) => BSON.EJSON.stringify({ v }, { relaxed: false });
const clone = (doc: Document): Document => BSON.deserialize(BSON.serialize(doc));

/** Minimal filter matcher: equality, $in, $and. Enough to exercise WriteService's logic. */
function matches(doc: Document, filter: Document): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return (cond as Document[]).every((f) => matches(doc, f));
    const value = doc[key];
    if (cond !== null && typeof cond === 'object' && '$in' in cond) {
      return (cond.$in as unknown[]).some((x) => canonical(x) === canonical(value));
    }
    return canonical(value) === canonical(cond);
  });
}

function applySet(doc: Document, update: Document): boolean {
  const set = (update.$set ?? {}) as Document;
  let changed = false;
  for (const [k, v] of Object.entries(set)) {
    if (canonical(doc[k]) !== canonical(v)) changed = true;
    doc[k] = v;
  }
  return changed;
}

/**
 * In-memory stand-in for a driver Collection, implementing only what WriteService uses.
 * `log` records every mutating call, so tests can assert what reached the "database".
 */
export class FakeCollection {
  readonly log: string[] = [];

  constructor(public docs: Document[]) {}

  asCollection(): Collection {
    return this as unknown as Collection;
  }

  async findOne(filter: Document) {
    const doc = this.docs.find((d) => matches(d, filter));
    return doc ? clone(doc) : null;
  }

  find(filter: Document, options: { limit?: number } = {}) {
    const found = this.docs.filter((d) => matches(d, filter)).slice(0, options.limit || undefined);
    return { toArray: async () => found.map(clone) };
  }

  async countDocuments(filter: Document) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  async replaceOne(filter: Document, replacement: Document) {
    this.log.push('replaceOne');
    const index = this.docs.findIndex((d) => matches(d, filter));
    if (index === -1) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
    this.docs[index] = clone(replacement);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
  }

  async updateOne(filter: Document, update: Document) {
    this.log.push('updateOne');
    const doc = this.docs.find((d) => matches(d, filter));
    const changed = doc ? applySet(doc, update) : false;
    return { matchedCount: doc ? 1 : 0, modifiedCount: changed ? 1 : 0, upsertedCount: 0, upsertedId: null };
  }

  async updateMany(filter: Document, update: Document) {
    this.log.push('updateMany');
    let matched = 0;
    let modified = 0;
    for (const doc of this.docs.filter((d) => matches(d, filter))) {
      matched++;
      if (applySet(doc, update)) modified++;
    }
    return { matchedCount: matched, modifiedCount: modified, upsertedCount: 0, upsertedId: null };
  }

  async deleteOne(filter: Document) {
    this.log.push('deleteOne');
    const index = this.docs.findIndex((d) => matches(d, filter));
    if (index !== -1) this.docs.splice(index, 1);
    return { deletedCount: index === -1 ? 0 : 1 };
  }

  async deleteMany(filter: Document) {
    this.log.push('deleteMany');
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  async insertOne(doc: Document) {
    this.log.push('insertOne');
    if (this.docs.some((d) => canonical(d._id) === canonical(doc._id))) throw new Error('E11000 duplicate key');
    this.docs.push(clone(doc));
    return { insertedId: doc._id };
  }

  /** Ordered insert like MongoDB: stops at the first duplicate _id, reporting how many went in. */
  async insertMany(docs: Document[]) {
    this.log.push('insertMany');
    let insertedCount = 0;
    for (const doc of docs) {
      if (this.docs.some((d) => canonical(d._id) === canonical(doc._id))) {
        throw Object.assign(new Error('E11000 duplicate key'), { insertedCount });
      }
      this.docs.push(clone(doc));
      insertedCount++;
    }
    return { insertedCount };
  }

  async bulkWrite(ops: { replaceOne: { filter: Document; replacement: Document } }[]) {
    this.log.push('bulkWrite');
    for (const { replaceOne } of ops) {
      const index = this.docs.findIndex((d) => matches(d, replaceOne.filter));
      if (index === -1) this.docs.push(clone(replaceOne.replacement));
      else this.docs[index] = clone(replaceOne.replacement);
    }
    return {};
  }
}
