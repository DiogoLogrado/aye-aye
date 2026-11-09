import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ZOOM_MAX, ZOOM_MIN, nextZoomLevel, zoomShortcut, type KeyInput } from '../electron/zoom';

const ctrl = (key: string, code: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  key,
  code,
  control: true,
  alt: false,
  meta: false,
  ...extra,
});

describe('zoomShortcut', () => {
  it('zooms in with "+" on any layout, "=" and the numpad', () => {
    assert.equal(zoomShortcut(ctrl('+', 'BracketRight')), 'in'); // Portuguese layout: "+" has its own key
    assert.equal(zoomShortcut(ctrl('+', 'Equal', {})), 'in'); // US layout with Shift
    assert.equal(zoomShortcut(ctrl('=', 'Equal')), 'in'); // US layout without Shift
    assert.equal(zoomShortcut(ctrl('+', 'NumpadAdd')), 'in');
  });

  it('zooms out with "-" and the numpad', () => {
    assert.equal(zoomShortcut(ctrl('-', 'Slash')), 'out');
    assert.equal(zoomShortcut(ctrl('-', 'NumpadSubtract')), 'out');
  });

  it('resets with 0 on the top row and the numpad, even with NumLock off', () => {
    assert.equal(zoomShortcut(ctrl('0', 'Digit0')), 'reset');
    assert.equal(zoomShortcut(ctrl('0', 'Numpad0')), 'reset');
    assert.equal(zoomShortcut(ctrl('Insert', 'Numpad0')), 'reset');
  });

  it('ignores keys without Ctrl, key-ups, AltGr combos and other keys', () => {
    assert.equal(zoomShortcut(ctrl('+', 'NumpadAdd', { control: false })), undefined);
    assert.equal(zoomShortcut(ctrl('+', 'NumpadAdd', { type: 'keyUp' })), undefined);
    assert.equal(zoomShortcut(ctrl('+', 'BracketRight', { alt: true })), undefined); // AltGr = Ctrl+Alt
    assert.equal(zoomShortcut(ctrl('c', 'KeyC')), undefined);
    assert.equal(zoomShortcut(ctrl('1', 'Digit1')), undefined);
  });
});

describe('nextZoomLevel', () => {
  it('steps, clamps and resets', () => {
    assert.equal(nextZoomLevel(0, 'in'), 0.5);
    assert.equal(nextZoomLevel(0, 'out'), -0.5);
    assert.equal(nextZoomLevel(2.5, 'reset'), 0);
    assert.equal(nextZoomLevel(ZOOM_MAX, 'in'), ZOOM_MAX);
    assert.equal(nextZoomLevel(ZOOM_MIN, 'out'), ZOOM_MIN);
  });
});
