// ⌘K (Ctrl+K elsewhere): go to any section, saved view, tag, project or session,
// find words inside conversations, or run an action. ↑↓ move, ↵ opens, Esc
// closes.

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Dialog as Radix } from 'radix-ui';
import {
  ArrowLeftRight, Bookmark, CalendarDays, ChevronRight, CircleDollarSign, Grid3x3, LayoutPanelTop, Droplet, ExternalLink, Keyboard, Layers, LayoutPanelLeft, List, Moon, RefreshCw, Search, SlidersHorizontal, Sun, SunMoon, Tag, Type, BarChart3,
} from 'lucide-react';
import { PAGES, TITLES, type Page } from '@/lib/nav';
import { pageLink } from '@/lib/route';
import { clip, projectHue, projectName } from '@/lib/format';
import { allTags, isPinned, noteFor, tagsFor, titleFor } from '@/lib/labels';
import { highlightParts, queryTerms, score } from '@/lib/search';
import { setMeasure } from '@/lib/measure';
import { setTheme, toggleTheme } from '@/lib/prefs';
import { stepAppearance, appearance } from '@/lib/appearance';
import { SOURCE, andList, sourcesIn, type Source } from '@/lib/sources';
import { useSessions, useSearch, type SearchResult } from '@/data/queries';
import { useLive } from '@/data/live';
import { refreshLimits } from '@/data/limits';
import { demo } from '@/data/api';
import { MOD, useChanged } from '@/data/hooks';
import { Avatar, Kbd } from '@/components/Bits';
import { cx } from '@/components/cx';
import { go } from './router';
import { useUi } from './ui';
import { ICONS } from './sections';
import { loadViews, viewLink } from '@/lib/sessionsView';
import { useCompare } from './dialogs';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

type Item =
  | { kind: 'page'; id: Page; title: string; icon: Icon; hint: string }
  | { kind: 'action'; id: string; title: string; icon: Icon; hint: string; run: () => void }
  | { kind: 'link'; id: string; title: string; icon: Icon; hint: string }
  | { kind: 'project'; id: string; title: string; hint: string }
  | { kind: 'session'; id: string; source: Source; title: string; hint: string }
  | { kind: 'said'; id: string; source: Source; title: string; hint: string; quote: SearchResult['hits'][number]; count: number; q: string };

type Action = { id: string; title: string; hint?: string; icon: Icon; keywords?: string; run: () => void };

/** Open a section at one of its cards: once the section is drawn (it may still be loading), scroll to it. */
function showCard(page: Page, selector: string) {
  go(pageLink(page));
  const until = Date.now() + 4000;
  const find = () => {
    const el = document.querySelector(selector);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (Date.now() < until) setTimeout(find, 100);
  };
  setTimeout(find, 50);
}

function actions(): Action[] {
  const setProvider = useLive.getState().setProvider;
  const sources = sourcesIn(useLive.getState().snap?.analytics);
  const ui = useUi.getState();
  return [
    { id: 'digest-now', title: 'Your week so far', hint: 'Digest', icon: CalendarDays, keywords: 'digest weekly review this week', run: () => ui.setDigest(0) },
    { id: 'digest', title: 'Last week in review', hint: 'Digest', icon: CalendarDays, keywords: 'digest weekly report', run: () => ui.setDigest(1) },
    { id: 'customize', title: 'Customize the Overview', icon: LayoutPanelTop, keywords: 'layout cards widgets arrange', run: () => { go(pageLink('overview')); ui.setCustomizing(true); } },
    { id: 'heatmap', title: 'Activity heatmap', hint: 'You', icon: Grid3x3, keywords: 'calendar history contributions streak', run: () => showCard('you', '[data-card="heatmap"]') },
    { id: 'plans', title: 'What your plans are worth', hint: 'Cost', icon: CircleDollarSign, keywords: 'subscription value roi price', run: () => showCard('cost', '[data-card="plan"]') },
    { id: 'personal', title: 'Currency, plans and your working day', hint: 'Settings', icon: SlidersHorizontal, keywords: 'rupee inr currency clock 24 hour workday personal settings', run: () => showCard('settings', '#personal-settings') },
    { id: 'sidebar-order', title: 'Reorder or hide sidebar sections', hint: 'Settings', icon: List, keywords: 'navigation menu sections hide', run: () => showCard('settings', '#nav-edit') },
    { id: 'by-tokens', title: 'Compare by tokens', hint: 'Settings', icon: BarChart3, keywords: 'measure tokens usage sort rank primary subscription', run: () => setMeasure('tokens') },
    { id: 'by-cost', title: 'Compare by cost', hint: 'Settings', icon: CircleDollarSign, keywords: 'measure cost money price sort rank primary', run: () => setMeasure('cost') },
    ...(sources.length > 1 ? [
      { id: 'all', title: `Show ${andList(sources.map((s) => SOURCE[s].name))}`, icon: Layers, keywords: 'provider all both every filter', run: () => setProvider('all') },
      ...sources.map((s) => ({ id: s, title: `Show ${SOURCE[s].name} only`, icon: Layers, keywords: `provider filter${s === 'codex' ? ' openai' : s === 'claude' ? ' anthropic' : ''}`, run: () => setProvider(s) })),
    ] : []),
    { id: 'refresh', title: 'Refresh limits', icon: RefreshCw, keywords: 'reload update', run: () => refreshLimits() },
    { id: 'sidebar', title: 'Hide or show the sidebar', hint: `${MOD}B`, icon: LayoutPanelLeft, keywords: 'rail fold', run: () => useUi.getState().toggleFolded() },
    { id: 'switch-theme', title: 'Switch between light and dark', hint: 'T', icon: SunMoon, keywords: 'theme appearance dark light mode toggle', run: toggleTheme },
    { id: 'light', title: 'Light theme', icon: Sun, keywords: 'appearance', run: () => setTheme('light') },
    { id: 'dark', title: 'Dark theme', icon: Moon, keywords: 'appearance night', run: () => setTheme('dark') },
    { id: 'system', title: 'Theme like your Mac', icon: SlidersHorizontal, keywords: 'appearance auto system', run: () => setTheme('auto') },
    { id: 'density', title: 'Compact or comfortable rows', hint: 'Density', icon: List, keywords: 'density compact dense tight spacing', run: () => stepAppearance('density', appearance('density') === 'compact' ? -1 : 1) },
    { id: 'text-up', title: 'Larger text', icon: Type, keywords: 'font size bigger zoom accessibility', run: () => stepAppearance('text', 1) },
    { id: 'text-down', title: 'Smaller text', icon: Type, keywords: 'font size zoom', run: () => stepAppearance('text', -1) },
    { id: 'colours', title: 'Colour themes', hint: 'Settings', icon: Droplet, keywords: 'colour color theme accent palette aubergine ocean forest sunset graphite', run: () => go(pageLink('settings')) },
    { id: 'next-colours', title: 'Next colour theme', icon: Droplet, keywords: 'colour color theme cycle palette', run: () => stepAppearance('palette', 1) },
    { id: 'compare', title: 'Compare two sessions', icon: ArrowLeftRight, keywords: 'compare side by side diff versus vs', run: () => useCompare.getState().show() },
    { id: 'keys', title: 'Keyboard shortcuts', hint: '?', icon: Keyboard, keywords: 'help keys', run: () => useUi.getState().setKeysOpen(true) },
    { id: 'office', title: 'Open the pixel office', icon: ExternalLink, keywords: 'office pixel', run: () => window.open('/office/', '_blank', 'noopener') },
  ];
}


function useItems(query: string, open: boolean) {
  useChanged();
  const { data: sessions } = useSessions({ enabled: open });
  const [inside, setInside] = useState('');
  const q = query.trim().toLowerCase();
  // Inside conversations, a moment after you stop typing.
  useEffect(() => {
    const t = setTimeout(() => setInside(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);
  const serverSearch = useLive((s) => s.snap?.prefs?.search !== false);
  const searchOn = !demo && serverSearch;
  const said = useSearch(inside, { on: searchOn, limit: 12 });
  return useMemo(() => {
    const pick = <T,>(list: T[], text: (x: T) => string, limit: number) =>
      list.map((x) => ({ x, s: score(text(x), q) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((r) => r.x);
    const all = [...(sessions || [])].sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)) || b.lastAt - a.lastAt);
    const projects = [...new Set(all.map((s) => s.project).filter(Boolean) as string[])];
    // Every section, hidden ones too.
    const pages = PAGES.map((id) => ({ id, title: TITLES[id] }));
    const groups: [string, Item[]][] = [
      ['Go to', pick(pages, (p) => p.title, 8).map((p) => ({ kind: 'page', id: p.id, title: p.title, icon: ICONS[p.id], hint: '' }))],
      ['Actions', pick(actions(), (a) => `${a.title} ${a.keywords || ''}`, q ? 6 : 4).map((a) => ({ kind: 'action', id: a.id, title: a.title, icon: a.icon, hint: a.hint || '', run: a.run }))],
      ['Views', pick(loadViews(), (v) => v.name, q ? 5 : 3).map((v) => ({ kind: 'link', id: viewLink(v), title: v.name, icon: Bookmark, hint: 'Saved view' }))],
      ['Tags', q ? pick(allTags(), ([t]) => t, 4).map(([t, n]) => ({ kind: 'link', id: `#sessions?tag=${encodeURIComponent(t)}`, title: t, icon: Tag, hint: `${n} session${n === 1 ? '' : 's'}` })) : []],
      ['Projects', pick(projects, (p) => `${projectName(p)} ${p}`, q ? 5 : 3).map((p) => ({ kind: 'project', id: p, title: projectName(p), hint: 'Project' }))],
      ['Sessions', pick(all, (s) => `${titleFor(s.id, s.title)} ${s.project ? projectName(s.project) : ''} ${tagsFor(s.id).join(' ')} ${noteFor(s.id)}`, q ? 8 : 5).map((s) => ({ kind: 'session', id: s.id, source: s.source, title: titleFor(s.id, s.title), hint: tagsFor(s.id)[0] || (s.project ? projectName(s.project) : '') }))],
      ['In conversations', said.data && inside === query.trim() ? said.data.results.slice(0, 6).map((r) => ({ kind: 'said', id: r.session, source: r.source, title: titleFor(r.session, r.title), quote: r.hits[0], count: r.count, q: inside, hint: r.project ? projectName(r.project) : '' })) : []],
    ];
    return { groups: groups.filter(([, list]) => list.length) as [string, Item[]][], searching: searchOn && q.length >= 2 && (said.isFetching || inside !== query.trim()) };
  }, [q, query, sessions, said.data, said.isFetching, inside, searchOn]);
}

function run(it: Item) {
  useUi.getState().setPaletteOpen(false);
  if (it.kind === 'page') go(pageLink(it.id));
  else if (it.kind === 'link') go(it.id);
  else if (it.kind === 'project') go(pageLink('projects', { p: it.id }));
  else if (it.kind === 'action') it.run();
  else go(`#session=${encodeURIComponent(it.id)}`);
}

export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const { groups, searching } = useItems(open ? query : '', open);
  const items = groups.flatMap(([, g]) => g);
  const at = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    list.current?.querySelector(`#pal-${at}`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  let n = 0;
  return (
    <Radix.Root open={open} onOpenChange={setOpen}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-[3000] bg-[var(--scrim)]" />
        <Radix.Content
          aria-label="Search"
          className="fixed left-1/2 top-[12vh] z-[3001] flex max-h-[70vh] w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-line bg-raised shadow-raised outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector('input')?.focus();
          }}
        >
          <Radix.Title className="sr-only">Search</Radix.Title>
          <Radix.Description className="sr-only">Go to a section, project or session, find what was said, or run an action</Radix.Description>
          <label className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={17} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
            <input
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="pal-list"
              aria-autocomplete="list"
              aria-activedescendant={items.length ? `pal-${at}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => (items.length ? (a + 1) % items.length : 0));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
                } else if (e.key === 'Enter' && items[at]) {
                  e.preventDefault();
                  run(items[at]);
                }
              }}
              placeholder="Go to a section, project or session, find what was said, or run an action"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search"
              className="h-12 grow bg-transparent text-body outline-none placeholder:text-muted"
            />
          </label>
          <ul id="pal-list" ref={list} role="listbox" aria-label="Results" className="overflow-y-auto p-1.5">
            {groups.length ? (
              groups.map(([name, group]) => (
                <li key={name} role="presentation">
                  <span className="block px-2.5 pb-1 pt-2.5 text-group font-semibold uppercase tracking-[0.06em] text-muted">{name}</span>
                  <ul role="presentation">
                    {group.map((it) => {
                      const i = n++;
                      const on = i === at;
                      return (
                        <li
                          key={`${it.kind}:${it.id}`}
                          id={`pal-${i}`}
                          role="option"
                          aria-selected={on}
                          onMouseMove={() => i !== at && setActive(i)}
                          onClick={() => run(it)}
                          className={cx('flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2', on && 'bg-sunken')}
                        >
                          {it.kind === 'project' ? (
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: `hsl(${projectHue(it.id)} 55% 50%)` }} aria-hidden />
                          ) : it.kind === 'session' || it.kind === 'said' ? (
                            <Avatar source={it.source} size={18} />
                          ) : (
                            <it.icon size={16} strokeWidth={1.8} className="shrink-0 text-muted" />
                          )}
                          {it.kind === 'said' ? (
                            <span className="flex min-w-0 grow flex-col">
                              <span className="truncate text-body">{clip(it.title, 70)}</span>
                              <em className="truncate text-detail not-italic text-muted">
                                <b className="font-semibold text-ink">{it.quote.who === 'you' ? 'You' : 'Agent'}</b>{' '}
                                {highlightParts(it.quote.text, queryTerms(it.q)).map((p, k) => (p.mark ? <mark key={k} className="rounded-sm bg-warn-soft text-ink">{p.text}</mark> : <span key={k}>{p.text}</span>))}
                              </em>
                            </span>
                          ) : (
                            <span className="min-w-0 grow truncate text-body">{clip(it.title, 80)}</span>
                          )}
                          {(it.kind === 'said' ? (it.count > 1 ? `${it.count} matches` : it.hint) : it.hint) && (
                            <small className="shrink-0 text-label text-muted">{clip(it.kind === 'said' && it.count > 1 ? `${it.count} matches` : it.hint, 30)}</small>
                          )}
                          {on && <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            ) : (
              <li role="presentation" className="px-3 py-6 text-center text-detail text-muted">
                {searching ? `Looking inside conversations for “${clip(query, 40)}”…` : `Nothing matches “${clip(query, 40)}”.`}
              </li>
            )}
          </ul>
          <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-label text-muted">
            <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span>
            <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> to open</span>
            <span className="inline-flex items-center gap-1"><Kbd>esc</Kbd> to close</span>
            <span className="inline-flex items-center gap-1"><Kbd>?</Kbd> for every shortcut</span>
          </p>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
