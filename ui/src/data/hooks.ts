// Small hooks the whole app uses: redraw when settings or labels change, a shared
// once-a-second clock for countdowns, and a media query.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { onChange, changeVersion } from '@/lib/bus';

/** Redraw when a setting, label or the look changes (in this tab or another). */
export function useChanged() {
  return useSyncExternalStore(onChange, changeVersion, changeVersion);
}

// One interval for every countdown on the page, only while something shows one.
const tickers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let second = Math.floor(Date.now() / 1000);

function subscribeTick(fn: () => void) {
  tickers.add(fn);
  if (!timer) {
    timer = setInterval(() => {
      // Nobody can see a background tab, so it catches up when you come back.
      if (document.hidden) return;
      second = Math.floor(Date.now() / 1000);
      for (const t of tickers) t();
    }, 1000);
  }
  return () => {
    tickers.delete(fn);
    if (!tickers.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The time, a new value each second: only for what shows a countdown or "x ago". */
export function useNow() {
  const s = useSyncExternalStore(subscribeTick, () => second, () => second);
  return s * 1000;
}

/** The time, a new value each minute: for what only changes by the minute, like "updated 2m ago" and the day's name. */
export function useMinute() {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setMinute(Math.floor(Date.now() / 60_000));
    }, 15_000);
    return () => clearInterval(t);
  }, []);
  return minute * 60_000;
}

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '');

/** The modifier key as a label: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = MAC ? '⌘' : 'Ctrl+';

/** Whether a key press is in something you type in. */
export const typing = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
