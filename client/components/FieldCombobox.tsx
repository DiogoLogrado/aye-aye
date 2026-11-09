import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FieldInfo } from '../api';

interface Props {
  value: string;
  fields: FieldInfo[];
  onChange: (value: string) => void;
  /** Enter pressed while no suggestion is being picked (runs the query). */
  onSubmit: () => void;
  placeholder?: string;
  title?: string;
}

const MAX_OPTIONS = 300;

/**
 * Field-name input with a scrollable suggestion list. Replaces <datalist>, whose native popup
 * can't be height-limited or styled and overflowed the window.
 */
export function FieldCombobox({ value, fields, onChange, onSubmit, placeholder, title }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // Fields containing the typed text; ones that start with it come first.
  const options = useMemo(() => {
    const query = value.trim().toLowerCase();
    const matching = query ? fields.filter((f) => f.path.toLowerCase().includes(query)) : fields;
    const starts = (f: FieldInfo) => (f.path.toLowerCase().startsWith(query) ? 0 : 1);
    return [...matching].sort((a, b) => starts(a) - starts(b)).slice(0, MAX_OPTIONS);
  }, [fields, value]);

  const showList = open && options.length > 0;

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the highlighted option visible while moving with the arrow keys.
  useEffect(() => {
    if (showList) document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, showList, listId]);

  const choose = (path: string) => {
    onChange(path);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActive(0);
        } else setActive((i) => Math.min(options.length - 1, i + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      case 'Enter':
        if (showList && options[active]) {
          e.preventDefault();
          choose(options[active].path);
        } else onSubmit();
        return;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
    }
  };

  return (
    <div className="combo" ref={wrapRef}>
      <input
        className="field-input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? optionId(active) : undefined}
        placeholder={placeholder}
        title={title}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        aria-label="Show fields"
        // mousedown + preventDefault keeps focus in the input.
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
          setActive(0);
        }}
      >
        <ChevronDown />
      </button>
      {showList && (
        <ul className="combo-list" role="listbox" id={listId}>
          {options.map((f, i) => (
            <li
              key={f.path}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(f.path);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="combo-path">{f.path}</span>
              <span className="combo-types">{f.types.join(' | ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
