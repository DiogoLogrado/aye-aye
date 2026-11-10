import { Table2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, errorMessage, type ConnectionInfo } from './api';
import { CollectionTab } from './components/CollectionTab';
import { Resizer } from './components/Resizer';
import { Sidebar } from './components/Sidebar';
import { TabErrorBoundary } from './components/TabErrorBoundary';
import { TitleBar, desktopBridge } from './components/TitleBar';
import { usePersistentNumber } from './usePersistentNumber';
import { buildWorkspace, createWorkspaceSaver, restoreWorkspace, type TabState } from './workspace';

/** How many closed tabs Ctrl+Shift+T can bring back. */
const MAX_CLOSED_TABS = 20;

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
  /** The query to start from (restored or reopened tabs). */
  initial?: TabState;
  /** Restored or reopened: nothing runs until the user clicks Run. */
  deferred?: boolean;
}

interface ClosedTab {
  connectionId: string;
  db: string;
  collection: string;
  state?: TabState;
}

const newTabKey = (connectionId: string, db: string, collection: string) =>
  `${connectionId}/${db}/${collection}#${crypto.randomUUID()}`;

const sameCollection = (a: Pick<TabInfo, 'connectionId' | 'db' | 'collection'>, b: typeof a) =>
  a.connectionId === b.connectionId && a.db === b.db && a.collection === b.collection;

/** Next instance number for a new tab of this collection. */
const nextInstance = (tabs: TabInfo[], target: Pick<TabInfo, 'connectionId' | 'db' | 'collection'>) =>
  Math.max(0, ...tabs.filter((t) => sameCollection(t, target)).map((t) => t.instance)) + 1;

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

  // ---- Session restore: tabs and their queries are saved continuously and reopened on start.

  const tabsRef = useRef(tabs);
  const activeKeyRef = useRef(activeKey);
  /** Latest query of every open tab, as reported by the tabs. */
  const tabStates = useRef(new Map<string, TabState>());
  const closedTabs = useRef<ClosedTab[]>([]);
  const connectionsRef = useRef<ConnectionInfo[]>([]);
  connectionsRef.current = connections.data ?? connectionsRef.current;

  const [saver] = useState(() =>
    createWorkspaceSaver(
      () => buildWorkspace(tabsRef.current, activeKeyRef.current, tabStates.current),
      (workspace, keepalive) => api.saveWorkspace(workspace, keepalive),
    ),
  );

  useEffect(() => {
    tabsRef.current = tabs;
    activeKeyRef.current = activeKey;
    saver.schedule();
  }, [tabs, activeKey, saver]);

  const onTabStateChange = useCallback(
    (key: string, state: TabState) => {
      tabStates.current.set(key, state);
      saver.schedule();
    },
    [saver],
  );

  // Save before the page goes away: on reload or close in a browser, and when the desktop app quits.
  useEffect(() => {
    const onPageHide = () => saver.flushOnUnload();
    window.addEventListener('pagehide', onPageHide);
    window.ayeAyeFlushWorkspace = () => saver.flush();
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      delete window.ayeAyeFlushWorkspace;
    };
  }, [saver]);

  // Reopen the saved tabs once the connections are known. Saving starts only after the saved
  // workspace was read, so a failed read never overwrites it with an empty one.
  const restoreStarted = useRef(false);
  useEffect(() => {
    const known = connections.data;
    if (!known || restoreStarted.current) return;
    restoreStarted.current = true;
    api
      .getWorkspace()
      .then(({ workspace }) => {
        const restored = restoreWorkspace(workspace, new Set(known.map((c) => c.id)));
        if (restored.tabs.length > 0) {
          const names = new Map(known.map((c) => [c.id, c.name]));
          const opened: TabInfo[] = [];
          for (const t of restored.tabs) {
            opened.push({
              key: newTabKey(t.connectionId, t.db, t.collection),
              connectionId: t.connectionId,
              connectionName: names.get(t.connectionId) ?? '',
              db: t.db,
              collection: t.collection,
              instance: nextInstance(opened, t),
              initial: t.state,
              deferred: true,
            });
          }
          // Tabs opened while this was loading stay, after the restored ones.
          setTabs((current) =>
            current.reduce((all, t) => [...all, { ...t, instance: nextInstance(all, t) }], opened),
          );
          setActiveKey((current) => current ?? opened[restored.activeIndex]?.key ?? null);
        }
        saver.enable();
        saver.schedule();
      })
      .catch(() => {
        // Saved tabs couldn't be read: leave them untouched (no saving this session).
      });
  }, [connections.data, saver]);

  // Every click opens a new tab, so the same collection can be inspected with different queries side by side.
  const openCollection = useCallback(
    (connection: ConnectionInfo, db: string, collection: string, reopen?: { state?: TabState }) => {
      const key = newTabKey(connection.id, db, collection);
      setTabs((current) => [
        ...current,
        {
          key,
          connectionId: connection.id,
          connectionName: connection.name,
          db,
          collection,
          instance: nextInstance(current, { connectionId: connection.id, db, collection }),
          ...(reopen ? { initial: reopen.state, deferred: true } : {}),
        },
      ]);
      setActiveKey(key);
    },
    [],
  );

  const closeTab = useCallback((key: string) => {
    const closing = tabsRef.current.find((t) => t.key === key);
    if (closing) {
      const { connectionId, db, collection } = closing;
      closedTabs.current = [
        ...closedTabs.current.slice(1 - MAX_CLOSED_TABS),
        { connectionId, db, collection, state: tabStates.current.get(key) ?? closing.initial },
      ];
    }
    tabStates.current.delete(key);
    setTabs((current) => {
      const index = current.findIndex((t) => t.key === key);
      const next = current.filter((t) => t.key !== key);
      setActiveKey((active) => (active === key ? (next[Math.min(index, next.length - 1)]?.key ?? null) : active));
      return next;
    });
  }, []);

  /** Ctrl+Shift+T: reopens the last closed tab with its query (not run). */
  const reopenClosedTab = useCallback(() => {
    while (closedTabs.current.length > 0) {
      const closed = closedTabs.current[closedTabs.current.length - 1];
      closedTabs.current = closedTabs.current.slice(0, -1);
      const connection = closed && connectionsRef.current.find((c) => c.id === closed.connectionId);
      if (closed && connection) {
        openCollection(connection, closed.db, closed.collection, { state: closed.state });
        return;
      }
    }
  }, [openCollection]);

  useEffect(() => {
    const onMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'reopen-tab') reopenClosedTab();
    };
    window.addEventListener('aye-aye:menu', onMenu);
    return () => window.removeEventListener('aye-aye:menu', onMenu);
  }, [reopenClosedTab]);

  const closeConnectionTabs = useCallback((connectionId: string) => {
    for (const t of tabsRef.current) if (t.connectionId === connectionId) tabStates.current.delete(t.key);
    closedTabs.current = closedTabs.current.filter((t) => t.connectionId !== connectionId);
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
                <TabErrorBoundary key={tab.key} hidden={tab.key !== activeKey} onClose={() => closeTab(tab.key)}>
                  <CollectionTab tab={tab} active={tab.key === activeKey} onStateChange={onTabStateChange} />
                </TabErrorBoundary>
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
