// The Sessions page's view: the range, sort and filters, what's in view, the day
// groups and the saved views.
//
// Range, sort and the days you folded are remembered; a search, a project, a tag
// or a single day is only for now, and lives in the address instead
// (#sessions?project=shop&range=7), so cards elsewhere can link to a view.

import { calendarDay, clip, projectName } from './format';
import { hasTag, isPinned, noteFor, tagsFor, titleFor } from './labels';
import { byTokens, measureOf } from './measure';
import { pageLink, parseDay, type Params } from './route';
import type { SessionInRange } from './sessions';
import { readJson, writeJson } from './storage';

export const PAGE_SIZE = 50;
const VIEW_KEY = 'sessions-view';
export const VIEWS_KEY = 'session-views';
export const RANGES = { today: 'Today', '7': '7 days', '30': '30 days' } as const;
export type Range = keyof typeof RANGES;
/** The ranges in the order they're offered (an object's number-like keys would come first). */
export const RANGE_OPTIONS: [Range, string][] = [
  ['today', 'Today'],
  ['7', '7 days'],
  ['30', '30 days'],
];
export const SORTS = ['latest', 'messages', 'agentMs', 'lines', 'cost'] as const;
export type Sort = (typeof SORTS)[number];
export type Dir = 'asc' | 'desc';
/** The pinned group's key among the days. */
export const PINNED = 0;

const isRange = (r: unknown): r is Range => typeof r === 'string' && r in RANGES;
const isSort = (s: unknown): s is Sort => (SORTS as readonly unknown[]).includes(s);

export type Saved = { range: Range; sort: Sort; dir: Dir; collapsed: number[] };

/** What's remembered: range, sort, and the days you folded (only those still in the list). */
export function readSaved(now = Date.now()): Saved {
  const saved: Saved = { range: '30', sort: 'latest', dir: 'desc', collapsed: [] };
  const stored = readJson<Record<string, unknown>>(VIEW_KEY, {});
  if (isRange(stored.range)) saved.range = stored.range;
  if (isSort(stored.sort)) saved.sort = stored.sort;
  if (stored.dir === 'asc') saved.dir = 'asc';
  const oldest = now - 32 * 86_400_000;
  if (Array.isArray(stored.collapsed))
    saved.collapsed = stored.collapsed.filter(
      (d: unknown) => d === PINNED || (typeof d === 'number' && Number.isFinite(d) && d > oldest),
    );
  return saved;
}

export const writeSaved = (s: Saved) =>
  writeJson(VIEW_KEY, { range: s.range, sort: s.sort, dir: s.dir, collapsed: s.collapsed });

export type View = {
  range: Range;
  sort: Sort;
  dir: Dir;
  day: number | null;
  project: string;
  tag: string;
  query: string;
};

/** The view an address asks for, with the remembered range and sort where it doesn't say. */
export function viewFromParams(params: Params, saved: Pick<Saved, 'range' | 'sort' | 'dir'>): View {
  return {
    day: parseDay(params.day),
    range: isRange(params.range) ? params.range : saved.range,
    sort: isSort(params.sort) ? params.sort : saved.sort,
    dir: params.dir === 'asc' ? 'asc' : params.sort ? 'desc' : saved.dir,
    project: params.project || '',
    tag: params.tag || '',
    query: params.q || '',
  };
}

/** The address for a view: the defaults are left out. */
export function addressOf(v: View, dayParam: (t: number) => string) {
  return {
    day: v.day ? dayParam(v.day) : null,
    range: v.day || v.range === '30' ? null : v.range,
    project: v.project,
    tag: v.tag,
    q: v.query.trim(),
    sort: v.sort === 'latest' ? null : v.sort,
    dir: v.dir === 'asc' ? 'asc' : null,
  };
}

/** The days in view: one day, or a range ending today. */
export function spanOf(v: Pick<View, 'day' | 'range'>, now: number): [number, number] {
  if (v.day) return [v.day, calendarDay(v.day, 1)];
  return [calendarDay(now, v.range === 'today' ? 0 : 1 - Number(v.range)), Infinity];
}

/** Whether a session is in the view's filters; `inside` says the search found it in its conversation. */
export function matches(
  s: SessionInRange,
  v: Pick<View, 'project' | 'tag' | 'query'>,
  inside: (id: string) => boolean = () => false,
) {
  if (v.project && s.project !== v.project) return false;
  if (v.tag && !hasTag(s.id, v.tag)) return false;
  const q = v.query.trim().toLowerCase();
  if (!q) return true;
  return (
    [
      titleFor(s.id, s.title),
      s.title,
      s.project,
      s.project && projectName(s.project),
      s.model,
      noteFor(s.id),
      ...tagsFor(s.id),
    ].some((x) => x?.toLowerCase().includes(q)) || inside(s.id)
  );
}

const SORT_VALUE: Record<Sort, (s: SessionInRange) => number> = {
  latest: (s) => s.lastAt,
  messages: (s) => s.messages,
  agentMs: (s) => s.agentMs,
  lines: (s) => s.added + s.removed,
  cost: (s) => measureOf(s),
};

/** Sorted by the view's column, newest first among equals. */
export function sortRows(rows: SessionInRange[], v: Pick<View, 'sort' | 'dir'>) {
  const value = SORT_VALUE[v.sort];
  const sign = v.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (value(a) - value(b)) || b.lastAt - a.lastAt);
}

export type Group = { key: number; items: SessionInRange[]; open: boolean; shown: SessionInRange[] };

/**
 * Newest first reads best a day at a time, each day with its totals and a fold,
 * with the sessions you pinned above them. A folded day is only its heading, so
 * it doesn't use up the page; `left` is how many rows are past the page.
 */
export function groupRows(
  rows: SessionInRange[],
  collapsed: Set<number>,
  shown: number,
): { groups: Group[]; left: number } {
  const byKey = new Map<number, SessionInRange[]>();
  const pinned = rows.filter((s) => isPinned(s.id));
  if (pinned.length) byKey.set(PINNED, pinned);
  for (const s of rows) {
    if (isPinned(s.id)) continue;
    if (!byKey.has(s.lastDay)) byKey.set(s.lastDay, []);
    byKey.get(s.lastDay)!.push(s);
  }
  const groups: Group[] = [];
  let budget = shown;
  let left = 0;
  let stopped = false;
  for (const [key, items] of byKey) {
    // A list of one group, like a single day, is never folded away.
    const open = byKey.size === 1 || !collapsed.has(key);
    if (stopped || (open && budget <= 0)) {
      stopped = true;
      if (open) left += items.length;
      continue;
    }
    const list = open ? items.slice(0, budget) : [];
    groups.push({ key, items, open, shown: list });
    if (!open) continue;
    if (items.length > budget) {
      left += items.length - budget;
      stopped = true;
    }
    budget -= items.length;
  }
  return { groups, left };
}

/** The keys a "Collapse all days" folds. */
export const groupKeys = (rows: SessionInRange[]) => [
  ...new Set(rows.map((s) => (isPinned(s.id) ? PINNED : s.lastDay))),
];

// ── Saved views ──────────────────────────────────────────────────────────────
//
// A view is the page's filters and sort under a name you give it, like "Shop
// bugs this week". They sit above the list and in ⌘K, and are saved with your
// settings. A single day isn't one, since it's only for now.

export type ViewParams = { range: Range; project: string; tag: string; q: string; sort: Sort; dir: Dir };
export type SavedView = { id: string; name: string; params: ViewParams };
const VIEW_FIELDS = ['range', 'project', 'tag', 'q', 'sort', 'dir'] as const;

export const loadViews = (): SavedView[] =>
  readJson<SavedView[]>(VIEWS_KEY, [], Array.isArray).filter(
    (v) => v && typeof v.name === 'string' && v.params && typeof v.params === 'object',
  );

export const saveViews = (views: SavedView[]) => writeJson(VIEWS_KEY, views.length ? views : null);

export const paramsOf = (v: View): ViewParams => ({
  range: v.range,
  project: v.project,
  tag: v.tag,
  q: v.query.trim(),
  sort: v.sort,
  dir: v.dir,
});
export const sameParams = (a: Partial<ViewParams>, b: Partial<ViewParams>) =>
  VIEW_FIELDS.every((k) => String(a[k] || '') === String(b[k] || ''));
export const isPlain = (p: ViewParams) =>
  p.range === '30' && !p.project && !p.tag && !p.q && p.sort === 'latest' && p.dir !== 'asc';

const SORT_NAMES: Partial<Record<Sort, string>> = {
  messages: 'most messages',
  agentMs: 'most agent time',
  lines: 'most lines',
};
const sortName = (sort: Sort) => (sort === 'cost' ? (byTokens() ? 'most tokens' : 'priciest') : SORT_NAMES[sort]);

/** A name for a view from what it shows: "“timezone” · Shop · bug · 7 days". */
export function suggestName(p: Partial<ViewParams>) {
  return (
    [
      p.q && `“${clip(p.q, 24)}”`,
      p.project && projectName(p.project),
      p.tag,
      p.range && p.range !== '30' && RANGES[p.range],
      p.sort && p.sort !== 'latest' && sortName(p.sort),
    ]
      .filter(Boolean)
      .join(' · ') || 'My view'
  );
}

/** The address a view opens. */
export function viewLink(v: { params: Partial<ViewParams> }) {
  const p = v.params;
  return pageLink('sessions', {
    range: p.range === '30' ? null : p.range,
    project: p.project,
    tag: p.tag,
    q: p.q,
    sort: p.sort === 'latest' ? null : p.sort,
    dir: p.dir === 'asc' ? 'asc' : null,
  });
}
