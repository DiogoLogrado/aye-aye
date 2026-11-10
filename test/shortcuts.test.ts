import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appShortcut } from '../electron/shortcuts';

const key = (key: string, code: string, mods: { control?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  type: 'keyDown',
  key,
  code,
  control: mods.control ?? false,
  shift: mods.shift ?? false,
  alt: mods.alt ?? false,
  meta: false,
});

describe('appShortcut', () => {
  it('maps the app shortcuts', () => {
    assert.equal(appShortcut(key('N', 'KeyN', { control: true, shift: true })), 'new-connection');
    assert.equal(appShortcut(key('T', 'KeyT', { control: true, shift: true })), 'reopen-tab');
    assert.equal(appShortcut(key('r', 'KeyR', { control: true })), 'reload');
    assert.equal(appShortcut(key('F5', 'F5')), 'reload');
    assert.equal(appShortcut(key('F11', 'F11')), 'fullscreen');
    assert.equal(appShortcut(key('+', 'NumpadAdd', { control: true })), 'zoom-in');
    assert.equal(appShortcut(key('0', 'Numpad0', { control: true })), 'zoom-reset');
  });

  it('leaves text-editing and unrelated keys alone', () => {
    assert.equal(appShortcut(key('c', 'KeyC', { control: true })), undefined); // copy: Chromium handles it
    assert.equal(appShortcut(key('n', 'KeyN', { control: true })), undefined); // Ctrl+N without Shift
    assert.equal(appShortcut(key('t', 'KeyT', { control: true })), undefined); // Ctrl+T without Shift
    assert.equal(appShortcut(key('R', 'KeyR', { control: true, shift: true })), undefined);
    assert.equal(appShortcut(key('F5', 'F5', { control: true })), undefined);
    assert.equal(appShortcut(key('N', 'KeyN', { control: true, shift: true, alt: true })), undefined); // AltGr combos
    assert.equal(appShortcut({ ...key('F5', 'F5'), type: 'keyUp' }), undefined);
  });
});
