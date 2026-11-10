import { zoomShortcut, type KeyInput } from './zoom';

export type AppShortcut =
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'new-connection'
  | 'reopen-tab'
  | 'reload'
  | 'fullscreen';

/**
 * App keyboard shortcuts, matched in before-input-event rather than via menu accelerators:
 * the custom title bar hides the native menu bar, and this also makes them layout-independent.
 * Clipboard/undo shortcuts are left to Chromium, which handles them natively in text boxes.
 */
export function appShortcut(input: KeyInput & { shift: boolean }): AppShortcut | undefined {
  if (input.type !== 'keyDown') return undefined;

  const zoom = zoomShortcut(input);
  if (zoom) return zoom === 'in' ? 'zoom-in' : zoom === 'out' ? 'zoom-out' : 'zoom-reset';

  const plain = !input.control && !input.alt && !input.meta && !input.shift;
  if (plain && input.key === 'F5') return 'reload';
  if (plain && input.key === 'F11') return 'fullscreen';

  const ctrlOnly = input.control && !input.alt && !input.meta;
  if (ctrlOnly && !input.shift && input.code === 'KeyR') return 'reload';
  if (ctrlOnly && input.shift && input.code === 'KeyN') return 'new-connection';
  if (ctrlOnly && input.shift && input.code === 'KeyT') return 'reopen-tab';
  return undefined;
}
