import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type Target } from '../api';

interface Props {
  target: Target;
  onClose: () => void;
  onInserted: (backupId: string) => void;
}

const TEMPLATE = '{\n  \n}';
const CURSOR = 4; // inside the braces, on the empty line

/** "Add document": start from {} and type the fields. _id is generated if omitted. */
export function AddDocumentDialog({ target, onClose, onInserted }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    textRef.current?.focus();
    textRef.current?.setSelectionRange(CURSOR, CURSOR);
  }, []);

  const insert = async () => {
    setBusy(true);
    setError(null);
    try {
      const { backupId } = await api.insertDocument(target, text);
      onInserted(backupId);
      dialogRef.current?.close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="dialog dialog-wide" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void insert();
        }}
      >
        <h3>Add document</h3>
        <div className="hint">
          Into <code>{`${target.db}.${target.collection}`}</code>. Shell syntax works: <code>ObjectId("…")</code>,{' '}
          <code>ISODate("2026-11-06")</code>, <code>true</code>, numbers. An <code>_id</code> is generated if you leave it out.
        </div>

        <textarea
          ref={textRef}
          className="raw-input edit-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void insert();
            }
          }}
          spellCheck={false}
        />

        {error && <div className="error">{error}</div>}

        <div className="dialog-actions">
          <span className="hint spacer">Ctrl+Enter to insert. You can undo right after.</span>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Inserting…' : 'Insert'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
