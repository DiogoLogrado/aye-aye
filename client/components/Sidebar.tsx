import { Database, Eye, Plus, RotateCw, Server, Star, Table2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Caret } from './Caret';
import { api, errorMessage, type CollectionInfo, type ConnectionInfo } from '../api';
import type { ConnectionsState } from '../App';
import { usePersistentSet } from '../usePersistentSet';
import { AddConnectionDialog } from './AddConnectionDialog';
import { FavoritesSection } from './FavoritesSection';
import { useConfirm, useToast } from './feedback';

function SectionHeader(props: {
  title: string;
  icon: ReactNode;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="section-header">
      <button className="section-toggle" aria-expanded={!props.collapsed} onClick={props.onToggle}>
        <Caret open={!props.collapsed} />
        {props.icon}
        {props.title}
        {props.count !== undefined && props.count > 0 && <span className="count-badge">{props.count}</span>}
      </button>
      {props.children}
    </div>
  );
}

const favoriteKey = (connectionId: string, db: string, collection: string) => `${connectionId}/${db}/${collection}`;

interface Loadable<T> {
  loading: boolean;
  error?: string;
  data?: T;
}

interface Props {
  connections: ConnectionsState;
  onReloadConnections: () => Promise<void>;
  onOpenCollection: (connection: ConnectionInfo, db: string, collection: string) => void;
  onConnectionRemoved: (connectionId: string) => void;
}

export function Sidebar({ connections, onReloadConnections, onOpenCollection, onConnectionRemoved }: Props) {
  const [databases, setDatabases] = useState<Record<string, Loadable<string[]>>>({});
  const [collections, setCollections] = useState<Record<string, Loadable<CollectionInfo[]>>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [collapsedSections, toggleSection] = usePersistentSet('sidebar.collapsedSections');
  const confirm = useConfirm();
  const notify = useToast();

  // Desktop app: File > New connection… (the app sends a DOM event; harmless in a browser).
  useEffect(() => {
    const onMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'add-connection') setShowAdd(true);
    };
    window.addEventListener('aye-aye:menu', onMenu);
    return () => window.removeEventListener('aye-aye:menu', onMenu);
  }, []);

  const favoriteKeys = useMemo(
    () =>
      new Set(
        (connections.data ?? []).flatMap((c) => c.favorites.map((f) => favoriteKey(c.id, f.db, f.collection))),
      ),
    [connections.data],
  );

  const setFavorite = async (connection: ConnectionInfo, db: string, collection: string, favorite: boolean) => {
    try {
      await api.setFavorite(connection.id, db, collection, favorite);
      await onReloadConnections();
    } catch (e) {
      notify({ kind: 'error', message: errorMessage(e) });
    }
  };

  const loadDatabases = useCallback(async (connectionId: string) => {
    setDatabases((d) => ({ ...d, [connectionId]: { loading: true } }));
    try {
      const data = await api.listDatabases(connectionId);
      setDatabases((d) => ({ ...d, [connectionId]: { loading: false, data } }));
    } catch (e) {
      setDatabases((d) => ({ ...d, [connectionId]: { loading: false, error: errorMessage(e) } }));
    }
  }, []);

  const loadCollections = useCallback(async (connectionId: string, db: string) => {
    const key = `${connectionId}/${db}`;
    setCollections((c) => ({ ...c, [key]: { loading: true } }));
    try {
      const data = await api.listCollections(connectionId, db);
      setCollections((c) => ({ ...c, [key]: { loading: false, data } }));
    } catch (e) {
      setCollections((c) => ({ ...c, [key]: { loading: false, error: errorMessage(e) } }));
    }
  }, []);

  const toggle = (key: string, load?: () => void) => {
    const opening = !expanded.has(key);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });
    if (opening) load?.();
  };

  // While searching, load collection lists of every database in expanded connections so they're searchable.
  const query = search.trim().toLowerCase();
  useEffect(() => {
    if (!query) return;
    for (const [connectionId, dbs] of Object.entries(databases)) {
      if (!expanded.has(connectionId)) continue;
      for (const db of dbs.data ?? []) {
        if (!collections[`${connectionId}/${db}`]) void loadCollections(connectionId, db);
      }
    }
  }, [query, databases, expanded, collections, loadCollections]);

  const removeConnection = async (connection: ConnectionInfo) => {
    const ok = await confirm({
      title: `Remove "${connection.name}"?`,
      body: <p>The saved connection string will be deleted from Windows Credential Manager. Your database is not affected.</p>,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeConnection(connection.id);
      onConnectionRemoved(connection.id);
      await onReloadConnections();
    } catch (e) {
      notify({ kind: 'error', message: errorMessage(e) });
    }
  };

  const matches = (name: string) => name.toLowerCase().includes(query);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <input
          className="search"
          type="search"
          placeholder="Search databases & collections"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => setShowAdd(true)} title="Add connection">
          <Plus /> Connection
        </button>
      </div>

      <div className="tree">
        <SectionHeader
          title="Favorites"
          icon={<Star className="section-icon star-icon" />}
          count={favoriteKeys.size}
          collapsed={collapsedSections.has('favorites')}
          onToggle={() => toggleSection('favorites')}
        />
        {!collapsedSections.has('favorites') && (
          <div className="section-body">
            <FavoritesSection
              connections={connections.data ?? []}
              query={query}
              onOpen={onOpenCollection}
              onUnstar={(connection, db, collection) => void setFavorite(connection, db, collection, false)}
            />
          </div>
        )}

        <SectionHeader
          title="Connections"
          icon={<Server className="section-icon" />}
          count={connections.data?.length}
          collapsed={collapsedSections.has('connections')}
          onToggle={() => toggleSection('connections')}
        />
        {!collapsedSections.has('connections') && (
          <div className="section-body">
            {connections.loading && <div className="tree-note">Loading…</div>}
            {connections.error && <div className="tree-error">{connections.error}</div>}
            {connections.data?.length === 0 && (
              <div className="tree-note">No connections yet. Click "Connection" above to add one.</div>
            )}

            {connections.data?.map((connection) => {
              const connOpen = expanded.has(connection.id);
              const dbs = databases[connection.id];
              return (
                <div key={connection.id}>
                  <div className="node node-connection">
                    <button className="node-label" onClick={() => toggle(connection.id, () => void loadDatabases(connection.id))}>
                      <Caret open={connOpen} />
                      <Server className="node-icon" />
                      <span className="node-name">{connection.name}</span>
                      <span className="node-meta">{connection.hosts.join(', ')}</span>
                    </button>
                    <button
                      className="icon-btn"
                      title="Reload databases"
                      aria-label="Reload databases"
                      onClick={() => void loadDatabases(connection.id)}
                    >
                      <RotateCw />
                    </button>
                    <button
                      className="icon-btn"
                      title="Remove connection"
                      aria-label="Remove connection"
                      onClick={() => void removeConnection(connection)}
                    >
                      <X />
                    </button>
                  </div>

                  {connOpen && (
                    <div className="children">
                      {dbs?.loading && <div className="tree-note">Loading…</div>}
                      {dbs?.error && <div className="tree-error">{dbs.error}</div>}
                      {dbs?.data?.map((db) => {
                        const dbKey = `${connection.id}/${db}`;
                        const colls = collections[dbKey];
                        const visibleColls = query && !matches(db) ? colls?.data?.filter((c) => matches(c.name)) : colls?.data;
                        if (query && !matches(db) && !visibleColls?.length) return null;
                        const dbOpen = expanded.has(dbKey) || (query !== '' && !!visibleColls?.length);
                        return (
                          <div key={db}>
                            <div className="node">
                              <button
                                className="node-label"
                                onClick={() => toggle(dbKey, () => !colls?.data && void loadCollections(connection.id, db))}
                              >
                                <Caret open={dbOpen} />
                                <Database className="node-icon" />
                                <span className="node-name">{db}</span>
                              </button>
                            </div>
                            {dbOpen && (
                              <div className="children">
                                {colls?.loading && <div className="tree-note">Loading…</div>}
                                {colls?.error && <div className="tree-error">{colls.error}</div>}
                                {colls?.data?.length === 0 && <div className="tree-note">No collections</div>}
                                {visibleColls?.map((c) => {
                                  const starred = favoriteKeys.has(favoriteKey(connection.id, db, c.name));
                                  return (
                                    <div key={c.name} className="node">
                                      <button
                                        className="node-label leaf"
                                        title={c.type === 'view' ? `${c.name} (view)` : c.name}
                                        onClick={() => onOpenCollection(connection, db, c.name)}
                                      >
                                        {c.type === 'view' ? <Eye className="node-icon" /> : <Table2 className="node-icon" />}
                                        <span className="node-name">{c.name}</span>
                                        {c.type !== 'collection' && <span className="node-meta">{c.type}</span>}
                                      </button>
                                      <button
                                        className={`icon-btn star ${starred ? 'on' : ''}`}
                                        title={starred ? 'Remove from favorites' : 'Add to favorites'}
                                        aria-label={starred ? `Remove ${c.name} from favorites` : `Add ${c.name} to favorites`}
                                        aria-pressed={starred}
                                        onClick={() => void setFavorite(connection, db, c.name, !starred)}
                                      >
                                        <Star />

                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <AddConnectionDialog
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            void onReloadConnections();
          }}
        />
      )}
    </aside>
  );
}
