// Desktop app entry point: runs the Aye-aye server in-process and shows it in its own window.
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
  type Rectangle,
  type WebContents,
} from 'electron';
// The server and the updater are imported lazily (see "lifecycle"): loading mongodb, express and
// electron-updater takes seconds on a cold start, and the window should appear before that.
import { appDataDir } from '../server/config';
import type { RunningServer } from '../server/start';
import { appShortcut, type AppShortcut } from './shortcuts';
import type { Updater } from './updater';
import { showWhatsNewOnce } from './whatsNew';
import { nextZoomLevel, type ZoomAction } from './zoom';

/** A stable origin keeps UI preferences (localStorage). 4317 stays free for `npm start`. */
const PREFERRED_PORT = 4318;
/** `--smoke-test`: start hidden, check the page and API load, print the result, exit. */
const SMOKE_TEST = process.argv.includes('--smoke-test');

const dataDir = appDataDir();
// Chromium's own data (cache, localStorage) lives apart from connections metadata and backups.
app.setPath('userData', path.join(dataDir, 'electron'));
app.setAppUserModelId('local.aye-aye');

let server: RunningServer | undefined;
let mainWindow: BrowserWindow | undefined;
let updater: Updater | undefined;
/** Origin of our server once it has started; until then the window only shows the splash file. */
let appOrigin: string | undefined;

const clientDir = () => path.join(app.getAppPath(), 'dist', 'client');

// ---------------------------------------------------------------- window state

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): WindowState | undefined {
  try {
    const state = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) as WindowState;
    const { x, y, width, height } = state.bounds;
    if (![x, y, width, height].every(Number.isFinite)) return undefined;
    // Ignore saved positions on a monitor that is no longer connected.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y,
    );
    return visible ? state : undefined;
  } catch {
    return undefined;
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    fs.writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch {
    // Not critical: the window just opens at the default size next time.
  }
}

// ---------------------------------------------------------------- security

/** The page may only ever show our own server: no navigation elsewhere, no popups, no webviews. */
function lockDown(contents: WebContents): void {
  const sameOrigin = (url: string) => {
    try {
      return appOrigin !== undefined && new URL(url).origin === appOrigin;
    } catch {
      return false;
    }
  };
  contents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!sameOrigin(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function restrictPermissions(): void {
  // Electron grants every permission by default; we only need clipboard writes (Copy buttons).
  const allowed = new Set(['clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowed.has(permission) && appOrigin !== undefined && new URL(contents.getURL()).origin === appOrigin);
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed.has(permission) && appOrigin !== undefined && requestingOrigin === appOrigin;
  });
}

// ---------------------------------------------------------------- menu

/**
 * Asks the page to do something (e.g. open "Add connection"). One-way: the page only
 * receives a DOM event; it gets no access to Electron or Node.
 */
function sendToPage(action: 'add-connection'): void {
  void mainWindow?.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('aye-aye:menu', { detail: ${JSON.stringify(action)} }))`,
  );
}

function zoom(action: ZoomAction): void {
  const contents = mainWindow?.webContents;
  if (contents) contents.setZoomLevel(nextZoomLevel(contents.getZoomLevel(), action));
}

function runShortcut(shortcut: AppShortcut): void {
  const win = mainWindow;
  if (!win) return;
  switch (shortcut) {
    case 'zoom-in':
      return zoom('in');
    case 'zoom-out':
      return zoom('out');
    case 'zoom-reset':
      return zoom('reset');
    case 'new-connection':
      return sendToPage('add-connection');
    case 'reload':
      return win.webContents.reload();
    case 'fullscreen':
      return win.setFullScreen(!win.isFullScreen());
  }
}

// ---------------------------------------------------------------- custom title bar

/** Height of the custom title bar (must match --titlebar-height in the page CSS). */
const TITLEBAR_HEIGHT = 36;

/** Colors for Windows' own min/max/close buttons drawn over our title bar. */
const titleBarOverlay = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#1c2028', symbolColor: '#e3e7ee', height: TITLEBAR_HEIGHT }
    : { color: '#ffffff', symbolColor: '#1d2330', height: TITLEBAR_HEIGHT };

/**
 * The page's title bar asks to open a native menu (via the preload bridge). Only our own
 * page may ask, only for the four known menus, and coordinates are bounded numbers.
 */
function handleMenuRequests(): void {
  ipcMain.on('menu:open', (event, name: unknown, x: unknown, y: unknown) => {
    const win = mainWindow;
    if (!win || !appOrigin || event.sender !== win.webContents) return;
    if (new URL(event.senderFrame?.url ?? 'about:blank').origin !== appOrigin) return;
    if (typeof name !== 'string' || !MENU_IDS.has(name)) return;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // The page measures in CSS pixels; menus are positioned in window coordinates (zoom applied).
    const factor = win.webContents.getZoomFactor();
    Menu.getApplicationMenu()
      ?.getMenuItemById(name)
      ?.submenu?.popup({ window: win, x: Math.round(Math.max(0, x) * factor), y: Math.round(Math.max(0, y) * factor) });
  });
}

function openFolder(folder: string): void {
  fs.mkdirSync(folder, { recursive: true });
  void shell.openPath(folder);
}

/** Top-level menus the custom title bar can open (ids in buildMenu). */
const MENU_IDS = new Set(['file', 'edit', 'view', 'help']);

// Shortcut keys are matched in before-input-event (see shortcuts.ts); accelerators here only label the items.
function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      id: 'file',
      label: '&File',
      submenu: [
        {
          label: 'New connection…',
          accelerator: 'CmdOrCtrl+Shift+N',
          registerAccelerator: false,
          click: () => sendToPage('add-connection'),
        },
        { type: 'separator' },
        { label: 'Open data folder', click: () => openFolder(dataDir) },
        { label: 'Open backups folder', click: () => openFolder(path.join(dataDir, 'backups')) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      // Acts on the focused text box (Raw query, filters, dialogs, search).
      id: 'edit',
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      id: 'view',
      label: '&View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', registerAccelerator: false, click: () => runShortcut('reload') },
        { type: 'separator' },
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', registerAccelerator: false, click: () => zoom('in') },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', registerAccelerator: false, click: () => zoom('out') },
        { label: 'Reset zoom', accelerator: 'CmdOrCtrl+0', registerAccelerator: false, click: () => zoom('reset') },
        { type: 'separator' },
        { label: 'Full screen', accelerator: 'F11', registerAccelerator: false, click: () => runShortcut('fullscreen') },
      ],
    },
    {
      id: 'help',
      label: '&Help',
      submenu: [
        { label: 'Check for updates…', click: () => updater?.checkNow() },
        { type: 'separator' },
        {
          label: 'About Aye-aye',
          click: () =>
            void dialog.showMessageBox({
              type: 'info',
              title: 'About Aye-aye',
              message: `Aye-aye ${app.getVersion()}`,
              detail: [
                'Local MongoDB browser with a visual query builder.',
                '',
                `Electron ${process.versions.electron}`,
                `Chromium ${process.versions.chrome}`,
                `Node ${process.versions.node}`,
                `Data folder: ${dataDir}`,
              ].join('\n'),
            }),
        },
      ],
    },
  ]);
}

// ---------------------------------------------------------------- window

/**
 * Opens the window right away with the static splash screen (a file: no server needed).
 * The app replaces it once the server is up (see "lifecycle").
 */
async function createWindow(): Promise<BrowserWindow> {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...(state?.bounds ?? { width: 1400, height: 900 }),
    minWidth: 800,
    minHeight: 500,
    title: 'Aye-aye',
    // Taskbar / Alt+Tab icon (generated from assets/icon.svg by `npm run icons`).
    icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15181e' : '#f6f7f9',
    // Our own title bar (drawn by the page) instead of Windows' one, so nothing sits in the
    // screen's rounded corner; Windows still draws the min/max/close buttons on the right.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Not needed in the desktop app (the browser version via `npm run dev` has them for debugging).
      devTools: false,
    },
  });
  if (state?.maximized) win.maximize();

  lockDown(win.webContents);
  win.webContents.on('before-input-event', (event, input) => {
    const shortcut = appShortcut(input);
    if (!shortcut) return;
    event.preventDefault();
    runShortcut(shortcut);
  });
  const updateOverlay = () => win.setTitleBarOverlay(titleBarOverlay());
  nativeTheme.on('updated', updateOverlay);
  win.on('closed', () => nativeTheme.off('updated', updateOverlay));
  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.show();
  });
  win.on('close', () => saveWindowState(win));
  await win.loadFile(path.join(clientDir(), 'splash.html'));
  return win;
}

/** Smoke test: the splash must render styled, with its logo, from disk alone. */
async function checkSplash(win: BrowserWindow): Promise<boolean> {
  const result = (await win.webContents.executeJavaScript(`(() => {
    const logo = document.querySelector('.splash-logo');
    return {
      styled: getComputedStyle(document.querySelector('.splash')).position === 'fixed',
      logo: !!logo && logo.complete && logo.naturalWidth > 0,
    };
  })()`)) as { styled: boolean; logo: boolean };
  return result.styled && result.logo;
}

async function runSmokeTest(win: BrowserWindow, splashOk: boolean): Promise<void> {
  const result = (await win.webContents.executeJavaScript(`(async () => {
    const token = document.querySelector('meta[name="aye-aye-token"]')?.content ?? '';
    const res = await fetch('/api/connections', { headers: { 'x-aye-aye-token': token } });
    // Give React a moment to render the title bar.
    await new Promise((r) => setTimeout(r, 300));
    return {
      title: document.title,
      tokenLength: token.length,
      apiStatus: res.status,
      connections: (await res.json()).length,
      desktopBridge: typeof window.ayeAyeDesktop?.openMenu === 'function',
      bridgeExposesOnlyOpenMenu: Object.keys(window.ayeAyeDesktop ?? {}).join(',') === 'openMenu',
      nodeHidden: typeof window.require === 'undefined' && typeof window.process === 'undefined',
      titleBar: document.querySelectorAll('.titlebar-menu button').length,
      logo: !!document.querySelector('.titlebar svg.titlebar-logo ellipse'),
      favicon: (await fetch('/favicon.svg')).status,
      splashReplaced: !document.querySelector('.splash'),
    };
  })()`)) as {
    title: string;
    tokenLength: number;
    apiStatus: number;
    connections: number;
    desktopBridge: boolean;
    bridgeExposesOnlyOpenMenu: boolean;
    nodeHidden: boolean;
    titleBar: number;
    logo: boolean;
    favicon: number;
    splashReplaced: boolean;
  };
  const ok =
    result.title === 'Aye-aye' &&
    result.tokenLength > 20 &&
    result.apiStatus === 200 &&
    result.desktopBridge &&
    result.bridgeExposesOnlyOpenMenu &&
    result.nodeHidden &&
    result.titleBar === 4 &&
    result.logo &&
    result.favicon === 200 &&
    result.splashReplaced &&
    splashOk;
  console.log(`SMOKE ${ok ? 'OK' : 'FAILED'} ${JSON.stringify({ ...result, splashOk, url: server?.url })}`);
  app.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  // Already running: the other instance gets 'second-instance' and focuses its window.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(buildMenu());
      restrictPermissions();
      handleMenuRequests();
      const win = await createWindow();
      mainWindow = win;
      const splashOk = SMOKE_TEST && (await checkSplash(win));

      const { startServer } = await import('../server/start');
      server = await startServer({
        port: PREFERRED_PORT,
        fallbackToFreePort: true,
        isProd: true,
        clientDir: clientDir(),
        dataDir,
      });
      // Closed while starting: nothing left to show, the app is already quitting.
      if (win.isDestroyed()) return;
      appOrigin = new URL(server.url).origin;
      // The splash stays on screen until the app's first paint (index.html shows the same splash).
      await win.loadURL(server.url);

      if (SMOKE_TEST) await runSmokeTest(win, splashOk);
      else {
        // Only the installed app: running from source shares the data folder but not the version history.
        if (app.isPackaged) showWhatsNewOnce(win);
        const { startAutoUpdates } = await import('./updater');
        updater = startAutoUpdates(() => mainWindow);
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (SMOKE_TEST) console.error(`SMOKE FAILED ${message}`);
      else dialog.showErrorBox('Aye-aye could not start', message);
      app.exit(1);
    });

  app.on('window-all-closed', () => app.quit());

  // Close database connections cleanly before exiting.
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (!server || shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    void server.close().finally(() => app.quit());
  });
}
