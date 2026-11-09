import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Hash,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, type CommandResponse, type FindResult, type FormattedDocument, type Target } from '../api';
import { AddDocumentDialog } from './AddDocumentDialog';
import { Caret } from './Caret';
import { EditDocumentDialog } from './EditDocumentDialog';
import { useConfirm, useCopy, useToast, useUndoAction } from './feedback';
import { JsonNode } from './JsonTree';

export type CommandResult = Extract<CommandResponse, { kind: 'documents' | 'value' }>;

interface Props {
  target: Target;
  result: FindResult | null;
  commandResult: CommandResult | null;
  skip: number;
  loading: boolean;
  error: string | null;
  onPrev: () => void;
  onNext: () => void;
  onRefresh: () => void;
  onClearCommandResult: () => void;
  total: TotalCount;
  onCount: () => void;
}

/** Total for the current query: unknown until counted (automatic and instant only without a filter). */
export type TotalCount =
  | { state: 'unknown' }
  | { state: 'counting' }
  | { state: 'known'; count: number; estimated: boolean };

const formatNumber = (n: number) => n.toLocaleString('en-US');

type ExpandMode = 'default' | 'expand' | 'collapse';

interface CardProps {
  doc: FormattedDocument;
  index: number;
  mode: ExpandMode;
  target: Target;
  onChanged: () => void;
}

function DocumentCard({ doc, index, mode, target, onChanged }: CardProps) {
  const [open, setOpen] = useState(mode !== 'collapse');
  const [editing, setEditing] = useState(false);
  const [copied, copy] = useCopy();
  const confirm = useConfirm();
  const notify = useToast();
  const undoAction = useUndoAction(onChanged);

  const editable = doc.id !== undefined;
  const noIdReason = 'This document has no _id and cannot be edited.';

  const remove = async () => {
    if (!doc.id) return;
    const ok = await confirm({
      title: 'Delete this document?',
      body: (
        <>
          <p>
            <code>{doc.summary}</code> in <code>{`${target.db}.${target.collection}`}</code>
          </p>
          <pre className="confirm-preview">{doc.text}</pre>
          <p className="hint">It is backed up first; you can undo right after deleting.</p>
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const { backupId } = await api.deleteDocument(target, { id: doc.id, version: doc.version });
      onChanged();
      notify({ kind: 'success', message: 'Document deleted.', action: undoAction(backupId) });
    } catch (e) {
      notify({ kind: 'error', message: errorMessage(e) });
    }
  };

  return (
    <div className="doc">
      <div className="doc-header">
        <button className="j-toggle" aria-expanded={open} aria-label={open ? 'Collapse document' : 'Expand document'} onClick={() => setOpen((o) => !o)}>
          <Caret open={open} />
        </button>
        <button className="doc-title" onClick={() => setOpen((o) => !o)}>
          <span className="doc-index">{index}</span>
          <span className="doc-summary">{doc.summary || '(no _id)'}</span>
        </button>
        <div className="doc-actions">
          <button
            className={`icon-btn ${copied ? 'copied' : ''}`}
            title={copied ? 'Copied!' : 'Copy document (shell syntax)'}
            aria-label="Copy document"
            onClick={() => copy(doc.text)}
          >
            {copied ? (
              <>
                <Check /> Copied
              </>
            ) : (
              <Copy />
            )}
          </button>
          <button
            className="icon-btn"
            title={editable ? 'Edit document' : noIdReason}
            aria-label="Edit document"
            disabled={!editable}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </button>
          <button
            className="icon-btn danger-hover"
            title={editable ? 'Delete document' : noIdReason}
            aria-label="Delete document"
            disabled={!editable}
            onClick={() => void remove()}
          >
            <Trash2 />
          </button>
        </div>
      </div>
      {open && (
        <div className="doc-body">
          <JsonNode node={doc.tree} isLast expandAll={mode === 'expand'} />
        </div>
      )}
      {editing && (
        <EditDocumentDialog
          doc={doc}
          target={target}
          onClose={() => setEditing(false)}
          onSaved={(backupId) => {
            onChanged();
            notify({ kind: 'success', message: 'Document saved.', action: undoAction(backupId) });
          }}
        />
      )}
    </div>
  );
}

export function ResultsView(props: Props) {
  const { target, result, commandResult, skip, loading, error, total } = props;
  const { onPrev, onNext, onRefresh, onClearCommandResult, onCount } = props;
  // Bumping the generation remounts the cards so expand/collapse all overrides manual toggles.
  const [expand, setExpand] = useState<{ mode: ExpandMode; generation: number }>({ mode: 'default', generation: 0 });
  const [adding, setAdding] = useState(false);
  const notify = useToast();
  const undoAction = useUndoAction(onRefresh);

  const docs = commandResult ? (commandResult.kind === 'documents' ? commandResult.docs : []) : (result?.docs ?? []);
  const offset = commandResult ? 0 : skip;
  const count = docs.length;
  const hasMore = commandResult ? commandResult.kind === 'documents' && commandResult.hasMore : !!result?.hasMore;

  return (
    <section className="results">
      <div className="results-toolbar">
        {commandResult ? (
          <>
            <button className="btn" onClick={onClearCommandResult}>
              <ArrowLeft /> Back to results
            </button>
            <span className="results-range">
              {commandResult.method} result
              {commandResult.kind === 'documents' && `: ${count} document${count === 1 ? '' : 's'}${hasMore ? ' (first 200)' : ''}`}
            </span>
            <span className="results-time">{commandResult.durationMs} ms</span>
          </>
        ) : (
          <>
            <button className="icon-btn" onClick={onRefresh} disabled={loading} title="Refresh" aria-label="Refresh">
              <RotateCw />
            </button>
            <button className="btn" onClick={onPrev} disabled={loading || skip === 0}>
              <ChevronLeft /> Prev
            </button>
            <button className="btn" onClick={onNext} disabled={loading || !hasMore}>
              Next <ChevronRight />
            </button>
            <span className="results-range">
              {loading
                ? 'Loading…'
                : result &&
                  (count === 0
                    ? 'No documents'
                    : `Documents ${formatNumber(skip + 1)}–${formatNumber(skip + count)}${
                        total.state === 'known'
                          ? ` of ${total.estimated ? '≈' : ''}${formatNumber(total.count)}`
                          : hasMore
                            ? ''
                            : ' (end)'
                      }`)}
            </span>
            {total.state === 'counting' && <span className="results-time">counting…</span>}
            {total.state === 'unknown' && result && !loading && (
              <button
                className="btn"
                onClick={onCount}
                title="Exact count of documents matching this filter (runs a count query, stopped after 15 s)"
              >
                <Hash /> Count
              </button>
            )}
            {result && !loading && <span className="results-time">{result.durationMs} ms</span>}
            <button
              className="btn"
              onClick={() => setAdding(true)}
              title="Add document"
            >
              <Plus /> Add document
            </button>
          </>
        )}
        <span className="spacer" />
        <button className="btn" onClick={() => setExpand((s) => ({ mode: 'expand', generation: s.generation + 1 }))}>
          <ChevronsUpDown /> Expand all
        </button>
        <button className="btn" onClick={() => setExpand((s) => ({ mode: 'collapse', generation: s.generation + 1 }))}>
          <ChevronsDownUp /> Collapse all
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {adding && (
        <AddDocumentDialog
          target={target}
          onClose={() => setAdding(false)}
          onInserted={(backupId) => {
            onRefresh();
            notify({ kind: 'success', message: 'Document inserted.', action: undoAction(backupId) });
          }}
        />
      )}

      <div className={`docs ${loading ? 'stale' : ''}`}>
        {commandResult?.kind === 'value' && (
          <div className="doc">
            <div className="doc-body">
              <JsonNode node={commandResult.tree} isLast expandAll={expand.mode === 'expand'} />
            </div>
          </div>
        )}
        {docs.map((doc, i) => (
          <DocumentCard
            key={`${expand.generation}-${offset + i}-${doc.version}`}
            doc={doc}
            index={offset + i + 1}
            mode={expand.mode}
            target={target}
            onChanged={onRefresh}
          />
        ))}
      </div>
    </section>
  );
}
