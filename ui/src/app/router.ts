// Which section is on screen, from the address: `#cost` opens a section,
// `#sessions?day=2026-09-24` one with its filters, and `session=<id>` beside them
// (`#sessions?range=7&session=…`) a session's panel over it, so a refresh keeps
// it open and the address is a link to it. `#session=<id>` on its own opens it
// over the section you were on. Anything else goes to the section you were last on.
//
// A floating panel is a step in the history, so Back closes it. A docked one
// stays open as you look around, and goes along in the address.
//
// In the menu bar's popover the Overview is the summary; at /mini the page is
// only the summary. The dashboard proper remembers where you were.

import { create } from 'zustand';
import { PAGES, type Page } from '@/lib/nav';
import { pageLink, parseHash, type Params } from '@/lib/route';
import { env } from '@/lib/env';
import { inPopover } from '@/data/desktop';
import { readSetting, writeSetting } from '@/lib/storage';
import { panelBeside, useUi } from './ui';

const PAGE_KEY = 'page';

export const MINI = /\/mini\/?$/.test(location.pathname);
/** The dashboard proper, which chimes and remembers where you were: not /mini, not the popover. */
export const MAIN = !MINI && !inPopover;

/** Pages that aren't sections: #parts shows every component, for checking the design. */
export const HIDDEN_PAGES = ['parts'] as const;
export type RoutePage = Page | (typeof HIDDEN_PAGES)[number];

type RouteState = {
  page: RoutePage;
  params: Params;
};

const savedPage = (): Page => (MAIN ? readSetting<Page>(PAGE_KEY, 'overview', PAGES) : 'overview');

export const useRoute = create<RouteState>(() => ({
  page: savedPage(),
  params: {},
}));

const isPage = (p: string): p is RoutePage =>
  (PAGES as readonly string[]).includes(p) || (HIDDEN_PAGES as readonly string[]).includes(p);
const SESSION_ID = /^[\w-]{1,200}$/;

/** A section's address with a session's panel open over it, or without. */
const addressOf = (page: string, params: Params, session: string | null) => {
  const { session: _, ...rest } = params;
  return pageLink(page, session ? { ...rest, session } : rest);
};

function route(e?: Event) {
  let { page: name, params } = parseHash();
  // #session=<id> on its own: over the section you were on, as you had it.
  const alone = name.match(/^session=([\w-]+)$/)?.[1];
  if (alone) {
    const before = e instanceof HashChangeEvent ? parseHash(new URL(e.oldURL).hash) : null;
    name = before && isPage(before.page) ? before.page : useRoute.getState().page;
    params = { ...(before && isPage(before.page) ? before.params : {}), session: alone };
  }
  const current = useRoute.getState().page;
  const next = isPage(name) ? name : current;
  const { session = '', ...filters } = name === next ? params : {};
  let id = SESSION_ID.test(session) ? session : null;
  const ui = useUi.getState();
  // Back to where it wasn't open: a floating panel closes, a docked one stays.
  if (!id && ui.session && panelBeside()) id = ui.session.id;
  // The address always names the section, so its filters can be written into it.
  const address = addressOf(next, filters, id);
  if (address !== location.hash) history.replaceState(history.state, '', address);
  show(next, filters);
  if (id) {
    if (ui.session?.id !== id) ui.openSession(id);
  } else if (ui.session) ui.closeSession();
}

const sameParams = (a: Params, b: Params) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

function show(page: RoutePage, params: Params) {
  const was = useRoute.getState();
  env.page = page;
  // The same view again (the panel opening or closing over it) mustn't start the page over.
  if (page === was.page && sameParams(params, was.params)) return;
  useRoute.setState({ page, params });
  if (MAIN && page !== 'parts') writeSetting(PAGE_KEY, page);
  if (page !== was.page) window.scrollTo(0, 0);
}

// ── The panel in the address ─────────────────────────────────────────────────

type Navigation = { currentEntry: { index: number } | null; entries: () => { url: string | null }[] };
const nav = (window as unknown as { navigation?: Navigation }).navigation;
let openedFrom: string | null = null; // where the floating panel was opened, without the Navigation API

/** The address one step back, if it's known. */
function previous() {
  if (!nav?.currentEntry) return openedFrom;
  const url = nav.entries()[nav.currentEntry.index - 1]?.url;
  return url && new URL(url).pathname === location.pathname ? new URL(url).hash : null;
}

/** The panel opened, moved to another session or closed: the address follows. */
function follow(id: string | null) {
  const { page, params } = parseHash();
  if (!isPage(page) || (params.session || null) === id) return;
  const without = addressOf(page, params, null);
  if (id && !params.session && !panelBeside()) {
    // Floating, it's a step Back closes.
    openedFrom = without;
    history.pushState(history.state, '', addressOf(page, params, id));
  } else if (id) history.replaceState(history.state, '', addressOf(page, params, id));
  else {
    // A link that closed it has already gone somewhere; otherwise step back off it, or out of the address.
    const at = location.hash;
    setTimeout(() => {
      if (location.hash !== at) return;
      if (previous() === without) history.back();
      else history.replaceState(history.state, '', without);
      openedFrom = null;
    }, 0);
  }
}

let started = false;

/** Follow the address, and keep the open session in it. Once. */
export function startRouter() {
  if (started) return;
  started = true;
  if (!MINI) {
    window.addEventListener('hashchange', route);
    route();
    useUi.subscribe((s, before) => {
      const id = s.session?.id || null;
      if (id !== (before.session?.id || null)) follow(id);
    });
  } else show('overview', {});
}

/** Go to a section (or a link like #sessions?range=7): a step you can go back from. */
export const go = (hash: string) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
