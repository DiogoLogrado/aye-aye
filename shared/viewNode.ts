/**
 * A typed, JSON-safe representation of a BSON document for the UI tree view.
 * Types are explicit (rather than Extended JSON) so the client can color and render
 * ObjectId/ISODate/etc. without guessing, with no ambiguity for real "$"-prefixed keys.
 * Shared by server (producer) and client (renderer); type-only, no runtime code.
 */
export type ViewNode =
  | { t: 'object'; e: [string, ViewNode][] }
  | { t: 'array'; e: ViewNode[] }
  | { t: 'string'; v: string }
  | { t: 'number'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'undefined' }
  /** Any BSON-specific value, rendered shell-style as `ctor(args)`, e.g. ObjectId('…'), ISODate('…'). */
  | { t: 'bson'; ctor: string; args: string }
  | { t: 'truncated' };
