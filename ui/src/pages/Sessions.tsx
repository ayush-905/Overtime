// The Sessions page: every session of the last 30 days, to search (by title,
// project, your notes and tags, and inside the conversations while that's on),
// narrow to a project, a tag, a range or one day, sort by a column, and save as
// a view you come back to. Newest first, it's a day at a time, with the sessions
// you pinned above. The band says what's in view; a row opens the session panel.
// The filters live in the address (lib/sessionsView), so cards elsewhere link to
// a view of this page. Its store (useSessionsView) holds the view, the days you
// folded and how many rows show.

import { Fragment, memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { Bookmark, ChevronDown, Search, X } from 'lucide-react';
import { useChanged, useMinute } from '@/data/hooks';
import { useSessions, useSearch, type SearchResult } from '@/data/queries';
import { useAllAgents } from '@/data/scope';
import { demo } from '@/data/api';
import { useLive } from '@/data/live';
import {
  ago,
  calendarDay,
  clip,
  clock,
  compact,
  costText,
  dayLabel,
  duration,
  money,
  plural,
  projectName,
} from '@/lib/format';
import { allTags, customName, titleFor } from '@/lib/labels';
import { byTokens, MEASURES, measureCol, measureOf, otherText, setMeasure } from '@/lib/measure';
import { env, serverNow } from '@/lib/env';
import { dayParam, replaceParams } from '@/lib/route';
import { queryTerms } from '@/lib/search';
import { sessionsIn, type SessionInRange } from '@/lib/sessions';
import { doingText, liveStateOf, type LiveAgent } from '@/lib/agents';
import {
  addressOf,
  RANGE_OPTIONS,
  groupKeys,
  groupRows,
  isPlain,
  loadViews,
  matches,
  PAGE_SIZE,
  paramsOf,
  PINNED,
  RANGES,
  readSaved,
  sameParams,
  saveViews,
  sortRows,
  spanOf,
  suggestName,
  viewFromParams,
  viewLink,
  VIEWS_KEY,
  writeSaved,
  type Range,
  type SavedView,
  type Sort,
  type View,
} from '@/lib/sessionsView';
import { Card, CardHead } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { Seg } from '@/components/Seg';
import { Button } from '@/components/Button';
import { Empty, Insight, Marked, Skeleton } from '@/components/Bits';
import { Dropdown } from '@/components/Dropdown';
import { SessionRow } from '@/components/SessionRow';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { useRoute } from '@/app/router';
import { useCompact } from '@/app/layout';
import { offerUndo } from '@/app/toasts';
import { SOURCE } from '@/lib/sources';
import { onOtherTab } from '@/lib/storage';
import { median } from '@shared/sums.js';

// ── The view ─────────────────────────────────────────────────────────────────

type ViewState = {
  view: View;
  collapsed: Set<number>;
  shown: number;
  set: (patch: Partial<View>) => void;
  fold: (keys: number[], closed: boolean) => void;
  more: () => void;
};

const saved = readSaved();

/** Remember the range, sort and folds, and write the rest into the address. */
function persist(view: View, collapsed: Set<number>) {
  writeSaved({ range: view.range, sort: view.sort, dir: view.dir, collapsed: [...collapsed] });
  replaceParams('sessions', addressOf(view, dayParam));
}

export const useSessionsView = create<ViewState>((set, get) => ({
  view: viewFromParams({}, saved),
  collapsed: new Set(saved.collapsed),
  shown: PAGE_SIZE,
  set: (patch) => {
    const view = { ...get().view, ...patch };
    set({ view, shown: PAGE_SIZE });
    persist(view, get().collapsed);
  },
  fold: (keys, closed) => {
    const collapsed = new Set(get().collapsed);
    for (const k of keys) {
      if (closed) collapsed.add(k);
      else collapsed.delete(k);
    }
    set({ collapsed });
    persist(get().view, collapsed);
  },
  more: () => set({ shown: get().shown + PAGE_SIZE }),
}));

/** Open the page on the view the address asks for (a card's link, a saved view, ⌘K). */
function useFollowAddress() {
  const params = useRoute((s) => s.params);
  const page = useRoute((s) => s.page);
  useEffect(() => {
    if (page !== 'sessions') return;
    const now = readSaved();
    const view = viewFromParams(params, now);
    useSessionsView.setState({ view, shown: PAGE_SIZE });
    replaceParams('sessions', addressOf(view, dayParam));
  }, [params, page]);
}

/** The search inside conversations, a moment after you stop typing; its matches by session. */
function useInside(query: string) {
  const on = useLive((s) => s.snap?.prefs?.search !== false) && !demo;
  const [asked, setAsked] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);
  const res = useSearch(asked, { on, limit: 100 });
  const current = asked === query.trim() && asked.length >= 2;
  const bySession = useMemo(
    () => new Map<string, SearchResult>((current ? res.data?.results || [] : []).map((r) => [r.session, r])),
    [res.data, current],
  );
  return { on, bySession, loading: on && query.trim().length >= 2 && (!current || res.isFetching) };
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function dayName(day: number) {
  const today = calendarDay(serverNow());
  if (day === today) return 'Today';
  if (day === calendarDay(today, -1)) return 'Yesterday';
  return new Date(day).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

/** A moment, with its day unless that's today: "3:02pm", or "Sep 24, 3:02pm". */
const at = (t: number) => (calendarDay(t) === calendarDay(serverNow()) ? clock(t) : `${dayLabel(t)}, ${clock(t)}`);

/** When it ran: the times on a day's list, or the last activity on a list sorted otherwise. */
function whenLine(s: SessionInRange, grouped: boolean) {
  if (!grouped) return `last active ${at(s.lastAt)}`;
  if (calendarDay(s.startedAt) !== calendarDay(s.lastAt))
    return `since ${dayLabel(s.startedAt)} · last ${clock(s.lastAt)}`;
  return clock(s.startedAt) === clock(s.lastAt) ? clock(s.lastAt) : `${clock(s.startedAt)}–${clock(s.lastAt)}`;
}

function whenText(v: View) {
  if (v.day) return `on ${dayName(v.day).replace(/^(Today|Yesterday)$/, (d) => d.toLowerCase())}`;
  return v.range === 'today' ? 'today' : `in the last ${RANGES[v.range]}`;
}

const Lines = ({ added, removed }: { added: number; removed: number }) =>
  added + removed ? (
    <span className="whitespace-nowrap">
      <span className="text-ok">+{compact(added)}</span> <span className="text-bad">−{compact(removed)}</span>
    </span>
  ) : (
    <>—</>
  );

// The list's columns: what each sorts by, its heading, what it counts, and its width.
// The last is cost or tokens, whichever you compare by; either way it sorts as 'cost'.
const COLS = 'hidden shrink-0 justify-end text-right tnum @min-[760px]/list:flex';
const W: Record<Exclude<Sort, 'latest'>, string> = {
  messages: 'w-[84px]',
  agentMs: 'w-[92px]',
  lines: 'w-[112px]',
  cost: '@min-[760px]/list:w-[92px]',
};
const columns = (): [Sort, string, string][] => [
  ['latest', 'Session', 'Newest first'],
  ['messages', 'Messages', 'Messages you sent'],
  ['agentMs', 'Agent time', 'How long the agent worked on your messages'],
  ['lines', 'Lines', 'Lines added and removed'],
  byTokens()
    ? ['cost', 'Tokens', 'Tokens used, including subagents']
    : ['cost', 'Cost', 'At API list prices, including subagents'],
];

// ── The page's tools ─────────────────────────────────────────────────────────

function SearchBox() {
  const query = useSessionsView((s) => s.view.query);
  const set = useSessionsView((s) => s.set);
  return (
    <label className="flex h-8 min-w-[160px] grow basis-[260px] @max-[640px]:basis-[160px] items-center gap-2 rounded-control border border-line bg-card px-2.5 text-detail focus-within:border-accent">
      <Search size={15} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={(e) => set({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation();
            set({ query: '' });
          }
        }}
        placeholder="Search sessions and what was said"
        aria-label="Search sessions by title, project or model, and inside their conversations"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 grow bg-transparent outline-none placeholder:text-faint"
      />
    </label>
  );
}

const Tools = memo(function Tools({ projects }: { projects: string[] }) {
  useChanged();
  const view = useSessionsView((s) => s.view);
  const set = useSessionsView((s) => s.set);
  const tags = allTags().map(([t]) => t);
  if (view.tag && !tags.some((t) => t.toLowerCase() === view.tag.toLowerCase())) tags.unshift(view.tag);
  const small = useCompact();
  const list = [...projects];
  if (view.project && !list.includes(view.project)) list.unshift(view.project);
  return (
    <>
      <SearchBox />
      <span className="session-measure">
        <Seg
          size={small ? 'sm' : 'md'}
          label="Compare by"
          value={env.measure}
          onChange={(m) => setMeasure(m)}
          options={MEASURES}
        />
      </span>
      <Dropdown
        className="session-project-filter"
        label="Project"
        value={view.project}
        onChange={(project) => set({ project })}
        options={[{ value: '', label: 'All projects' }, ...list.map((p) => ({ value: p, label: projectName(p) }))]}
      />
      {tags.length > 0 && (
        <Dropdown
          className="session-tag-filter"
          label="Tag"
          value={tags.find((t) => t.toLowerCase() === view.tag.toLowerCase()) || ''}
          onChange={(tag) => set({ tag })}
          options={[{ value: '', label: 'All tags' }, ...tags.map((t) => ({ value: t, label: t }))]}
        />
      )}
      {view.day ? (
        <Button
          size="sm"
          className="gap-1.5 @max-[640px]:order-2"
          onClick={() => set({ day: null })}
          data-tip="Showing one day. Click to show them all."
          aria-label="Show every day again"
        >
          {dayName(view.day)}
          <X size={13} strokeWidth={2.2} aria-hidden />
        </Button>
      ) : null}
      <span className="session-range">
        <Seg<Range | ''>
          size={small ? 'sm' : 'md'}
          label="Range"
          value={view.day ? '' : view.range}
          onChange={(r) => r && set({ range: r, day: null })}
          options={RANGE_OPTIONS}
        />
      </span>
    </>
  );
});

// ── Saved views ──────────────────────────────────────────────────────────────

function useViews() {
  const [views, setViews] = useState(loadViews);
  useEffect(() => onOtherTab((key) => key === VIEWS_KEY && setViews(loadViews())), []);
  const put = (next: SavedView[]) => {
    saveViews(next);
    setViews(next);
  };
  return [views, put] as const;
}

const ViewsBar = memo(function ViewsBar() {
  useChanged();
  const view = useSessionsView((s) => s.view);
  const [views, put] = useViews();
  const [naming, setNaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const now = paramsOf(view);
  const on = views.find((v) => sameParams(v.params, now));
  useEffect(() => {
    if (naming) {
      field.current?.focus();
      field.current?.select();
    }
  }, [naming]);
  const canSave = !view.day && !isPlain(now) && !on;
  if (!views.length && !canSave && !naming) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = (field.current?.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) || suggestName(now);
    const v: SavedView = { id: Date.now().toString(36), name, params: now };
    const before = views;
    put([...views, v]);
    setNaming(false);
    offerUndo(`Saved the view “${clip(name, 40)}”`, () => put(before.filter((x) => x.id !== v.id)));
  };
  return (
    <fieldset aria-label="Saved views" className="min-w-0 flex flex-wrap items-center gap-2">
      {views.length > 0 && (
        <span className="text-group font-semibold uppercase tracking-[0.06em] text-muted">Views</span>
      )}
      {views.map((v) => (
        <span
          key={v.id}
          className={cx(
            'inline-flex h-7 items-center rounded-full border text-detail',
            v === on ? 'border-ink bg-card font-semibold' : 'border-line bg-card',
          )}
        >
          <a
            href={viewLink(v)}
            aria-current={v === on ? 'true' : undefined}
            data-tip={suggestName(v.params)}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1 text-ink no-underline"
          >
            <Bookmark size={13} strokeWidth={2} aria-hidden />
            {v.name}
          </a>
          <button
            type="button"
            aria-label={`Remove the view ${v.name}`}
            onClick={() => {
              const before = views;
              put(views.filter((x) => x !== v));
              offerUndo(`Removed the view “${clip(v.name, 40)}”`, () => put(before));
            }}
            className="grid size-6 place-items-center rounded-full text-muted hover:text-ink"
          >
            <X size={12} strokeWidth={2.2} aria-hidden />
          </button>
        </span>
      ))}
      {naming ? (
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setNaming(false);
            }
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={field}
            type="text"
            maxLength={40}
            defaultValue={suggestName(now)}
            aria-label="Name for this view"
            spellCheck={false}
            className="h-7 w-56 rounded-control border border-line bg-card px-2 text-detail outline-none focus:border-accent"
          />
          <Button size="sm" variant="primary" type="submit">
            Save
          </Button>
          <Button size="sm" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        canSave && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            data-tip="Keep these filters and this sort under a name, above the list and in ⌘K"
            className="inline-flex items-center gap-1.5 text-detail font-semibold text-accent hover:underline"
          >
            <Bookmark size={13} strokeWidth={2} aria-hidden />
            Save this view
          </button>
        )
      )}
    </fieldset>
  );
});

// ── The band: what's in view ─────────────────────────────────────────────────

/** How many of the sessions in view are open right now: a count, so the band redraws only when it changes. */
function useOpenCount(rows: SessionInRange[]) {
  const ids = useMemo(() => new Set(rows.map((s) => s.id)), [rows]);
  return useLive((s) => (s.snap?.agents || []).filter((a) => a.kind === 'main' && ids.has(a.id)).length);
}

/** The band over the list. */
const Summary = memo(function Summary({ rows }: { rows: SessionInRange[] }) {
  useChanged();
  const open = useOpenCount(rows);
  const tokens = byTokens();
  // Each figure added up once, not once for each place it shows.
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const k of ['tools', 'failed', 'tokens', 'cost', 'messages', 'agentMs', 'waitMs', 'added', 'removed'] as const)
      t[k] = rows.reduce((n, s) => n + ((s[k] as number) || 0), 0);
    return t;
  }, [rows]);
  const sum = (k: keyof SessionInRange) => totals[k as string];
  const tools = sum('tools');
  const failed = sum('failed');
  // Typical among the sessions that cost (or used) something, and kept an agent busy at all.
  const typical = median(rows.map((s) => measureOf(s)).filter((v) => v > 0));
  const typicalTime = median(rows.map((s) => s.agentMs).filter((ms) => ms > 0));
  const partial = rows.some((s) => s.partial);
  const note =
    rows.length >= 3 && typical != null
      ? `A typical session here ${tokens ? `uses ${compact(typical)} tokens` : `costs ${money(typical)}`}${typicalTime ? ` and keeps the agent busy for ${duration(typicalTime)}` : ''}.`
      : '';
  return (
    <Card band aria-label="What's in view" className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 @max-[559px]:[&_dd]:text-[1.125rem] @min-[560px]:grid-cols-4 @min-[560px]:gap-x-6 @min-[560px]:gap-y-4 @min-[1000px]:grid-cols-7 [&_dt]:truncate">
        <Stat
          label="Sessions"
          value={rows.length}
          sub={open ? `${open} open` : undefined}
          tip={open ? `${open} of them open right now` : undefined}
        />
        {tokens ? (
          <Stat
            label="Tokens"
            value={compact(sum('tokens'))}
            tip={`Including subagents · ≈ ${costText(sum('cost'), partial)} at API list prices`}
          />
        ) : (
          <Stat
            label="Cost"
            value={costText(sum('cost'), partial)}
            tip={`At API list prices, including subagents · ${compact(sum('tokens'))} tokens`}
          />
        )}
        <Stat label="Your messages" value={compact(sum('messages'))} />
        <Stat
          label="Agent time"
          value={duration(sum('agentMs'))}
          tip="How long the agents worked on your messages, added up"
        />
        <Stat
          label="Waited for you"
          value={duration(sum('waitMs'))}
          tip="From an agent's last reply to your next message, leaving out breaks over 30 minutes"
        />
        <Stat label="Lines changed" value={<Lines added={sum('added')} removed={sum('removed')} />} />
        <Stat
          label="Tool calls"
          value={compact(tools)}
          sub={failed && tools ? `${Math.round((failed / tools) * 100)}% failed` : undefined}
          tip={failed ? `${plural(failed, 'call')} failed` : undefined}
        />
      </dl>
      {note && <Insight>{note}</Insight>}
    </Card>
  );
});

// ── The list ─────────────────────────────────────────────────────────────────

function ColumnHead() {
  const view = useSessionsView((s) => s.view);
  const set = useSessionsView((s) => s.set);
  const click = (key: Sort) =>
    view.sort === key ? set({ dir: view.dir === 'desc' ? 'asc' : 'desc' }) : set({ sort: key, dir: 'desc' });
  return (
    <div
      role="presentation"
      className="flex items-center gap-3 border-b border-line pb-2 text-label font-semibold text-muted"
    >
      <span className="w-5 shrink-0" />
      {columns().map(([key, label, tip]) => {
        const on = view.sort === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => click(key)}
            data-tip={`Sort by ${label.toLowerCase()}: ${tip.toLowerCase()}`}
            className={cx(
              'items-center gap-1 hover:text-ink',
              key === 'latest' ? 'flex grow' : cx(COLS, W[key], key === 'cost' && '!flex'),
              on && 'text-ink',
            )}
          >
            {label}
            {on && <span aria-hidden>{view.dir === 'asc' ? '↑' : '↓'}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A day's heading (or the pinned sessions'), with its totals and its fold. */
const GroupHead = memo(function GroupHead({
  name,
  items,
  open,
  groupKey,
  pinned,
}: {
  name: string;
  items: SessionInRange[];
  open: boolean;
  groupKey: number;
  pinned: boolean;
}) {
  useChanged();
  const totals = useMemo(() => {
    const t = { messages: 0, agentMs: 0, added: 0, removed: 0, cost: 0, tokens: 0 };
    for (const s of items) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += s[k] || 0;
    return t;
  }, [items]);
  const sum = (k: keyof typeof totals) => totals[k];
  const onToggle = () => useSessionsView.getState().fold([groupKey], open);
  return (
    <div
      className={cx('flex items-center gap-3 border-b border-line pb-1.5 pt-4 text-detail', pinned && 'text-accent')}
    >
      {/* A heading per day, so a screen reader can step from one to the next. */}
      <h3 className="flex min-w-0 grow">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 grow items-center gap-2 text-left font-semibold text-ink hover:text-accent"
        >
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={cx('w-5 shrink-0 text-muted transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
          <span className="truncate">{name}</span>
          <small className="shrink-0 font-normal text-muted">{plural(items.length, 'session')}</small>
        </button>
      </h3>
      <span className={cx(COLS, W.messages, 'text-muted')}>{sum('messages') ? compact(sum('messages')) : ''}</span>
      <span className={cx(COLS, W.agentMs, 'text-muted')}>{sum('agentMs') ? duration(sum('agentMs')) : ''}</span>
      <span className={cx(COLS, W.lines, 'text-muted')}>
        {sum('added') + sum('removed') ? `+${compact(sum('added'))} −${compact(sum('removed'))}` : ''}
      </span>
      <b className={cx('shrink-0 text-right tnum', W.cost)}>
        {measureCol({ cost: sum('cost'), tokens: sum('tokens'), partial: items.some((s) => s.partial) })}
      </b>
    </div>
  );
});

/** A session in the list. `today` is only so it's drawn again when the day changes, as its times say "Sep 24" then. */
const Row = memo(function Row({
  s,
  grouped,
  live,
  hit,
  q,
}: {
  s: SessionInRange;
  grouped: boolean;
  live: LiveAgent | undefined;
  hit: SearchResult | undefined;
  q: string;
  today: number;
}) {
  useChanged();
  const status = live ? liveStateOf(live) : null;
  const tip = [
    titleFor(s.id, s.title),
    customName(s.id) ? `Originally: ${s.title}` : '',
    [s.project && projectName(s.project), s.model].filter(Boolean).join(' · '),
    `Started ${at(s.startedAt)} · last active ${at(s.lastAt)}`,
    `${otherText(s)} · ${plural(s.tools, 'tool call')}${s.failed ? ` (${s.failed} failed)` : ''}${s.subagents ? ` · ${plural(s.subagents, 'subagent')}` : ''}`,
    s.waitMs ? `Waited ${duration(s.waitMs)} for your replies` : '',
    !byTokens() && s.subCost > 0.005 ? `${money(s.subCost)} of it on subagents` : '',
    !byTokens() && s.partial ? 'Some models it used have no known price, so the cost is what the rest cost' : '',
    'Click for details',
  ]
    .filter(Boolean)
    .join('\n');
  const first = hit?.hits[0];
  const folded: ReactNode[] = [
    plural(s.messages, 'message'),
    s.agentMs ? duration(s.agentMs) : '',
    s.added + s.removed ? <Lines key="l" added={s.added} removed={s.removed} /> : '',
  ].filter(Boolean);
  return (
    <SessionRow
      id={s.id}
      source={s.source}
      title={s.title}
      now={live ? (status === 'idle' ? 'Open' : doingText(live)) : ''}
      project={s.project}
      meta={[s.model || '', whenLine(s, grouped)]}
      context={s.context}
      tip={tip}
      at={first?.t ?? null}
      q={hit ? q : ''}
      className="border-b border-line last:border-b-0"
      folded={
        <span className="@min-[760px]/list:hidden">
          {folded.map((f, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span aria-hidden className="mx-1.5">
                  ·
                </span>
              )}
              {f}
            </Fragment>
          ))}
        </span>
      }
      quote={
        first && (
          <>
            <span className="shrink-0 text-label font-semibold text-muted">
              {first.who === 'you' ? 'You' : 'Agent'}
            </span>
            <span className="min-w-0 truncate text-muted">
              <Marked text={first.text} terms={queryTerms(q)} />
            </span>
            {hit!.count > 1 && <small className="shrink-0 text-label text-muted">+{hit!.count - 1} more</small>}
          </>
        )
      }
      cols={
        <>
          <span className={cx(COLS, W.messages)}>{s.messages ? compact(s.messages) : '—'}</span>
          <span className={cx(COLS, W.agentMs)}>{s.agentMs ? duration(s.agentMs) : '—'}</span>
          <span className={cx(COLS, W.lines)}>
            <Lines added={s.added} removed={s.removed} />
          </span>
        </>
      }
      end={measureCol(s)}
      endClassName={W.cost}
    />
  );
});

function List({
  ranged,
  rows,
  inside,
  freshness,
}: {
  ranged: SessionInRange[];
  rows: SessionInRange[];
  inside: ReturnType<typeof useInside>;
  freshness: string;
}) {
  // The list, not the page, follows the live agents: a row redraws when its own agent changes.
  const all = useAllAgents();
  const live = useMemo(() => new Map(all.filter((a) => a.kind === 'main').map((a) => [a.id, a])), [all]);
  const view = useSessionsView((s) => s.view);
  const collapsed = useSessionsView((s) => s.collapsed);
  const shown = useSessionsView((s) => s.shown);
  const { set, fold, more } = useSessionsView.getState();
  const provider = useLive((s) => s.provider);
  // A day at a time, worked out again only when the list or the folds change.
  const groupedRows = useMemo(
    () => (view.sort === 'latest' ? groupRows(rows, collapsed, shown) : null),
    [rows, collapsed, shown, view.sort],
  );
  const scopeWord = provider === 'all' ? '' : `${SOURCE[provider].name} `;
  const when = whenText(view);
  const q = view.query.trim();
  const title =
    rows.length === ranged.length
      ? plural(rows.length, `${scopeWord}session`)
      : `${rows.length} of ${plural(ranged.length, `${scopeWord}session`)}`;
  const found = rows.filter((x) => inside.bySession.has(x.id)).length;
  const looked = !q
    ? ''
    : !inside.on
      ? ' · titles and projects only'
      : inside.loading
        ? ' · searching inside conversations…'
        : found
          ? ` · ${found} found inside ${found === 1 ? 'its conversation' : 'their conversations'}`
          : '';
  const sub = `Active ${when}${view.sort === 'latest' && !view.day ? ', by the day they were last active' : ''}${looked}${freshness}`;

  if (!ranged.length) {
    return (
      <Card>
        <CardHead title={title} sub={sub} />
        <Empty>
          No {scopeWord}sessions {when}.{' '}
          {(view.day || view.range !== '30') && (
            <button
              type="button"
              className="font-semibold text-accent hover:underline"
              onClick={() => set({ range: '30', day: null })}
            >
              Show the last 30 days
            </button>
          )}
        </Empty>
      </Card>
    );
  }
  if (!rows.length) {
    const what = [
      q && `“${clip(q, 40)}”`,
      view.project && `in ${projectName(view.project)}`,
      view.tag && `tagged ${view.tag}`,
    ]
      .filter(Boolean)
      .join(' ');
    const where = !q
      ? ''
      : inside.on
        ? inside.loading
          ? ' Still looking inside conversations…'
          : ' Nothing inside their conversations either.'
        : ' Search inside conversations is off in Settings, so only titles and projects were searched.';
    return (
      <Card>
        <CardHead title={title} sub={sub} />
        <Empty>
          No sessions match {what}.{where}{' '}
          <button
            type="button"
            className="font-semibold text-accent hover:underline"
            onClick={() => set({ query: '', project: '', tag: '' })}
          >
            Clear the search
          </button>
        </Empty>
      </Card>
    );
  }

  const grouped = view.sort === 'latest';
  const today = calendarDay(serverNow());
  const row = (s: SessionInRange, g: boolean) => (
    <Row key={s.id} s={s} grouped={g} live={live.get(s.id)} hit={inside.bySession.get(s.id)} q={q} today={today} />
  );
  let body: ReactNode;
  let left = 0;
  let foldButton: ReactNode = null;
  if (grouped && groupedRows) {
    const { groups, left: l } = groupedRows;
    left = l;
    body = groups.map((g) => (
      <div key={g.key}>
        <GroupHead
          name={g.key === PINNED ? 'Pinned' : dayName(g.key)}
          items={g.items}
          open={g.open}
          pinned={g.key === PINNED}
          groupKey={g.key}
        />
        {g.shown.map((s) => row(s, g.key !== PINNED))}
      </div>
    ));
    const keys = groupKeys(rows);
    if (keys.length > 1) {
      const anyOpen = keys.some((k) => !collapsed.has(k));
      foldButton = (
        <button
          type="button"
          className="text-detail font-semibold text-accent hover:underline"
          onClick={() => (anyOpen ? fold(keys, true) : fold([...collapsed], false))}
        >
          {anyOpen ? 'Collapse all days' : 'Expand all days'}
        </button>
      );
    }
  } else {
    body = rows.slice(0, shown).map((s) => row(s, false));
    left = Math.max(0, rows.length - shown);
  }
  return (
    <Card className="@container/list">
      <CardHead title={title} sub={sub} tools={foldButton} />
      <ColumnHead />
      <div>{body}</div>
      {left > 0 && (
        <Button className="mt-3" onClick={more}>
          {left > PAGE_SIZE ? `Show ${PAGE_SIZE} more · ${left} left` : `Show the other ${left}`}
        </Button>
      )}
    </Card>
  );
}

export function Sessions() {
  const v = useChanged();
  // By the minute, not the second: nothing on the list counts seconds, and it's a long list.
  useMinute();
  useFollowAddress();
  const { data, isError, refetch, dataUpdatedAt } = useSessions();
  const provider = useLive((s) => s.provider);
  const view = useSessionsView((s) => s.view);
  const inside = useInside(view.query);
  const now = serverNow();
  const [from, to] = spanOf(view, now);
  const ranged = useMemo(() => sessionsIn(data, provider, from, to), [data, provider, from, to]);
  // Your names, notes and tags count in the search, so a change to one filters again.
  const rows = useMemo(
    () =>
      sortRows(
        ranged.filter((s) => matches(s, view, (id) => inside.bySession.has(id))),
        view,
      ),
    [ranged, view, inside.bySession, v],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = useMemo(
    () =>
      [...new Set(ranged.map((s) => s.project).filter(Boolean) as string[])].sort((a, b) =>
        projectName(a).localeCompare(projectName(b)),
      ),
    [ranged, v],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const age = Date.now() - dataUpdatedAt;
  const freshness = data && age > 45_000 ? ` · updated ${ago(age)} ago` : '';
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title="Sessions"
        id="h-sessions"
        sub="Every session from the last 30 days · costs at API list prices"
      />
      <fieldset aria-label="Filters" className="session-filters -mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <Tools projects={projects} />
      </fieldset>
      <ViewsBar />
      {!data ? (
        isError ? (
          <Card>
            <Empty>
              Couldn't load your sessions from Overtime's server.{' '}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => refetch()}>
                Try again
              </button>
            </Empty>
          </Card>
        ) : (
          <Card>
            <Skeleton lines={6} />
          </Card>
        )
      ) : (
        <>
          <Summary rows={rows} />
          <List ranged={ranged} rows={rows} inside={inside} freshness={freshness} />
        </>
      )}
    </div>
  );
}
