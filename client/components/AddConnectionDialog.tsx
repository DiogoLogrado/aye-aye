import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export function AddConnectionDialog({ onClose, onAdded }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [uri, setUri] = useState('');
  const [showUri, setShowUri] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.addConnection(name.trim(), uri.trim());
      setUri(''); // don't keep the secret in memory longer than needed
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <h3>Add connection</h3>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Local dev" maxLength={60} required autoFocus />
        </label>

        <label>
          Connection string
          <div className="input-row">
            <input
              type={showUri ? 'text' : 'password'}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="mongodb://user:password@host:27017/?authSource=admin"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button type="button" className="btn" onClick={() => setShowUri((s) => !s)}>
              {showUri ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <p className="hint">
          The connection is tested before saving. The string goes straight to Windows Credential Manager and is never written
          to a file or sent back to this page. Prefer a database user with read-only roles.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Testing connection…' : 'Test & save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
