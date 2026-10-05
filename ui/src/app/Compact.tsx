// The compact layout, for a phone, the menu bar's popover and /mini: a header
// with the logo and a few buttons, and the sections as a tab bar along the foot,
// in your order, with their names under the icons. It stays at the foot on every
// section. In the popover, ↗ opens what's on screen in the dashboard window.

import { ExternalLink, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import logo from '@/assets/favicon.svg';
import { TITLES, type Page } from '@/lib/nav';
import { pageLink } from '@/lib/route';
import { inPopover, openInWindow } from '@/data/desktop';
import { refreshLimits, useLimits } from '@/data/limits';
import { IconButton } from '@/components/Button';
import { cx } from '@/components/cx';
import { MINI, useRoute } from './router';
import { useUi } from './ui';
import { Badge, ICONS } from './sections';

export function CompactHeader() {
  const refreshing = useLimits((s) => s.refreshing);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const page = useRoute((s) => s.page);
  // /mini opens sections in the dashboard, in a tab of its own.
  const settingsHref = MINI ? `./${pageLink('settings')}` : pageLink('settings');
  return (
    <header className="flex h-12 items-center gap-2 px-3.5 pt-1">
      <a href={MINI ? './mini' : pageLink('overview')} className="flex items-center gap-2 text-ink no-underline">
        <img src={logo} alt="" width={24} height={24} className="size-6 rounded-[6px]" />
        <span className="text-body font-bold">Overtime</span>
      </a>
      <div className="ml-auto flex items-center gap-1.5">
        {!inPopover && !MINI && (
          <IconButton label="Search" tip="Search (⌘K)" size="sm" onClick={() => setPaletteOpen(true)}>
            <Search size={14} strokeWidth={1.9} aria-hidden />
          </IconButton>
        )}
        <IconButton
          label="Refresh"
          size="sm"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={() => refreshLimits()}
        >
          <RefreshCw size={14} strokeWidth={1.9} className={refreshing ? 'animate-spin' : ''} aria-hidden />
        </IconButton>
        <a
          href={settingsHref}
          target={MINI ? '_blank' : undefined}
          rel={MINI ? 'noopener' : undefined}
          aria-label="Settings"
          data-tip="Settings"
          className="grid size-7 place-items-center rounded-control border border-line bg-card text-muted hover:text-ink"
        >
          <SlidersHorizontal size={14} strokeWidth={1.9} aria-hidden />
        </a>
        {(inPopover || MINI) && (
          <a
            href={MINI ? './' : pageLink(page)}
            target={MINI ? '_blank' : undefined}
            rel={MINI ? 'noopener' : undefined}
            onClick={(e) => {
              if (!inPopover) return;
              e.preventDefault();
              // With a session's panel open, the window opens with it.
              const open = useUi.getState().session;
              openInWindow(open ? `#session=${open.id}` : location.hash || '#overview');
            }}
            aria-label="Open in the window"
            data-tip={inPopover ? 'Open this in the dashboard window' : 'Open the dashboard'}
            className="grid size-7 place-items-center rounded-control border border-line bg-card text-muted hover:text-ink"
          >
            <ExternalLink size={14} strokeWidth={1.9} aria-hidden />
          </a>
        )}
      </div>
    </header>
  );
}

function Tab({ page }: { page: Page }) {
  const current = useRoute((s) => s.page) === page;
  const Icon = ICONS[page];
  const href = MINI ? (page === 'overview' ? './mini' : `./${pageLink(page)}`) : pageLink(page);
  return (
    <a
      href={href}
      target={MINI && page !== 'overview' ? '_blank' : undefined}
      rel={MINI && page !== 'overview' ? 'noopener' : undefined}
      aria-current={current ? 'page' : undefined}
      // A tab tapped or clicked lets go of the focus, so no ring shows on it when the window comes back.
      onClick={(e) => e.detail && e.currentTarget.blur()}
      className={cx(
        'mobile-tab relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-control text-[10px] no-underline',
        current ? 'font-bold text-ink' : 'font-medium text-muted',
      )}
    >
      <Icon size={20} strokeWidth={current ? 2.1 : 1.8} aria-hidden />
      <span className="max-w-full truncate leading-4">{TITLES[page]}</span>
      <Badge
        page={page}
        className="absolute left-[calc(50%+5px)] top-1 h-4 min-w-4 bg-warn-fill px-1 text-[10px] text-[#1c1e22]"
      />
    </a>
  );
}

export function TabBar() {
  const nav = useUi((s) => s.nav);
  const shown = nav.order.filter((p) => !nav.hidden.has(p));
  // Keep fixed navigation outside page containers, which can establish their own
  // containing block. Its dimensions are independent of the section's content.
  return createPortal(
    <nav
      aria-label="Sections"
      className="mobile-tabbar fixed inset-x-0 bottom-0 z-[900] grid border-t border-line bg-card"
      style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
    >
      {shown.map((page) => (
        <Tab key={page} page={page} />
      ))}
    </nav>,
    document.body,
  );
}
