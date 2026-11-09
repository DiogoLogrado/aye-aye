import { useCallback, useState } from 'react';

const PREFIX = 'aye-aye.';

function read(key: string, fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(PREFIX + key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A number remembered in localStorage (UI conveniences only, e.g. panel sizes).
 * `set` updates immediately; `persist` writes to storage (call it when a drag ends).
 */
export function usePersistentNumber(key: string, fallback: number) {
  const [value, setValue] = useState(() => read(key, fallback));

  const persist = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(PREFIX + key, String(next));
      } catch {
        // Storage unavailable: the size still works for this session.
      }
    },
    [key],
  );

  return { value, set: setValue, persist };
}
