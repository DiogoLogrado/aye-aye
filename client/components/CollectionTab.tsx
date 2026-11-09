import { Play, TriangleAlert, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, type FieldInfo, type FindResult, type Target } from '../api';
import type { TabInfo } from '../App';
import { buildFindCommand, isBareFilter, isFindCommand, isWriteCommand } from '../commandText';
import { buildFilter, type FilterRow } from '../queryBuilder';
import { useConfirm, useToast, useUndoAction } from './feedback';
import { FilterBuilder, newRow } from './FilterBuilder';
import { ResultsView, type CommandResult, type TotalCount } from './ResultsView';
import { ShellCode } from './ShellCode';

const SORTS = [
  { id: 'newest', label: 'Newest first', field: '_id', direction: -1 },
  { id: 'oldest', label: 'Oldest first', field: '_id', direction: 1 },
  { id: 'updated', label: 'Last updated (updatedAt)', field: 'updatedAt', direction: -1 },
  { id: 'created', label: 'Last created (createdAt)', field: 'createdAt', direction: -1 },
] as const;

type SortId = (typeof SORTS)[number]['id'];

const LIMITS = [20, 50, 100, 200];
const NEWEST_FIRST = { field: '_id', direction: -1 } as const;

/** What the results view runs: the Builder's parts, or a full Raw find command. */
type Query = { kind: 'builder'; filter: string; sortId: SortId; limit: number } | { kind: 'raw'; command: string };

interface Request {
  query: Query;
  /** Paging offset. */
  skip: number;
  /** Bumped on every fetch (including paging). */
  nonce: number;
  /** Bumped when the result set may have changed (Run, Refresh, after writes); not when paging. */
  queryVersion: number;
}

const isEmptyFilter = (filter: string) => /^\s*(\{\s*\})?\s*$/.test(filter);
const sortById = (id: SortId) => SORTS.find((s) => s.id === id) ?? SORTS[0];

interface Props {
  tab: TabInfo;
  active: boolean;
}

export function CollectionTab({ tab, active }: Props) {
  const [mode, setMode] = useState<'builder' | 'raw'>('builder');
  const [rows, setRows] = useState<FilterRow[]>(() => [newRow()]);
  const [raw, setRaw] = useState('');
  /** The text last handed over from the Builder; Raw differing from it means the user edited it. */
  const [rawFromBuilder, setRawFromBuilder] = useState('');
  const [sortId, setSortId] = useState<SortId>('newest');
  const [limit, setLimit] = useState(20);
  const [fields, setFields] = useState<FieldInfo[]>([]);

  const [request, setRequest] = useState<Request>({
    query: { kind: 'builder', filter: '{}', sortId: 'newest', limit: 20 },
    skip: 0,
    nonce: 0,
    queryVersion: 0,
  });
  const [result, setResult] = useState<FindResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [total, setTotal] = useState<TotalCount>({ state: 'unknown' });
  const [commandResult, setCommandResult] = useState<CommandResult | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const confirm = useConfirm();
  const notify = useToast();

  const target: Target = useMemo(
    () => ({ connectionId: tab.connectionId, db: tab.db, collection: tab.collection }),
    [tab.connectionId, tab.db, tab.collection],
  );
  const fieldTypes = useMemo(() => Object.fromEntries(fields.map((f) => [f.path, f.types])), [fields]);
  const builderFilter = buildFilter(rows, fieldTypes);
  const sort = sortById(sortId);
  const builderCommand = (multiline: boolean) =>
    buildFindCommand(tab.collection, builderFilter, { field: sort.field, direction: sort.direction }, limit, multiline);
  const rawIsWrite = mode === 'raw' && isWriteCommand(raw);

  // Sample field names once so the builder can autocomplete them and infer value types.
  useEffect(() => {
    let cancelled = false;
    api
      .sampleFields(tab.connectionId, tab.db, tab.collection)
      .then((f) => !cancelled && setFields(f))
      .catch(() => undefined); // autocomplete is a nicety; queries still work without it
    return () => {
      cancelled = true;
    };
  }, [tab.connectionId, tab.db, tab.collection]);

  // Every change to `request` triggers exactly one fetch; stale responses are ignored.
  useEffect(() => {
    let cancelled = false;
    const q = request.query;
    setLoading(true);
    setError(null);
    const call =
      q.kind === 'builder'
        ? api.find(tab.connectionId, tab.db, tab.collection, {
            filter: q.filter,
            sort: { field: sortById(q.sortId).field, direction: sortById(q.sortId).direction },
            limit: q.limit,
            skip: request.skip,
          })
        : api.find(tab.connectionId, tab.db, tab.collection, { command: q.command, skip: request.skip });
    call
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, tab.connectionId, tab.db, tab.collection]);

  // The total belongs to the current query. Without a filter it comes from collection metadata
  // (instant, no scan), so it's fetched automatically; anything else only counts on demand.
  const countFor = useCallback(
    (query: Query, isCancelled: () => boolean = () => false) => {
      setTotal({ state: 'counting' });
      api
        .count(target, query.kind === 'builder' ? { filter: query.filter } : { command: query.command })
        .then((r) => !isCancelled() && setTotal({ state: 'known', count: r.count, estimated: r.estimated }))
        .catch((e: unknown) => {
          if (isCancelled()) return;
          setTotal({ state: 'unknown' });
          notify({ kind: 'error', message: `Count failed: ${errorMessage(e)}` });
        });
    },
    [target, notify],
  );

  useEffect(() => {
    let cancelled = false;
    setTotal({ state: 'unknown' });
    if (request.query.kind === 'builder' && isEmptyFilter(request.query.filter)) countFor(request.query, () => cancelled);
    return () => {
      cancelled = true;
    };
    // queryVersion changes on Run/Refresh (and after writes) but not when paging, so paging keeps the total.
  }, [request.query, request.queryVersion, countFor]);

  const start = (query: Query) => {
    setCommandResult(null);
    setCommandError(null);
    setRequest((r) => ({ query, skip: 0, nonce: r.nonce + 1, queryVersion: r.queryVersion + 1 }));
  };

  const runBuilder = (overrides: { sortId?: SortId; limit?: number } = {}) =>
    start({ kind: 'builder', filter: builderFilter, sortId: overrides.sortId ?? sortId, limit: overrides.limit ?? limit });

  const refresh = useCallback(() => {
    setCommandResult(null);
    setRequest((r) => ({ ...r, nonce: r.nonce + 1, queryVersion: r.queryVersion + 1 }));
  }, []);

  const undoAction = useUndoAction(refresh);

  /** Builder → Raw hands over the full command; asks first if that would overwrite Raw edits. */
  const switchToRaw = async () => {
    if (mode === 'raw') return;
    const generated = builderCommand(true);
    const editedByUser = raw.trim() !== '' && raw !== rawFromBuilder;
    if (editedByUser && raw !== generated) {
      const replace = await confirm({
        title: 'Replace your Raw query?',
        body: <p>The Raw editor has changes the Builder doesn't know about. Replace them with the Builder's query?</p>,
        confirmLabel: "Use the Builder's query",
        cancelLabel: 'Keep my Raw text',
      });
      if (!replace) {
        setMode('raw');
        return;
      }
    }
    setRaw(generated);
    setRawFromBuilder(generated);
    setMode('raw');
  };

  /** Reads run immediately; writes are previewed by the server and need explicit confirmation. */
  const execute = async (text: string) => {
    setExecuting(true);
    setCommandError(null);
    try {
      let response = await api.runCommand(target, text);
      if (response.kind === 'confirm') {
        const preview = response;
        const ok = await confirm({
          title: `Run ${preview.method}?`,
          body: (
            <>
              <p>{preview.description}</p>
              {preview.warnings.length > 0 && (
                <ul className="warnings">
                  {preview.warnings.map((w) => (
                    <li key={w}>
                      <TriangleAlert /> {w}
                    </li>
                  ))}
                </ul>
              )}
              <pre className="confirm-preview">
                <ShellCode code={text.trim()} />
              </pre>
              <p className="hint">Every affected document is backed up first, and you can undo right after.</p>
            </>
          ),
          confirmLabel: `Run ${preview.method}`,
          danger: true,
          requireText: preview.requireTyping ? tab.collection : undefined,
        });
        if (!ok) return;
        response = await api.runCommand(target, text, preview.confirmToken);
      }

      if (response.kind === 'written') {
        notify({ kind: 'success', message: response.summary, action: undoAction(response.backupId) });
        refresh();
      } else if (response.kind === 'documents' || response.kind === 'value') {
        setCommandResult(response);
      } else {
        setCommandError('The command needs confirmation again. Click Run.');
      }
    } catch (e) {
      setCommandError(errorMessage(e));
    } finally {
      setExecuting(false);
    }
  };

  const runRaw = () => {
    const text = raw.trim();
    if (text === '') {
      setCommandError(`Type a command, e.g. db.getCollection(${JSON.stringify(tab.collection)}).find({})`);
      return;
    }
    if (isBareFilter(text)) {
      // A bare { … } filter: turn it into the full command so what runs is visible and editable.
      const command = buildFindCommand(tab.collection, text, NEWEST_FIRST, 20, true);
      setRaw(command);
      start({ kind: 'raw', command });
      return;
    }
    // find(...) runs in the results view (paging, Count); everything else goes through Execute.
    if (isFindCommand(text)) start({ kind: 'raw', command: text });
    else void execute(text);
  };

  const run = () => (mode === 'builder' ? runBuilder() : runRaw());
  const pageSize = result?.limit ?? (request.query.kind === 'builder' ? request.query.limit : 20);

  return (
    <div className="collection-tab" hidden={!active}>
      <div className="breadcrumb">
        {tab.connectionName} <span>›</span> {tab.db} <span>›</span> <strong>{tab.collection}</strong>
      </div>

      <div className="query-panel">
        <div className="query-toolbar">
          <div className="segmented" role="radiogroup" aria-label="Query mode">
            <button role="radio" aria-checked={mode === 'builder'} className={mode === 'builder' ? 'on' : ''} onClick={() => setMode('builder')}>
              Builder
            </button>
            <button
              role="radio"
              aria-checked={mode === 'raw'}
              className={mode === 'raw' ? 'on' : ''}
              onClick={() => void switchToRaw()}
              title="Edit the whole command as text (starts from the Builder's query)"
            >
              Raw
            </button>
          </div>

          {mode === 'builder' && (
            <>
              <label className="inline">
                Sort
                <select
                  value={sortId}
                  onChange={(e) => {
                    const next = e.target.value as SortId;
                    setSortId(next);
                    runBuilder({ sortId: next });
                  }}
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {sort.field !== '_id' && (
                <span className="hint" title="Sorting on a field without an index makes MongoDB read the whole collection.">
                  <TriangleAlert /> fast only if {sort.field} is indexed
                </span>
              )}

              <label className="inline">
                Show
                <select
                  value={limit}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setLimit(next);
                    runBuilder({ limit: next });
                  }}
                >
                  {LIMITS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <span className="spacer" />
          {rawIsWrite ? (
            <button
              className="btn execute"
              onClick={run}
              disabled={executing}
              title="Shows a preview of what will change and asks for confirmation"
            >
              <Zap /> {executing ? 'Running…' : 'Execute'}
            </button>
          ) : (
            <button className="btn primary" onClick={run} disabled={loading || executing}>
              <Play /> Run
            </button>
          )}
        </div>

        {mode === 'builder' ? (
          <>
            <FilterBuilder rows={rows} fields={fields} onRowsChange={setRows} onSubmit={() => runBuilder()} />
            <div className="query-preview" title="The query the Builder runs. Switch to Raw to edit it as text.">
              <ShellCode code={builderCommand(false)} />
            </div>
          </>
        ) : (
          <>
            <textarea
              className="raw-input"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setCommandError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  run();
                }
              }}
              spellCheck={false}
              rows={6}
              placeholder={[
                `db.getCollection(${JSON.stringify(tab.collection)})`,
                '  .find({ name: /ada/i })',
                '  .sort({ _id: -1 })',
                '  .limit(20)',
              ].join('\n')}
            />
            <div className="hint">
              <code>find(…)</code> shows results here with paging (<code>.sort()</code>, <code>.limit()</code>,{' '}
              <code>.skip()</code>, <code>.projection()</code> work). Writes like <code>updateMany</code> show a preview and
              need edits allowed. Ctrl+Enter to run.
            </div>
          </>
        )}

        {commandError && <div className="error inline-error">{commandError}</div>}
      </div>

      <ResultsView
        target={target}
        result={result}
        commandResult={commandResult}
        skip={request.skip}
        loading={loading}
        error={error}
        onPrev={() => setRequest((r) => ({ ...r, skip: Math.max(0, r.skip - pageSize), nonce: r.nonce + 1 }))}
        onNext={() => setRequest((r) => ({ ...r, skip: r.skip + pageSize, nonce: r.nonce + 1 }))}
        onRefresh={refresh}
        onClearCommandResult={() => setCommandResult(null)}
        total={total}
        onCount={() => countFor(request.query)}
      />
    </div>
  );
}
