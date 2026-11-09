/**
 * Helpers for the Raw editor's command text. These only decide UI behavior (which button,
 * which endpoint); the server parses and validates every command itself.
 */

const COLLECTION_PREFIX = String.raw`db\s*(?:\.\s*getCollection\s*\(\s*(["'])(?:\\.|(?!\1).)*\1\s*\)|\[\s*(["'])(?:\\.|(?!\2).)*\2\s*\]|\.\s*[A-Za-z_][\w-]*)\s*\.\s*`;

const FIND_COMMAND = new RegExp(String.raw`^\s*${COLLECTION_PREFIX}find\s*\(`, 's');
const WRITE_COMMAND = new RegExp(
  String.raw`^\s*${COLLECTION_PREFIX}(?:insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany)\s*\(`,
  's',
);

/** db.<coll>.find(...)…: runs in the normal results view, with paging and Count. */
export const isFindCommand = (text: string) => FIND_COMMAND.test(text);

/** A write command: the Run button turns into Execute (the server still previews and asks to confirm). */
export const isWriteCommand = (text: string) => WRITE_COMMAND.test(text);

/** A bare filter like { name: "x" } typed into Raw. */
export const isBareFilter = (text: string) => text.trim().startsWith('{');

const sortKey = (field: string) => (/^[A-Za-z_$][\w$]*$/.test(field) ? field : JSON.stringify(field));

/**
 * The full command for a Builder query, as handed to the Raw editor (multi-line) or shown
 * in the preview line (single line). Matches what the Builder runs, including the _id
 * tie-breaker that keeps paging stable.
 */
export function buildFindCommand(
  collection: string,
  filter: string,
  sort: { field: string; direction: 1 | -1 } | null,
  limit: number,
  multiline: boolean,
): string {
  const sortDoc = sort
    ? sort.field === '_id'
      ? `{ _id: ${sort.direction} }`
      : `{ ${sortKey(sort.field)}: ${sort.direction}, _id: ${sort.direction} }`
    : null;
  const parts = [`db.getCollection(${JSON.stringify(collection)})`, `.find(${filter.trim() || '{}'})`];
  if (sortDoc) parts.push(`.sort(${sortDoc})`);
  parts.push(`.limit(${limit})`);
  return multiline ? parts.join('\n  ') : parts.join('');
}
