/**
 * Zoom keyboard shortcuts that work on any keyboard layout.
 *
 * Electron's built-in zoom accelerators assume a US layout ("Plus" = Shift+=) and ignore the
 * numpad, so Ctrl + "+" fails on layouts like Portuguese where "+" is its own key. We match on
 * the character produced (`key`) and on the physical numpad keys (`code`) instead.
 * No Electron import, so this can be unit-tested with plain Node.
 */

/** The subset of Electron's `Input` (before-input-event) that we need. */
export interface KeyInput {
  type: string;
  key: string;
  code: string;
  control: boolean;
  alt: boolean;
  meta: boolean;
}

export type ZoomAction = 'in' | 'out' | 'reset';

export const ZOOM_STEP = 0.5; // same step as Chromium's own zoom commands
export const ZOOM_MIN = -3; // ≈ 50%
export const ZOOM_MAX = 4.5; // ≈ 300%

export function zoomShortcut(input: KeyInput): ZoomAction | undefined {
  // AltGr reports as Ctrl+Alt on Windows; never treat AltGr combinations as shortcuts.
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return undefined;
  if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd') return 'in';
  if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract') return 'out';
  // Numpad 0 with NumLock off reports key "Insert", so match the physical key too.
  if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') return 'reset';
  return undefined;
}

export function nextZoomLevel(current: number, action: ZoomAction): number {
  if (action === 'reset') return 0;
  const next = current + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}
