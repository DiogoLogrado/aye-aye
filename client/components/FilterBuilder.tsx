import { Plus, X } from 'lucide-react';
import type { FieldInfo } from '../api';
import { FieldCombobox } from './FieldCombobox';
import { OPERATORS, mixesJoins, type FilterRow, type Join, type Operator } from '../queryBuilder';

interface Props {
  rows: FilterRow[];
  fields: FieldInfo[];
  onRowsChange: (rows: FilterRow[]) => void;
  onSubmit: () => void;
}

export const newRow = (join: Join = 'and'): FilterRow => ({ id: crypto.randomUUID(), join, field: '', op: 'eq', value: '' });

export function FilterBuilder({ rows, fields, onRowsChange, onSubmit }: Props) {
  const typesOf = (path: string) => fields.find((f) => f.path === path.trim())?.types ?? [];

  const update = (id: string, patch: Partial<FilterRow>) =>
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    onRowsChange(next.length > 0 ? next : [newRow()]);
  };

  // A new condition continues with the same join as the last row, which is usually what you want.
  const add = () => onRowsChange([...rows, newRow(rows.length > 1 ? rows[rows.length - 1]!.join : 'and')]);

  return (
    <div className="builder">
      {rows.map((row, index) => {
        const op = OPERATORS.find((o) => o.value === row.op);
        const types = typesOf(row.field);
        return (
          <div key={row.id} className="builder-row">
            {index === 0 ? (
              <span className="combinator-label">where</span>
            ) : (
              <select
                className={`join-select join-${row.join}`}
                value={row.join}
                aria-label="Combine with the previous conditions using"
                onChange={(e) => update(row.id, { join: e.target.value as Join })}
              >
                <option value="and">and</option>
                <option value="or">or</option>
              </select>
            )}
            <FieldCombobox
              value={row.field}
              fields={fields}
              placeholder="field"
              title="Field name. Nested fields use dots, e.g. address.city"
              onChange={(field) => update(row.id, { field })}
              onSubmit={onSubmit}
            />
            <select value={row.op} onChange={(e) => update(row.id, { op: e.target.value as Operator })}>
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="value-input"
              placeholder={op?.needsValue ? (types.length ? types.join(' | ') : 'value') : '—'}
              value={op?.needsValue ? row.value : ''}
              disabled={!op?.needsValue}
              onChange={(e) => update(row.id, { value: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
              spellCheck={false}
            />
            <button className="icon-btn" aria-label="Remove condition" title="Remove condition" onClick={() => remove(row.id)}>
              <X />
            </button>
          </div>
        );
      })}

      <div className="builder-actions">
        <button className="btn" onClick={add}>
          <Plus /> Condition
        </button>
        {mixesJoins(rows) ? (
          <span className="hint">
            "and" is applied before "or": <code>a and b or c</code> means <code>(a and b) or c</code>. Check the query line
            below.
          </span>
        ) : (
          <span className="hint">Tip: wrap a value in "quotes" to force text. Leave everything empty to show all.</span>
        )}
      </div>
    </div>
  );
}
