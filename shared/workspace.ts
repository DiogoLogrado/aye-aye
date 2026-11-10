/**
 * The open tabs and their queries, saved continuously so the next start resumes where you left off.
 * Results are not saved: restored tabs wait for Run.
 */
export interface Workspace {
  version: 1;
  tabs: WorkspaceTab[];
  /** Index of the active tab in `tabs`. */
  activeIndex: number;
}

export interface WorkspaceTab {
  connectionId: string;
  db: string;
  collection: string;
  state: TabState;
}

/** What a collection tab's query looks like: everything needed to show it again, nothing run. */
export interface TabState {
  mode: 'builder' | 'raw';
  rows: { join: 'and' | 'or'; field: string; op: string; value: string }[];
  raw: string;
  /** Whether the Raw text was edited after the Builder handed it over (Builder → Raw asks before replacing it). */
  rawEdited: boolean;
  sortId: string;
  limit: number;
}

export const WORKSPACE_LIMITS = {
  maxTabs: 50,
  maxRows: 50,
  maxFieldLength: 500,
  maxValueLength: 10_000,
  /** Same as the longest command the server accepts. */
  maxRawLength: 100_000,
} as const;
