// The keyboard, anywhere on the dashboard except while you're typing: ⌘K opens
// the palette, / searches the page you're on (or opens the palette where there's
// no search), j and k step through a list's rows, T switches light and dark, ⌘B
// folds the sidebar, ? lists all of these (KeysDialog.tsx). ⌘Z (undo) lives with
// the toasts, and ⌘[ ⌘] (in the Mac app) with back and forward.

import { useEffect } from 'react';
import { toggleTheme } from '@/lib/prefs';
import { MAC, typing } from '@/data/hooks';
import { useUi } from './ui';

/** Step to the next (1) or previous (-1) row of the list on screen. */
function stepRow(by: number) {
  const rows = [...document.querySelectorAll<HTMLElement>('main [data-row]')].filter((r) => r.offsetParent !== null);
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? (by > 0 ? 0 : rows.length - 1) : i + by))];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key?.toLowerCase();
      const ui = useUi.getState();
      if (key === 'k' && (MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (key === 'b' && (MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && !typing(e.target)) {
        e.preventDefault();
        ui.toggleFolded();
        return;
      }
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        typing(e.target) ||
        ui.paletteOpen ||
        ui.keysOpen ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (key === 't' && !e.shiftKey) {
        e.preventDefault();
        toggleTheme();
      } else if (e.key === '?') {
        e.preventDefault();
        ui.setKeysOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        const search = document.querySelector<HTMLInputElement>('main input[type="search"]');
        if (search && search.offsetParent !== null) search.focus();
        else ui.setPaletteOpen(true);
      } else if (key === 'j' || key === 'k') {
        e.preventDefault();
        stepRow(key === 'j' ? 1 : -1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
