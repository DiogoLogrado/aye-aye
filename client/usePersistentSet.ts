import { useCallback, useState } from 'react';

const PREFIX = 'aye-aye.';

function read(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(key: string, value: Set<string>): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify([...value]));
  } catch {
    // Storage unavailable (private mode, quota): the UI still works, it just won't remember.
  }
}

/**
 * A Set of strings remembered in localStorage. Only for UI conveniences (what's collapsed);
 * anything that must persist reliably (like favorites) is stored by the server.
 */
export function usePersistentSet(key: string): [Set<string>, (item: string) => void] {
  const [items, setItems] = useState(() => read(key));

  const toggle = useCallback(
    (item: string) => {
      setItems((current) => {
        const next = new Set(current);
        if (next.has(item)) next.delete(item);
        else next.add(item);
        write(key, next);
        return next;
      });
    },
    [key],
  );

  return [items, toggle];
}
