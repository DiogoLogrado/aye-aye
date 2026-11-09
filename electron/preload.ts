// Runs in the sandboxed page before it loads. Exposes ONE narrow function to the page:
// opening one of the app's native menus from the custom title bar. Nothing else from
// Electron or Node is reachable from the page.
import { contextBridge, ipcRenderer } from 'electron';

const MENUS = ['file', 'edit', 'view', 'help'] as const;
type MenuName = (typeof MENUS)[number];

contextBridge.exposeInMainWorld('ayeAyeDesktop', {
  /** Opens a native menu below the given point (CSS pixels, relative to the window). */
  openMenu(name: MenuName, x: number, y: number): void {
    if (!MENUS.includes(name) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    ipcRenderer.send('menu:open', name, x, y);
  },
});
