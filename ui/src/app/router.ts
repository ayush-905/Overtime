// Which section is on screen, from the address: `#cost` opens a section,
// `#sessions?day=2026-09-24` one with its filters, and `#session=<id>` a
// session's panel over the section you were on. Anything else goes to the section
// you were last on.
//
// In the menu bar's popover the Overview is the summary; at /mini the page is
// only the summary. The dashboard proper remembers where you were.

import { create } from 'zustand';
import { PAGES, type Page } from '@/lib/nav';
import { parseHash, type Params } from '@/lib/route';
import { env } from '@/lib/env';
import { inPopover } from '@/data/desktop';

const PAGE_KEY = 'overtime-page';

export const MINI = /\/mini\/?$/.test(location.pathname);
/** The dashboard proper, which chimes and remembers where you were: not /mini, not the popover. */
export const MAIN = !MINI && !inPopover;

/** Pages that aren't sections: #parts shows every component, for checking the design. */
export const HIDDEN_PAGES = ['parts'] as const;
export type RoutePage = Page | (typeof HIDDEN_PAGES)[number];

type RouteState = {
  page: RoutePage;
  params: Params;
  /** A session asked for by the address (#session=…), for its panel to open. */
  session: string | null;
  sessionHandled: () => void;
};

function savedPage(): Page {
  if (!MAIN) return 'overview';
  try {
    const saved = localStorage.getItem(PAGE_KEY);
    if ((PAGES as readonly string[]).includes(saved || '')) return saved as Page;
  } catch {}
  return 'overview';
}

export const useRoute = create<RouteState>((set) => ({
  page: savedPage(),
  params: {},
  session: null,
  sessionHandled: () => set({ session: null }),
}));

const isPage = (p: string): p is RoutePage => (PAGES as readonly string[]).includes(p) || (HIDDEN_PAGES as readonly string[]).includes(p);

function route() {
  const hash = location.hash.replace('#', '');
  const current = useRoute.getState().page;
  const session = hash.match(/^session=([\w-]+)$/)?.[1];
  if (session) {
    history.replaceState(history.state, '', `#${current}`);
    show(current, {});
    useRoute.setState({ session });
    return;
  }
  const { page: name, params } = parseHash();
  const next = isPage(name) ? name : current;
  // The address always names the section, so its filters can be written into it.
  if (name !== next) history.replaceState(history.state, '', `#${next}`);
  show(next, name === next ? params : {});
}

function show(page: RoutePage, params: Params) {
  const was = useRoute.getState().page;
  env.page = page;
  useRoute.setState({ page, params });
  if (MAIN && page !== 'parts') try { localStorage.setItem(PAGE_KEY, page); } catch {}
  if (page !== was) window.scrollTo(0, 0);
}

let started = false;

/** Follow the address. Once. */
export function startRouter() {
  if (started) return;
  started = true;
  if (!MINI) {
    window.addEventListener('hashchange', route);
    route();
  } else show('overview', {});
}

/** Go to a section (or a link like #sessions?range=7): a step you can go back from. */
export const go = (hash: string) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
