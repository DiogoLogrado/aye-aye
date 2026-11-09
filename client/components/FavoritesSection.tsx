import { Database, Star, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { Caret } from './Caret';
import type { ConnectionInfo } from '../api';
import { usePersistentSet } from '../usePersistentSet';

interface Props {
  connections: ConnectionInfo[];
  /** Lower-cased search text; empty when not searching. */
  query: string;
  onOpen: (connection: ConnectionInfo, db: string, collection: string) => void;
  onUnstar: (connection: ConnectionInfo, db: string, collection: string) => void;
}

interface FavoriteGroup {
  key: string;
  connection: ConnectionInfo;
  db: string;
  collections: string[];
}

/** Favorites grouped by database: one row per database, its starred collections inside. */
export function FavoritesSection({ connections, query, onOpen, onUnstar }: Props) {
  // Groups start collapsed; this remembers the ones the user opened.
  const [expanded, toggleExpanded] = usePersistentSet('favorites.expanded');

  const groups = useMemo(() => {
    const result: FavoriteGroup[] = [];
    for (const connection of connections) {
      const byDb = new Map<string, string[]>();
      for (const { db, collection } of connection.favorites) {
        byDb.set(db, [...(byDb.get(db) ?? []), collection]);
      }
      for (const [db, collections] of byDb) {
        result.push({ key: `${connection.id}/${db}`, connection, db, collections: collections.sort((a, b) => a.localeCompare(b)) });
      }
    }
    return result.sort((a, b) => a.connection.name.localeCompare(b.connection.name) || a.db.localeCompare(b.db));
  }, [connections]);

  if (groups.length === 0) {
    return <div className="tree-note">Hover a collection below and click its star to pin it here.</div>;
  }

  const showConnectionName = new Set(groups.map((g) => g.connection.id)).size > 1;
  const matches = (name: string) => name.toLowerCase().includes(query);

  const visible = groups
    .map((group) => {
      if (!query || matches(group.db)) return { group, collections: group.collections, forceOpen: false };
      const hits = group.collections.filter(matches);
      return hits.length ? { group, collections: hits, forceOpen: true } : null;
    })
    .filter((v) => v !== null);

  if (visible.length === 0) return <div className="tree-note">No favorites match.</div>;

  return (
    <>
      {visible.map(({ group, collections, forceOpen }) => {
        const open = forceOpen || expanded.has(group.key);
        return (
          <div key={group.key}>
            <div className="node">
              <button
                className="node-label"
                aria-expanded={open}
                title={`${group.connection.name} › ${group.db}`}
                onClick={() => toggleExpanded(group.key)}
              >
                <Caret open={open} />
                <Database className="node-icon" />
                <span className="node-name">{group.db}</span>
                {showConnectionName && <span className="node-meta">{group.connection.name}</span>}
                <span className="count-badge">{group.collections.length}</span>
              </button>
            </div>
            {open && (
              <div className="children">
                {collections.map((collection) => (
                  <div key={collection} className="node">
                    <button
                      className="node-label leaf"
                      title={`${group.connection.name} › ${group.db} › ${collection}`}
                      onClick={() => onOpen(group.connection, group.db, collection)}
                    >
                      <Table2 className="node-icon" />
                      <span className="node-name">{collection}</span>
                    </button>
                    <button
                      className="icon-btn star on"
                      title="Remove from favorites"
                      aria-label={`Remove ${collection} from favorites`}
                      onClick={() => onUnstar(group.connection, group.db, collection)}
                    >
                      <Star />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
