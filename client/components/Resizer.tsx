import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  /** Current size in px of the panel being resized. */
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  onChange: (value: number) => void;
  /** Called when a drag or key press finishes, to save the size. */
  onCommit: (value: number) => void;
}

const KEY_STEP = 16;

/**
 * Vertical drag handle for resizing the panel to its left. Pointer drag, arrow keys
 * (accessible separator), and double-click to restore the default width.
 */
export function Resizer({ value, min, max, defaultValue, label, onChange, onCommit }: Props) {
  const drag = useRef<{ startX: number; startValue: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startValue: value };
    document.body.classList.add('resizing');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clamp(drag.current.startValue + e.clientX - drag.current.startX));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const final = clamp(drag.current.startValue + e.clientX - drag.current.startX);
    drag.current = null;
    document.body.classList.remove('resizing');
    onChange(final);
    onCommit(final);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    const next = clamp(value + delta);
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onChange(defaultValue);
        onCommit(defaultValue);
      }}
    />
  );
}
