import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type FieldChange, type FormattedDocument, type Target } from '../api';

interface Props {
  doc: FormattedDocument;
  target: Target;
  onClose: () => void;
  onSaved: (backupId: string | undefined) => void;
}

/**
 * Two-step edit: "Review changes" asks the server for a field-level diff (nothing is written),
 * then "Save" applies exactly that version. Any further typing invalidates the review.
 */
export function EditDocumentDialog({ doc, target, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(doc.text);
  const [changes, setChanges] = useState<FieldChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const submit = async (dryRun: boolean) => {
    if (!doc.id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.replaceDocument(target, { id: doc.id, version: doc.version, document: text, dryRun });
      if (dryRun) setChanges(result.changes);
      else {
        onSaved(result.backupId);
        dialogRef.current?.close();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reviewed = changes !== null;

  return (
    <dialog ref={dialogRef} className="dialog dialog-wide" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(!reviewed);
        }}
      >
        <h3>Edit document</h3>
        <div className="hint">{doc.summary}</div>

        <textarea
          className="raw-input edit-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChanges(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit(!reviewed);
            }
          }}
          spellCheck={false}
          autoFocus
        />

        {reviewed && (
          <div className="diff">
            {changes.length === 0 ? (
              <div className="hint">No changes.</div>
            ) : (
              changes.map((c) => (
                <div key={c.path} className={`diff-row diff-${c.kind}`}>
                  <span className="diff-kind">{c.kind}</span>
                  <code className="diff-path">{c.path}</code>
                  {c.before !== undefined && <code className="diff-before">{c.before}</code>}
                  {c.kind === 'changed' && <ArrowRight className="diff-arrow" aria-label="becomes" />}
                  {c.after !== undefined && <code className="diff-after">{c.after}</code>}
                </div>
              ))
            )}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="dialog-actions">
          <span className="hint spacer">The previous version is backed up and can be restored with Undo.</span>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()} disabled={busy}>
            Cancel
          </button>
          {reviewed ? (
            <button type="submit" className="btn danger" disabled={busy || changes.length === 0}>
              {busy ? 'Saving…' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Checking…' : 'Review changes'}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
