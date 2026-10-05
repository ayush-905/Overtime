// The shell's own state: whether the palette, the shortcuts, the weekly digest or
// Customize is open; the sidebar (folded into its rail or open, its width, its
// order and hidden sections); and the session panel (which session, docked or
// floating, its width). Folding a wide window is remembered; a window narrower
// than 1100px folds it for now only, and widening it brings back your choice.
// The other dialogs are in dialogs.ts.

import { create } from 'zustand';
import { NAV_KEY, readSideWidth, saveFolded, saveSideWidth, savedFolded, SIDE, SIDE_W_KEY } from '@/lib/prefs';
import { onOtherTab, readSetting, writeSetting } from '@/lib/storage';
import { readNavState, writeNavState, type NavState } from '@/lib/nav';
import { useMedia } from '@/data/hooks';
import { inPopover } from '@/data/desktop';

const narrowQuery = matchMedia('(max-width: 1100px)');

// The session panel: docked beside the page (when there's room) or floating over
// it, and how wide it is.
const DOCK_KEY = 'drawer-dock';
const DRAWER_KEY = 'drawer-width';
export const DRAWER = { usual: 480, min: 380, max: 1100 };
const drawerMax = () => Math.min(DRAWER.max, Math.round(window.innerWidth * 0.9));

function readDrawerWidth() {
  const v = Number(readSetting(DRAWER_KEY));
  return Number.isFinite(v) && v >= DRAWER.min && v <= DRAWER.max ? v : DRAWER.usual;
}

/** A session open in its panel: at one of its messages (`at`), with the words searched for (`q`). */
export type OpenSession = { id: string; at: number | null; q: string };

type UiState = {
  paletteOpen: boolean;
  keysOpen: boolean;
  digest: 0 | 1 | null;
  customizing: boolean;
  folded: boolean;
  sideWidth: number;
  nav: NavState;
  session: OpenSession | null;
  docked: boolean;
  drawerWidth: number;
  setPaletteOpen: (open: boolean) => void;
  setKeysOpen: (open: boolean) => void;
  setDigest: (week: 0 | 1 | null) => void;
  setCustomizing: (on: boolean) => void;
  setFolded: (on: boolean) => void;
  toggleFolded: () => void;
  setSideWidth: (w: number, save?: boolean) => void;
  setNav: (nav: NavState) => void;
  openSession: (id: string, opts?: { at?: number | null; q?: string }) => void;
  closeSession: () => void;
  setDocked: (on: boolean) => void;
  setDrawerWidth: (w: number, save?: boolean) => void;
};

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  keysOpen: false,
  digest: null,
  customizing: false,
  folded: narrowQuery.matches || savedFolded(),
  sideWidth: readSideWidth(),
  nav: readNavState(),
  session: null,
  docked: readSetting(DOCK_KEY) === '1',
  drawerWidth: readDrawerWidth(),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setKeysOpen: (keysOpen) => set({ keysOpen }),
  setDigest: (digest) => set({ digest }),
  setCustomizing: (customizing) => set({ customizing }),
  openSession: (id, { at = null, q = '' } = {}) => set({ session: { id, at, q } }),
  closeSession: () => set({ session: null }),
  setDocked: (on) => {
    writeSetting(DOCK_KEY, on ? '1' : null);
    set({ docked: on });
  },
  setDrawerWidth: (w, save = true) => {
    const width = Math.max(DRAWER.min, Math.min(drawerMax(), Math.round(w)));
    if (save) writeSetting(DRAWER_KEY, width === DRAWER.usual ? null : String(width));
    set({ drawerWidth: width });
  },
  setFolded: (on) => {
    if (on === get().folded) return;
    if (!narrowQuery.matches) saveFolded(on);
    document.documentElement.classList.toggle('rail', on);
    set({ folded: on });
  },
  toggleFolded: () => get().setFolded(!get().folded),
  setSideWidth: (w, save = true) => {
    const width = Math.max(SIDE.min, Math.min(SIDE.max, Math.round(w)));
    document.documentElement.style.setProperty('--side-w', `${width}px`);
    if (save) saveSideWidth(width);
    set({ sideWidth: width });
  },
  setNav: (nav) => {
    writeNavState(nav);
    set({ nav });
  },
}));

/** Whether the session panel sits beside the page (docked, with room) rather than over it. */
export function usePanelDocked() {
  const docked = useUi((s) => s.docked);
  const roomy = useMedia('(min-width: 1100px)');
  const open = useUi((s) => !!s.session);
  return open && docked && roomy && !inPopover;
}

narrowQuery.addEventListener('change', () => {
  const folded = narrowQuery.matches || savedFolded();
  document.documentElement.classList.toggle('rail', folded);
  useUi.setState({ folded });
});

// Another tab reordered the sidebar or changed its width.
onOtherTab((key) => {
  if (key === NAV_KEY) useUi.setState({ nav: readNavState() });
  if (key === SIDE_W_KEY) useUi.getState().setSideWidth(readSideWidth(), false);
});
