// Automatic updates from the project's GitHub Releases (configured under "publish" in package.json).
//
// The installed app checks on start and every few hours, downloads a newer version in the
// background (verified against the SHA-512 in the release's latest.yml), then asks to restart.
// Choosing "Later" installs it the next time the app is closed. Download progress shows on the
// taskbar icon.
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
// electron-updater is CommonJS with getter exports, so take the default export.
import electronUpdater, { type UpdateInfo } from 'electron-updater';
import { releaseNotesText } from './changelog';

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface Updater {
  /** Help ▸ Check for updates: like the automatic check, but always reports the outcome. */
  checkNow(): void;
}

export function startAutoUpdates(getWindow: () => BrowserWindow | undefined): Updater {
  const show = (options: MessageBoxOptions) => {
    const win = getWindow();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  };

  // A message box attached to a minimized window opens on the primary monitor, wherever the app
  // is. So while minimized, flash the taskbar button and show it once the window is back.
  let waitingForWindow = false;
  const showWhenOnScreen = (open: () => void) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !win.isMinimized()) return open();
    if (waitingForWindow) return;
    waitingForWindow = true;
    win.flashFrame(true);
    win.once('restore', () => {
      waitingForWindow = false;
      win.flashFrame(false);
      open();
    });
  };

  const setTaskbarProgress = (fraction: number) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(fraction);
  };

  const whatsNew = (info: UpdateInfo) => {
    const notes = releaseNotesText(info.releaseNotes);
    return notes ? `\n\nWhat's new:\n${notes}` : '';
  };

  if (!app.isPackaged) {
    // Running from source: there is no installer to update.
    return {
      checkNow: () =>
        void show({
          type: 'info',
          title: 'Updates',
          message: 'Updates are only available in the installed app.',
          detail: 'When running from source, pull the latest code instead.',
        }),
    };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  let manualCheck = false;
  let checking = false;
  let downloaded: UpdateInfo | undefined;

  autoUpdater.on('update-available', (info) => {
    if (!manualCheck) return;
    manualCheck = false;
    void show({
      type: 'info',
      title: 'Update available',
      message: `Aye-aye ${info.version} is downloading.`,
      detail: `You'll be asked to restart when it's ready. Progress shows on the taskbar icon.${whatsNew(info)}`,
    });
  });

  autoUpdater.on('download-progress', (progress) => setTaskbarProgress(progress.percent / 100));

  autoUpdater.on('update-not-available', () => {
    if (!manualCheck) return;
    manualCheck = false;
    void show({
      type: 'info',
      title: 'No updates',
      message: `Aye-aye ${app.getVersion()} is the latest version.`,
    });
  });

  autoUpdater.on('error', (error) => {
    setTaskbarProgress(-1);
    // Automatic checks fail quietly (offline, proxy, GitHub down); a manual check says why.
    if (!manualCheck) return;
    manualCheck = false;
    void show({
      type: 'warning',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: error.message,
    });
  });

  const promptRestart = (info: UpdateInfo) =>
    showWhenOnScreen(
      () =>
        void show({
          type: 'info',
          title: 'Update ready',
          message: `Aye-aye ${info.version} is ready to install.`,
          detail: `Restart now to update, or it will be installed when you close the app.${whatsNew(info)}`,
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
        }).then(({ response }) => {
          // Silent install, then start the app again.
          if (response === 0) autoUpdater.quitAndInstall(true, true);
        }),
    );

  autoUpdater.on('update-downloaded', (info) => {
    setTaskbarProgress(-1);
    manualCheck = false;
    if (downloaded?.version === info.version) return;
    downloaded = info;
    promptRestart(info);
  });

  const check = () => {
    if (checking) return;
    checking = true;
    autoUpdater
      .checkForUpdates()
      .catch(() => {
        // Reported through the 'error' event.
      })
      .finally(() => {
        checking = false;
      });
  };

  check();
  setInterval(() => {
    if (!downloaded) check();
  }, CHECK_INTERVAL_MS);

  return {
    checkNow: () => {
      if (downloaded) return promptRestart(downloaded);
      manualCheck = true;
      check();
    },
  };
}
