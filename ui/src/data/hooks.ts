// Small hooks the whole app uses: redraw when settings or labels change, shared
// clocks (once a second for countdowns, once a minute for the rest), and a media
// query.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { onChange, changeVersion } from '@/lib/bus';
import { env } from '@/lib/env';

/** Redraw when a setting, label or the look changes (in this tab or another). */
export function useChanged() {
  return useSyncExternalStore(onChange, changeVersion, changeVersion);
}

/**
 * A clock that moves on every `unit` ms, looked at every `every` ms: one timer for
 * everything that reads it, and none while nothing does. Nobody can see a
 * background tab, so it stands still there and catches up the moment you're back.
 */
function clock(every: number, unit: number) {
  const readers = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let value = Math.floor(Date.now() / unit);
  const tick = () => {
    if (document.hidden) return;
    const next = Math.floor(Date.now() / unit);
    if (next === value) return;
    value = next;
    for (const fn of readers) fn();
  };
  const subscribe = (fn: () => void) => {
    readers.add(fn);
    if (!timer) {
      // Nothing was reading it, so it may be behind; React looks again once it's subscribed.
      value = Math.floor(Date.now() / unit);
      timer = setInterval(tick, every);
      document.addEventListener('visibilitychange', tick);
    }
    return () => {
      readers.delete(fn);
      if (!readers.size) {
        clearInterval(timer);
        timer = undefined;
        document.removeEventListener('visibilitychange', tick);
      }
    };
  };
  return { subscribe, read: () => value * unit };
}

const second = clock(1000, 1000);
const minute = clock(5_000, 60_000);

/** The time, a new value each second: only for what shows a countdown or "x ago" (see components/Clock.tsx). */
export function useNow() {
  return useSyncExternalStore(second.subscribe, second.read, second.read);
}

/** The time, a new value each minute: for what only changes by the minute, like "updated 2m ago", a forecast and the day's name. */
export function useMinute() {
  return useSyncExternalStore(minute.subscribe, minute.read, minute.read);
}

/**
 * Something worked out from the time each second (a string, number or boolean),
 * which redraws what reads it only when it comes out different: whether an agent
 * looks stuck yet, say, rather than the whole card every second. `work` gets the
 * time by the server's clock.
 */
export function useEachSecond<T extends string | number | boolean | null>(work: (now: number) => T): T {
  const read = () => work(second.read() - env.timeOffset);
  return useSyncExternalStore(second.subscribe, read, read);
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

export const MAC =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      '',
  );

/** The modifier key as a label: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = MAC ? '⌘' : 'Ctrl+';

/** Whether a key press is in something you type in. */
export const typing = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
