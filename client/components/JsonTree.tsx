import { useState } from 'react';
import type { ViewNode } from '../api';
import { Caret } from './Caret';

/** Large arrays/objects start collapsed so a single huge field doesn't swamp the view. */
const AUTO_COLLAPSE_SIZE = 50;

interface NodeProps {
  node: ViewNode;
  /** Object key; omitted for array items and the document root. */
  name?: string;
  isLast: boolean;
  /** When true, every level starts expanded regardless of size ("Expand all"). */
  expandAll: boolean;
}

function Leaf({ node }: { node: ViewNode }) {
  switch (node.t) {
    case 'string':
      return <span className="j-string">{JSON.stringify(node.v)}</span>;
    case 'number':
      return <span className="j-number">{node.v}</span>;
    case 'bool':
      return <span className="j-bool">{String(node.v)}</span>;
    case 'null':
      return <span className="j-null">null</span>;
    case 'undefined':
      return <span className="j-null">undefined</span>;
    case 'bson':
      return node.ctor ? (
        <span>
          <span className="j-ctor">{node.ctor}</span>
          <span className="j-punct">(</span>
          <span className="j-bson-args">{node.args}</span>
          <span className="j-punct">)</span>
        </span>
      ) : (
        <span className="j-bson-args">{node.args}</span>
      );
    case 'truncated':
      return <span className="j-null">… (nested too deeply)</span>;
    default:
      return null;
  }
}

function Key({ name }: { name?: string }) {
  if (name === undefined) return null;
  return (
    <>
      <span className="j-key">"{name}"</span>
      <span className="j-punct"> : </span>
    </>
  );
}

export function JsonNode({ node, name, isLast, expandAll }: NodeProps) {
  const isContainer = node.t === 'object' || node.t === 'array';
  const size = isContainer ? node.e.length : 0;
  const [open, setOpen] = useState(() => expandAll || size <= AUTO_COLLAPSE_SIZE);
  const comma = isLast ? null : <span className="j-punct">,</span>;

  if (!isContainer) {
    return (
      <div className="j-line">
        <span className="j-gutter" />
        <Key name={name} />
        <Leaf node={node} />
        {comma}
      </div>
    );
  }

  const [openBracket, closeBracket] = node.t === 'object' ? ['{', '}'] : ['[', ']'];

  if (size === 0) {
    return (
      <div className="j-line">
        <span className="j-gutter" />
        <Key name={name} />
        <span className="j-punct">
          {openBracket}
          {closeBracket}
        </span>
        {comma}
      </div>
    );
  }

  const countLabel =
    node.t === 'object' ? `${size} ${size === 1 ? 'field' : 'fields'}` : `${size} ${size === 1 ? 'item' : 'items'}`;

  return (
    <div>
      <div className="j-line">
        <button
          className="j-toggle"
          aria-expanded={open}
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen((o) => !o)}
        >
          <Caret open={open} />
        </button>
        <Key name={name} />
        <span className="j-punct">{openBracket}</span>
        {!open && (
          <>
            <button className="j-collapsed" onClick={() => setOpen(true)}>
              {countLabel}
            </button>
            <span className="j-punct">{closeBracket}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          <div className="j-children">
            {node.t === 'object'
              ? node.e.map(([key, child], i) => (
                  <JsonNode key={`${i}:${key}`} name={key} node={child} isLast={i === size - 1} expandAll={expandAll} />
                ))
              : node.e.map((child, i) => <JsonNode key={i} node={child} isLast={i === size - 1} expandAll={expandAll} />)}
          </div>
          <div className="j-line">
            <span className="j-gutter" />
            <span className="j-punct">{closeBracket}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  );
}
