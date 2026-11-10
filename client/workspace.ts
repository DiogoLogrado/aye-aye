// Session restore: turns open tabs into a saved workspace and back, and saves it shortly after
// every change. Restoring never runs anything: restored tabs wait for Run.
import { WORKSPACE_LIMITS as L, type TabState, type Workspace } from '../shared/workspace';
import { OPERATORS, type FilterRow, type Join } from './queryBuilder';

export type { TabState, Workspace };

declare global {
  interface Window {
    /** Called by the desktop app before it closes, so the last edits are saved. */
    ayeAyeFlushWorkspace?: () => Promise<void>;
  }
}

/** The parts of an open tab the workspace needs (a subset of App's TabInfo). */
export interface OpenTab {
  key: string;
  connectionId: string;
  db: string;
  collection: string;
  initial?: TabState;
}

export const defaultTabState = (): TabState => ({
  mode: 'builder',
  rows: [],
  raw: '',
  rawEdited: false,
  sortId: 'newest',
  limit: 20,
});

const OPERATOR_IDS = new Set<string>(OPERATORS.map((o) => o.value));
const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * Makes any input a valid TabState: whatever is missing, malformed or too long falls back to
 * defaults or is cut, so a damaged file can never break a tab.
 */
export function cleanTabState(input: unknown): TabState {
  const s = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const rows = Array.isArray(s.rows) ? s.rows : [];
  const limit = typeof s.limit === 'number' && Number.isInteger(s.limit) && s.limit >= 1 && s.limit <= 1000 ? s.limit : 20;
  return {
    mode: s.mode === 'raw' ? 'raw' : 'builder',
    rows: rows.slice(0, L.maxRows).map((r: unknown) => {
      const row = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
      return {
        join: row.join === 'or' ? 'or' : 'and',
        field: str(row.field, L.maxFieldLength),
        op: typeof row.op === 'string' && OPERATOR_IDS.has(row.op) ? row.op : 'eq',
        value: str(row.value, L.maxValueLength),
      };
    }),
    raw: str(s.raw, L.maxRawLength),
    rawEdited: s.rawEdited === true,
    sortId: str(s.sortId, 20) || 'newest',
    limit,
  };
}

/** Builder rows for a tab, with fresh ids; always at least one (empty) row. */
export function rowsFromState(state: TabState): FilterRow[] {
  const rows = state.rows.map((r) => ({
    id: crypto.randomUUID(),
    join: r.join as Join,
    field: r.field,
    op: r.op as FilterRow['op'],
    value: r.value,
  }));
  return rows.length > 0 ? rows : [{ id: crypto.randomUUID(), join: 'and', field: '', op: 'eq', value: '' }];
}

/** The workspace to save for these tabs. Tabs beyond the limit aren't saved. */
export function buildWorkspace(tabs: OpenTab[], activeKey: string | null, states: Map<string, TabState>): Workspace {
  const saved = tabs.slice(0, L.maxTabs);
  return {
    version: 1,
    activeIndex: Math.max(0, saved.findIndex((t) => t.key === activeKey)),
    tabs: saved.map((t) => ({
      connectionId: t.connectionId,
      db: t.db,
      collection: t.collection,
      state: cleanTabState(states.get(t.key) ?? t.initial ?? defaultTabState()),
    })),
  };
}

export interface RestoredTab {
  connectionId: string;
  db: string;
  collection: string;
  state: TabState;
}

/**
 * The tabs to reopen from a saved workspace. Tabs of connections that no longer exist are
 * dropped; the active tab falls back to the closest remaining one.
 */
export function restoreWorkspace(
  workspace: Workspace | null | undefined,
  connectionIds: ReadonlySet<string>,
): { tabs: RestoredTab[]; activeIndex: number } {
  const saved = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  const wantedActive = typeof workspace?.activeIndex === 'number' ? workspace.activeIndex : 0;
  const tabs: RestoredTab[] = [];
  let activeIndex = 0;
  saved.forEach((tab, index) => {
    if (typeof tab !== 'object' || tab === null) return;
    const { connectionId, db, collection } = tab;
    if (typeof connectionId !== 'string' || !connectionIds.has(connectionId)) return;
    if (typeof db !== 'string' || db === '' || typeof collection !== 'string' || collection === '') return;
    if (index <= wantedActive) activeIndex = tabs.length;
    tabs.push({ connectionId, db, collection, state: cleanTabState(tab.state) });
  });
  return { tabs, activeIndex };
}

export interface WorkspaceSaver {
  /** Saves are off until the saved workspace has been read, so it's never overwritten blindly. */
  enable(): void;
  /** Save a moment after the last change. */
  schedule(): void;
  /** Save now (if anything changed); resolves when written. */
  flush(): Promise<void>;
  /** Save now with a request that outlives the page (page reload or close). */
  flushOnUnload(): void;
}

/**
 * Saves `build()` shortly after changes, one save at a time, skipping saves when nothing changed.
 * A failed save is retried with the next change.
 */
export function createWorkspaceSaver(
  build: () => Workspace,
  save: (workspace: Workspace, keepalive: boolean) => Promise<void>,
  delayMs = 500,
): WorkspaceSaver {
  let enabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = '';
  let queue: Promise<void> = Promise.resolve();

  const pending = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!enabled) return undefined;
    const workspace = build();
    const json = JSON.stringify(workspace);
    if (json === lastSaved) return undefined;
    lastSaved = json;
    return workspace;
  };

  const flush = () => {
    const workspace = pending();
    if (workspace) {
      queue = queue
        .then(() => save(workspace, false))
        .catch(() => {
          lastSaved = ''; // try again next time
        });
    }
    return queue;
  };

  return {
    enable: () => {
      enabled = true;
    },
    schedule: () => {
      if (!enabled) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    flushOnUnload: () => {
      const workspace = pending();
      if (workspace) void save(workspace, true).catch(() => undefined);
    },
  };
}
