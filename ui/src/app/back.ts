// Back and forward through where you've been, in the Mac app, which has no browser
// buttons: each section you open (from the sidebar, the tab bar or a card) is a
// step in the page's history. ⌘[ and ⌘], the Go menu, a mouse's side buttons and
// the arrows by each page's title all use it. Back first closes what's over the
// page (a dialog, or a session's panel), and going back to a page puts you where
// you were on it.

import { useSyncExternalStore } from 'react';
import { PAGES, TITLES, type Page } from '@/lib/nav';
import { parseHash } from '@/lib/route';
import { bridge } from '@/data/desktop';

type NavEntry = { url: string | null; key: string; index: number };
type Navigation = EventTarget & {
  currentEntry: NavEntry | null;
  entries: () => NavEntry[];
};

const nav = (window as unknown as { navigation?: Navigation }).navigation;
const scrolls = new Map<string, number>(); // a history entry → how far down its page you were
let traversed = false;
let closeOver: () => boolean = () => false;

/** The section a history entry shows, if it's one of this page's. */
function sectionOf(entry: NavEntry | undefined): Page | null {
  if (!entry?.url) return null;
  const url = new URL(entry.url);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return null;
  const { page } = parseHash(url.hash);
  return (PAGES as readonly string[]).includes(page) ? (page as Page) : 'overview';
}

/** The section a step back (-1) or forward (1) would show, or null. */
function step(by: number) {
  if (!nav?.currentEntry) return null;
  return sectionOf(nav.entries()[nav.currentEntry.index + by]);
}

export function goBack() {
  if (closeOver()) return;
  if (step(-1)) history.back();
}

export function goForward() {
  if (step(1)) history.forward();
}

// For the arrows: where each goes, redrawn as you move.
const listeners = new Set<() => void>();
let snapshot = { back: null as Page | null, forward: null as Page | null };
function refresh() {
  const next = { back: step(-1), forward: step(1) };
  if (next.back !== snapshot.back || next.forward !== snapshot.forward) {
    snapshot = next;
    for (const fn of listeners) fn();
  }
}

export function useSteps() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

export const stepTip = (dir: 'back' | 'forward', to: Page | null) => (to ? `${dir === 'back' ? 'Back to' : 'Forward to'} ${TITLES[to]} (⌘${dir === 'back' ? '[' : ']'})` : '');

/** Only the Mac app has the arrows and shortcuts; a browser has its own. `close` shuts what's over the page and says whether there was anything. */
export function startBack(close: () => boolean) {
  closeOver = close;
  if (!bridge || !nav) return;
  document.addEventListener('keydown', (e) => {
    if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || (e.key !== '[' && e.key !== ']')) return;
    e.preventDefault();
    if (e.key === '[') goBack();
    else goForward();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 3) goBack();
    if (e.button === 4) goForward();
  });
  bridge.onGo?.((dir) => (dir === 'back' ? goBack() : dir === 'forward' ? goForward() : null));
  history.scrollRestoration = 'manual';
  nav.addEventListener('navigate', ((e: Event & { navigationType?: string }) => {
    if (nav.currentEntry) scrolls.set(nav.currentEntry.key, window.scrollY);
    traversed = e.navigationType === 'traverse';
  }) as EventListener);
  nav.addEventListener('currententrychange', refresh);
  // The app clears the popover's history while it's closed (see desktop/main.js), which says nothing here.
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
}

export const hasSteps = () => !!bridge && !!nav;

/** Back (or forward) on a page: where you were on it, once it's drawn. */
export function restoreScroll() {
  if (!traversed || !nav?.currentEntry) return;
  traversed = false;
  const y = scrolls.get(nav.currentEntry.key);
  if (!y) return;
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  });
}
