// Release notes: read from CHANGELOG.md (shipped with the app, and used as the GitHub release text)
// and turned into plain text for native dialogs.

/** Longest notes shown in a dialog; the full list is on the Releases page. */
const MAX_DIALOG_NOTES = 1200;

/**
 * The Markdown under `## <version>` in CHANGELOG.md, up to the next `## ` heading.
 * Undefined when the version has no entry or the entry is empty.
 */
export function notesForVersion(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/);
  const heading = (line: string) => /^##\s/.test(line);
  const start = lines.findIndex((line) => heading(line) && line.slice(2).trim().split(/\s/)[0] === version);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, i) => i > start && heading(line));
  const notes = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return notes || undefined;
}

/** Markdown bullets and emphasis as plain text, for a native dialog. */
export function markdownToText(markdown: string): string {
  return limit(
    markdown
      .split(/\r?\n/)
      .map((line) => line.replace(/^(\s*)[-*]\s+/, '$1• '))
      .join('\n')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
  );
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** GitHub serves release notes as HTML; this turns them into plain text for a native dialog. */
export function htmlToText(html: string): string {
  const text = html
    // Whitespace in HTML source carries no meaning; line breaks come from the tags below.
    .replace(/\s+/g, ' ')
    .replace(/<li[^>]*>\s*/gi, '• ')
    .replace(/<\/(p|h\d)>/gi, '\n\n')
    .replace(/<br\s*\/?>|<\/(li|ul|ol|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
      if (entity.startsWith('#')) {
        const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim();
  return limit(text);
}

/** electron-updater's `releaseNotes` (HTML string, list of per-version notes, or nothing) as plain text. */
export function releaseNotesText(releaseNotes: unknown): string | undefined {
  if (typeof releaseNotes === 'string') return htmlToText(releaseNotes) || undefined;
  if (Array.isArray(releaseNotes)) {
    const parts = releaseNotes
      .map((entry: { note?: unknown }) => (typeof entry?.note === 'string' ? htmlToText(entry.note) : ''))
      .filter(Boolean);
    return parts.length > 0 ? limit(parts.join('\n')) : undefined;
  }
  return undefined;
}

function limit(text: string): string {
  return text.length <= MAX_DIALOG_NOTES ? text : `${text.slice(0, MAX_DIALOG_NOTES).trimEnd()}…`;
}
