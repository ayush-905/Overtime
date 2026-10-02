// The Mac app's bridge (desktop/preload.cjs), when the page is in it: which window
// it's in, the menu bar's figures, handing a section to the window, and the Go
// menu's Back and Forward. In a browser there's none.

export type Glance = {
  left: number | null;
  limited: boolean;
  windows: string[];
  cost: string;
  needs: number;
  working: number;
  image: string;
};

type Bridge = {
  platform: string;
  window: 'main' | 'popover' | 'office' | '';
  glance: (g: Glance) => void;
  openWindow: (hash: string) => void;
  onGo?: (fn: (dir: string) => void) => void;
};

export const bridge = (typeof window !== 'undefined' ? (window as unknown as { overtimeDesktop?: Bridge }).overtimeDesktop : undefined) || null;

/** In the menu bar's popover. */
export const inPopover = bridge?.window === 'popover';

/** From the popover: a section (#usage) or session (#session=…) in the dashboard window instead. */
export const openInWindow = (hash: string) => bridge?.openWindow(hash);
