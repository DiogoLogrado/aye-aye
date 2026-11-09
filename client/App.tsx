import { Table2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, errorMessage, type ConnectionInfo } from './api';
import { CollectionTab } from './components/CollectionTab';
import { Resizer } from './components/Resizer';
import { Sidebar } from './components/Sidebar';
import { TitleBar, desktopBridge } from './components/TitleBar';
import { usePersistentNumber } from './usePersistentNumber';

const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 700;

export interface TabInfo {
  key: string;
  connectionId: string;
  connectionName: string;
  db: string;
  collection: string;
  /** 1 for the first tab of a collection, 2 for the second, … (shown when > 1). */
  instance: number;
}

export interface ConnectionsState {
  loading: boolean;
  error?: string;
  data?: ConnectionInfo[];
}

export function App() {
  const [connections, setConnections] = useState<ConnectionsState>({ loading: true });
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const reloadConnections = useCallback(async () => {
    setConnections((c) => ({ ...c, loading: true }));
    try {
      setConnections({ loading: false, data: await api.listConnections() });
    } catch (e) {
      setConnections({ loading: false, error: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void reloadConnections();
  }, [reloadConnections]);

  // Every click opens a new tab, so the same collection can be inspected with different queries side by side.
  const openCollection = useCallback((connection: ConnectionInfo, db: string, collection: string) => {
    const key = `${connection.id}/${db}/${collection}#${crypto.randomUUID()}`;
    setTabs((current) => {
      const sameCollection = current.filter(
        (t) => t.connectionId === connection.id && t.db === db && t.collection === collection,
      );
      const instance = Math.max(0, ...sameCollection.map((t) => t.instance)) + 1;
      return [...current, { key, connectionId: connection.id, connectionName: connection.name, db, collection, instance }];
    });
    setActiveKey(key);
  }, []);

  const closeTab = useCallback((key: string) => {
    setTabs((current) => {
      const index = current.findIndex((t) => t.key === key);
      const next = current.filter((t) => t.key !== key);
      setActiveKey((active) => (active === key ? (next[Math.min(index, next.length - 1)]?.key ?? null) : active));
      return next;
    });
  }, []);

  const closeConnectionTabs = useCallback((connectionId: string) => {
    setTabs((current) => {
      const next = current.filter((t) => t.connectionId !== connectionId);
      setActiveKey((active) => (next.some((t) => t.key === active) ? active : (next[0]?.key ?? null)));
      return next;
    });
  }, []);

  const sidebarWidth = usePersistentNumber('sidebarWidth', SIDEBAR_DEFAULT_WIDTH);
  // Keep at least ~420px for the results, however wide the window is.
  const sidebarMax = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 420));

  return (
    <div className="app-shell">
      {desktopBridge && <TitleBar bridge={desktopBridge} />}
      <div className="layout" style={{ '--sidebar-width': `${Math.min(sidebarWidth.value, sidebarMax)}px` } as CSSProperties}>
        <Sidebar
          connections={connections}
          onReloadConnections={reloadConnections}
          onOpenCollection={openCollection}
          onConnectionRemoved={closeConnectionTabs}
        />
        <Resizer
          label="Resize sidebar"
          value={Math.min(sidebarWidth.value, sidebarMax)}
          min={SIDEBAR_MIN_WIDTH}
          max={sidebarMax}
          defaultValue={SIDEBAR_DEFAULT_WIDTH}
          onChange={sidebarWidth.set}
          onCommit={sidebarWidth.persist}
        />
        <main className="main">
          {tabs.length === 0 ? (
            <div className="empty-state">
              <h2>Aye-aye</h2>
              <p>Pick a collection on the left to see its latest documents.</p>
            </div>
          ) : (
            <>
              <nav className="tabs" role="tablist">
                {tabs.map((tab) => (
                  <div
                    key={tab.key}
                    role="tab"
                    aria-selected={tab.key === activeKey}
                    className={`tab ${tab.key === activeKey ? 'active' : ''}`}
                    title={`${tab.connectionName} › ${tab.db} › ${tab.collection}`}
                    onClick={() => setActiveKey(tab.key)}
                    onAuxClick={(e) => e.button === 1 && closeTab(tab.key)}
                  >
                    <Table2 className="node-icon" />
                    <span>{tab.collection}</span>
                    {tab.instance > 1 && <span className="tab-instance">{tab.instance}</span>}
                    <button
                      className="tab-close"
                      aria-label={`Close ${tab.collection}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.key);
                      }}
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </nav>
              {/* Tabs stay mounted so switching keeps each tab's filters and results. */}
              {tabs.map((tab) => (
                <CollectionTab key={tab.key} tab={tab} active={tab.key === activeKey} />
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
