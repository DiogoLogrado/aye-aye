// After an update, says once what changed, from the CHANGELOG.md shipped inside the app.
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import { markdownToText, notesForVersion } from './changelog';

export function showWhatsNewOnce(win: BrowserWindow): void {
  const userData = app.getPath('userData');
  const versionFile = path.join(userData, 'last-version');
  const current = app.getVersion();

  let previous: string | undefined;
  try {
    previous = fs.readFileSync(versionFile, 'utf8').trim();
  } catch {
    // Versions before 0.4.0 didn't record themselves. A saved window position means the app was
    // used before, so this is an update rather than a fresh install.
    if (fs.existsSync(path.join(userData, 'window-state.json'))) previous = 'unknown';
  }
  if (previous === current) return;

  try {
    fs.writeFileSync(versionFile, current);
  } catch {
    // Can't remember it was shown, so don't show it (it would come back on every start).
    return;
  }
  if (!previous) return; // fresh install: nothing changed

  let notes: string | undefined;
  try {
    notes = notesForVersion(fs.readFileSync(path.join(app.getAppPath(), 'CHANGELOG.md'), 'utf8'), current);
  } catch {
    return;
  }
  if (!notes || win.isDestroyed()) return;

  void dialog.showMessageBox(win, {
    type: 'info',
    title: 'Aye-aye updated',
    message: `Aye-aye was updated to ${current}`,
    detail: `What's new:\n${markdownToText(notes)}`,
  });
}
