import { ChevronRight } from 'lucide-react';

/** Expand/collapse indicator: a chevron that rotates down when open. */
export function Caret({ open }: { open: boolean }) {
  return <ChevronRight className={`caret-icon ${open ? 'open' : ''}`} aria-hidden />;
}
