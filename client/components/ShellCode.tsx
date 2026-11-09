import { useMemo } from 'react';
import { tokenizeShell, type TokenKind } from '../shellHighlight';

const CLASS_BY_KIND: Record<TokenKind, string | undefined> = {
  string: 'j-string',
  number: 'j-number',
  keyword: 'j-bool',
  func: 'j-ctor',
  operator: 'j-operator',
  key: 'j-key',
  regex: 'j-string',
  punct: 'j-punct',
  plain: undefined,
};

/** Read-only, syntax-colored mongo shell text (same palette as the document viewer). */
export function ShellCode({ code, className }: { code: string; className?: string }) {
  const tokens = useMemo(() => tokenizeShell(code), [code]);
  return (
    <code className={className}>
      {tokens.map((t, i) => {
        const cls = CLASS_BY_KIND[t.kind];
        return cls ? (
          <span key={i} className={cls}>
            {t.text}
          </span>
        ) : (
          t.text
        );
      })}
    </code>
  );
}
