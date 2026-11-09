import { Logo } from './Logo';

type MenuName = 'file' | 'edit' | 'view' | 'help';

/** Exposed by the desktop app's preload script; absent in a normal browser. */
interface DesktopBridge {
  openMenu(name: MenuName, x: number, y: number): void;
}

declare global {
  interface Window {
    ayeAyeDesktop?: DesktopBridge;
  }
}

export const desktopBridge: DesktopBridge | undefined = window.ayeAyeDesktop;

const MENUS: { id: MenuName; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' },
];

/**
 * Desktop app title bar: logo, name and the menus, with left padding so nothing sits in a
 * rounded screen corner. Windows draws min/max/close on the right (titleBarOverlay).
 * The bar itself drags the window; the buttons don't.
 */
export function TitleBar({ bridge }: { bridge: DesktopBridge }) {
  return (
    <header className="titlebar">
      <Logo className="titlebar-logo" />
      <span className="titlebar-title">Aye-aye</span>
      <nav className="titlebar-menu" aria-label="Application menu">
        {MENUS.map((menu) => (
          <button
            key={menu.id}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              bridge.openMenu(menu.id, rect.left, rect.bottom);
            }}
          >
            {menu.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
