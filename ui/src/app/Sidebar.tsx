// The sidebar: the logo, search (⌘K), the sections in their groups in your order,
// the provider filter and Settings. Folded (⌘B, or when the window is narrow) it's
// a rail of icons that name themselves on hover. Drag a section up or down within
// its group to move it (or Alt+↑/↓ on one), and drag the edge to make the sidebar
// wider or narrower: narrow enough and it folds, a double click puts it back. The
// dragging comes with SortableSections.tsx, which loads once the page is up
// (later.tsx); until then the sections are plain links, and Alt+↑/↓ works on them.

import {
  forwardRef,
  useLayoutEffect,
  useMemo,
  useRef,
  type AnchorHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Search } from 'lucide-react';
import logo from '@/assets/favicon.svg';
import { GROUPS, TITLES, groupOf, moveSection, type Page } from '@/lib/nav';
import { SIDE, type Provider } from '@/lib/prefs';
import { SOURCE, andList } from '@/lib/sources';
import { useSources } from '@/data/scope';
import { pageLink } from '@/lib/route';
import { useLive } from '@/data/live';
import { MOD } from '@/data/hooks';
import { cx } from '@/components/cx';
import { Kbd } from '@/components/Bits';
import { useRoute } from './router';
import { useUi } from './ui';
import { Badge, ICONS } from './sections';
import { SideUsage } from './SideUsage';
import { later } from './later';

type LinkProps = { page: Page; folded: boolean; dragging?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>;

export const NavLink = forwardRef<HTMLAnchorElement, LinkProps>(function NavLink(
  { page, folded, dragging, className, style, ...rest },
  ref,
) {
  const current = useRoute((s) => s.page) === page;
  const Icon = ICONS[page];
  return (
    <a
      ref={ref}
      href={pageLink(page)}
      aria-current={current ? 'page' : undefined}
      data-tip={folded ? TITLES[page] : undefined}
      style={style}
      className={cx(
        'relative flex h-[34px] shrink-0 items-center gap-2.5 rounded-control px-2.5 text-body text-ink no-underline outline-offset-[-2px]',
        current ? 'bg-card font-semibold shadow-card' : 'hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]',
        folded && 'justify-center px-0',
        dragging && 'z-10 opacity-80 shadow-raised',
        className,
      )}
      {...rest}
    >
      <Icon size={18} strokeWidth={1.8} className={current ? 'text-ink' : 'text-muted'} aria-hidden />
      {!folded && <span className="grow truncate">{TITLES[page]}</span>}
      <Badge page={page} className={folded ? 'absolute right-0.5 top-0 h-4 min-w-4 px-1 text-[10px]' : ''} />
    </a>
  );
});

/** Alt+↑/↓ on a section moves it up or down within its group. */
export const moveKeys = (page: Page) => (e: KeyboardEvent<HTMLAnchorElement>) => {
  if (!e.altKey || e.metaKey || e.ctrlKey) return;
  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
  if (!step) return;
  e.preventDefault();
  const { nav, setNav } = useUi.getState();
  const next = moveSection(nav, page, step);
  if (next) setNav(next);
};

/** The sections in their groups, each drawn by `item`. */
export function SectionList({
  shown,
  folded,
  item,
}: {
  shown: Page[];
  folded: boolean;
  item: (page: Page) => ReactNode;
}) {
  return shown.map((page, i) => {
    const group = GROUPS[page];
    const heading = group && group !== groupOf(shown[i - 1] || '') ? group : null;
    return (
      <div key={page} className="relative flex shrink-0 flex-col">
        {heading && !folded && (
          <span className="px-2.5 pb-1 pt-3.5 text-group font-semibold uppercase tracking-[0.06em] text-muted">
            {heading}
          </span>
        )}
        {heading && folded && <span className="mx-auto my-2 h-px w-5 bg-line" aria-hidden />}
        {item(page)}
      </div>
    );
  });
}

const LIST = 'nav[aria-label="Dashboard sections"]';
// The section that had the keyboard's focus as the plain links made way for the ones you can drag.
let focused: string | null = null;

/** Give the focus back to the section that had it before the list was drawn again. */
export function takeFocusBack() {
  const href = focused;
  focused = null;
  if (href) document.querySelector<HTMLElement>(`${LIST} a[href="${CSS.escape(href)}"]`)?.focus();
}

/** The sections as plain links: in the rail, and until the dragging has loaded. */
function PlainSections({ shown, folded }: { shown: Page[]; folded: boolean }) {
  useLayoutEffect(() => {
    focused = null;
    return () => {
      if (!folded)
        focused = (document.activeElement as HTMLElement | null)?.closest?.(`${LIST} a`)?.getAttribute('href') || null;
    };
  }, [folded]);
  return (
    <SectionList
      shown={shown}
      folded={folded}
      item={(page) =>
        folded ? <NavLink page={page} folded /> : <NavLink page={page} folded={false} onKeyDown={moveKeys(page)} />
      }
    />
  );
}

const SortableSections = later(() => import('./SortableSections').then((m) => m.SortableSections), PlainSections);

/** The provider filter: all of them, or one on its own. */
function useProviders(): [Provider, string, string][] {
  const sources = useSources();
  return useMemo(
    () => [
      ['all', 'All', `${andList(sources.map((s) => SOURCE[s].name))} together`],
      ...sources.map((s): [Provider, string, string] => [s, SOURCE[s].short, `${SOURCE[s].name} only`]),
    ],
    [sources],
  );
}

function ProviderSwitch({ folded }: { folded: boolean }) {
  const provider = useLive((s) => s.provider);
  const setProvider = useLive((s) => s.setProvider);
  const PROVIDERS = useProviders();
  // With one provider on this Mac, there's nothing to switch between.
  if (PROVIDERS.length < 3) return null;
  if (folded) {
    // Folded, it shows the provider in view; a click moves to the next.
    const i = Math.max(
      0,
      PROVIDERS.findIndex(([p]) => p === provider),
    );
    const [, label, tip] = PROVIDERS[i];
    const next = PROVIDERS[(i + 1) % PROVIDERS.length];
    return (
      <button
        type="button"
        onClick={() => setProvider(next[0])}
        data-tip={`Showing: ${tip}. Click for ${next[2].toLowerCase()}.`}
        className="h-7 rounded-[7px] bg-sunken text-label font-semibold"
      >
        {label}
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label="Provider"
      className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-[9px] bg-sunken p-[3px]"
    >
      {PROVIDERS.map(([p, label, tip]) => (
        <button
          key={p}
          type="button"
          aria-pressed={provider === p}
          data-tip={tip}
          onClick={() => setProvider(p)}
          className={cx(
            'h-7 rounded-[7px] text-detail',
            provider === p ? 'bg-card font-semibold text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The edge between the sidebar and the page: drag it, double-click it, or use the arrow keys on it. */
function Edge() {
  const folded = useUi((s) => s.folded);
  const setFolded = useUi((s) => s.setFolded);
  const setSideWidth = useUi((s) => s.setSideWidth);
  const width = useUi((s) => s.sideWidth);
  const drag = useRef<{ id: number } | null>(null);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId };
    document.documentElement.classList.add('select-none');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const x = e.clientX;
    if (x < SIDE.fold) {
      setFolded(true);
      return;
    }
    if (useUi.getState().folded && x > SIDE.fold + 40) setFolded(false);
    if (!useUi.getState().folded) setSideWidth(x, false);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.documentElement.classList.remove('select-none');
    setSideWidth(useUi.getState().sideWidth);
  };
  const key = (e: KeyboardEvent) => {
    const by = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!by) return;
    e.preventDefault();
    if (folded && by > 0) setFolded(false);
    else if (!folded && by < 0 && width + by < SIDE.min) setFolded(true);
    else if (!folded) setSideWidth(width + by);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuenow={folded ? 0 : width}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onDoubleClick={() => {
        setFolded(false);
        setSideWidth(SIDE.usual);
      }}
      onKeyDown={key}
      data-tip="Drag to resize · double-click for the usual width"
      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize outline-none after:absolute after:left-[3px] after:top-0 after:h-full after:w-0.5 after:bg-transparent hover:after:bg-line-strong focus-visible:after:bg-accent"
    />
  );
}

export function Sidebar() {
  const folded = useUi((s) => s.folded);
  const nav = useUi((s) => s.nav);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const shown = useMemo(() => nav.order.filter((p) => !nav.hidden.has(p)), [nav]);

  return (
    <aside
      aria-label="Sections"
      className="sticky top-0 flex h-dvh shrink-0 flex-col gap-4 border-r border-line bg-side px-3.5 pb-4 pt-5"
      style={{ width: folded ? 'var(--rail-w)' : 'var(--side-w)', paddingInline: folded ? 10 : undefined }}
    >
      <a
        href={pageLink('overview')}
        className={cx(
          'flex shrink-0 items-center gap-2.5 px-1.5 text-ink no-underline',
          folded && 'justify-center px-0',
        )}
      >
        <img src={logo} alt="" width={28} height={28} className="size-7 rounded-[7px]" />
        {!folded && <span className="text-[15px] font-bold tracking-[-0.01em]">Overtime</span>}
      </a>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        data-tip={folded ? `Search (${MOD}K)` : undefined}
        aria-label="Search"
        className={cx(
          'flex h-[34px] shrink-0 items-center gap-2 rounded-[9px] border border-line bg-card px-2.5 text-detail text-muted',
          folded && 'justify-center px-0',
        )}
      >
        <Search size={16} strokeWidth={1.8} aria-hidden />
        {!folded && (
          <>
            <span className="grow text-left">Search</span>
            <Kbd>{MOD.replace('+', '')}K</Kbd>
          </>
        )}
      </button>

      <nav aria-label="Dashboard sections" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {folded ? <PlainSections shown={shown} folded /> : <SortableSections shown={shown} folded={false} />}
      </nav>

      <div className="flex shrink-0 flex-col gap-3">
        <SideUsage folded={folded} />
        <ProviderSwitch folded={folded} />
        <nav aria-label="Settings" className="flex flex-col">
          <NavLink page="settings" folded={folded} />
        </nav>
      </div>
      <Edge />
    </aside>
  );
}
