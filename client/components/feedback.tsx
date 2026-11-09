import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, errorMessage } from '../api';

// ------------------------------------------------------------------ toasts

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: ToastAction;
}

type Notify = (toast: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<Notify>(() => undefined);
export const useToast = () => useContext(ToastContext);

const TOAST_MS = { success: 6_000, info: 6_000, error: 10_000, withAction: 15_000 } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback<Notify>((toast) => {
    const id = ++nextId.current;
    setToasts((t) => [...t.slice(-4), { ...toast, id }]);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * One notification with a countdown bar that shrinks until it closes. Hovering or focusing it
 * pauses both the bar and the timer, so it never disappears while you're about to click Undo.
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const duration = toast.action ? TOAST_MS.withAction : TOAST_MS[toast.kind];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Runs while not paused; pausing stores how much time is left and resumes from there.
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused]);

  const Icon = toast.kind === 'success' ? CircleCheck : toast.kind === 'error' ? CircleAlert : Info;

  return (
    <div
      className={`toast toast-${toast.kind} ${paused ? 'paused' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <Icon className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          className="btn"
          onClick={() => {
            onDismiss();
            void toast.action?.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="icon-btn" aria-label="Dismiss" onClick={onDismiss}>
        <X />
      </button>
      <span className="toast-timer" style={{ animationDuration: `${duration}ms` }} aria-hidden />
    </div>
  );
}

/** Builds the "Undo" action shown after a write. */
export function useUndoAction(onChanged: () => void) {
  const notify = useToast();
  return useCallback(
    (backupId: string | undefined): ToastAction | undefined =>
      backupId
        ? {
            label: 'Undo',
            run: async () => {
              try {
                const { summary } = await api.undo(backupId);
                notify({ kind: 'success', message: summary });
                onChanged();
              } catch (e) {
                notify({ kind: 'error', message: `Undo failed: ${errorMessage(e)}` });
              }
            },
          }
        : undefined,
    [notify, onChanged],
  );
}

// ------------------------------------------------------------------ confirm

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  /** Label of the button that resolves false (default "Cancel"). */
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the user must type this exact text before confirming. */
  requireText?: string;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback<Confirm>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          options={pending}
          onDone={(ok) => {
            pending.resolve(ok);
            setPending(null);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const result = useRef(false);
  const canConfirm = options.requireText === undefined || typed === options.requireText;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = (ok: boolean) => {
    result.current = ok;
    ref.current?.close();
  };

  return (
    <dialog ref={ref} className="dialog" onClose={() => onDone(result.current)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) close(true);
        }}
      >
        <h3>{options.title}</h3>
        {options.body && <div className="confirm-body">{options.body}</div>}
        {options.requireText !== undefined && (
          <label>
            <span>
              Type <code className="confirm-code">{options.requireText}</code> to confirm
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} autoComplete="off" />
          </label>
        )}
        <div className="dialog-actions">
          {/* Cancel is first and focused by default, so Enter never confirms by accident. */}
          <button type="button" className="btn" onClick={() => close(false)} autoFocus={options.requireText === undefined}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button type="submit" className={`btn ${options.danger ? 'danger' : 'primary'}`} disabled={!canConfirm}>
            {options.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ------------------------------------------------------------------ copy

/** Copies text and reports `copied` for a moment, for button feedback. */
export function useCopy(resetMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const notify = useToast();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), resetMs);
        },
        () => notify({ kind: 'error', message: 'Could not copy to the clipboard.' }),
      );
    },
    [notify, resetMs],
  );

  return [copied, copy];
}
