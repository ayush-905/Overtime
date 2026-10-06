// The Projects page: every project of the range, with what it cost (or the
// tokens it used), how long your agents worked on it and waited for you, and a
// closer look at the one you pick: its days, models, providers and biggest
// sessions, with its name and colour to change. The project and range live in
// the address (#projects?p=shop&range=7); the range and sort are remembered.
// Its store (useProjectsView) holds the range, the sort, the project you picked
// and your search; like the Sessions page's, it writes the address as they
// change, and follows the address when a link opens the page.

import { memo, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { Pencil, Search } from 'lucide-react';
import { useChanged, useMedia, useMinute } from '@/data/hooks';
import { useSessions } from '@/data/queries';
import { useLive } from '@/data/live';
import {
  ago,
  calendarDay,
  clip,
  compact,
  costText,
  dayLabel,
  duration,
  HOUR,
  money,
  plural,
  projectColor,
  projectName,
} from '@/lib/format';
import { env, serverNow } from '@/lib/env';
import { titleFor } from '@/lib/labels';
import { byTokens, MEASURES, measureCol, measureOf, setMeasure, something, valueShort, valueText } from '@/lib/measure';
import { dayParam, pageLink, replaceParams } from '@/lib/route';
import { sessionsIn } from '@/lib/sessions';
import { RANGE_OPTIONS, RANGES, type Range } from '@/lib/sessionsView';
import { projectsOf, readProjectsView, writeProjectsView, type Project, type ProjectSort } from '@/lib/projectsView';
import { Card, CardHead } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { Seg } from '@/components/Seg';
import { IconButton, TextLink } from '@/components/Button';
import { Empty, Insight, ProjectDot, Skeleton } from '@/components/Bits';
import { ChartSwitch, Plot, ShareList, useChartKind } from '@/components/Chart';
import { SessionRow } from '@/components/SessionRow';
import { Ago } from '@/components/Clock';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { useRoute } from '@/app/router';
import { useProjectDialog } from '@/app/dialogs';
import { useCompact } from '@/app/layout';
import { SOURCE, SOURCES } from '@/lib/sources';

// ── The view ─────────────────────────────────────────────────────────────────

type View = { range: Range; sort: ProjectSort; selected: string; query: string };
type ViewState = View & { set: (patch: Partial<View>) => void };

const isRange = (r: unknown): r is Range => RANGE_OPTIONS.some(([x]) => x === r);

/** Remember the range and sort, and write the project, range and search into the address. */
function persist(v: View) {
  writeProjectsView({ range: v.range, sort: v.sort });
  replaceParams('projects', { p: v.selected, range: v.range === '30' ? null : v.range, q: v.query.trim() });
}

/** The range and sort (remembered), the project you picked and your search (only for now, in the address). */
const useProjectsView = create<ViewState>((set, get) => ({
  ...readProjectsView(),
  selected: '',
  query: '',
  set: (patch) => {
    set(patch);
    persist(get());
  },
}));

/** Open the page on what the address asks for: #projects?p=shop&range=7. */
function useFollowAddress() {
  const params = useRoute((s) => s.params);
  const page = useRoute((s) => s.page);
  useEffect(() => {
    if (page !== 'projects') return;
    const saved = readProjectsView();
    useProjectsView.getState().set({
      range: isRange(params.range) ? params.range : saved.range,
      sort: saved.sort,
      selected: params.p || '',
      query: params.q || '',
    });
  }, [params, page]);
}

/** When a project was last active: "active 3m ago" within the hour (counting), else its day. */
function LastActive({ t }: { t: number }) {
  useMinute();
  const now = serverNow();
  if (now - t < HOUR)
    return (
      <>
        active <Ago t={t} /> ago
      </>
    );
  return <>{calendarDay(t) === calendarDay(now) ? 'active today' : `last active ${dayLabel(t)}`}</>;
}

const Lines = ({ added, removed }: { added: number; removed: number }) => (
  <span className="whitespace-nowrap">
    <span className="text-ok">+{compact(added)}</span> <span className="text-bad">−{compact(removed)}</span>
  </span>
);

function ProjectList({
  list,
  shown,
  selected,
  sort,
  setSort,
  pick,
  sub,
  query,
  clear,
}: {
  list: Project[];
  shown: Project[];
  selected: Project | null;
  sort: ProjectSort;
  setSort: (s: ProjectSort) => void;
  pick: (name: string) => void;
  sub: string;
  query: string;
  clear: () => void;
}) {
  const tokens = byTokens();
  const total = list.reduce((n, p) => n + measureOf(p), 0);
  const title =
    shown.length === list.length
      ? plural(list.length, 'project')
      : `${shown.length} of ${plural(list.length, 'project')}`;
  return (
    <Card aria-label="Projects">
      <CardHead
        title={title}
        sub={sub}
        tools={
          <Seg
            size="sm"
            label="Sort by"
            value={sort}
            onChange={setSort}
            options={[
              ['cost', tokens ? 'Tokens' : 'Cost'],
              ['agentMs', 'Agent time'],
              ['recent', 'Recent'],
            ]}
          />
        }
      />
      {!shown.length ? (
        <Empty>
          No project matches “{clip(query.trim(), 40)}”.{' '}
          <button type="button" className="font-semibold text-accent hover:underline" onClick={clear}>
            Clear the search
          </button>
        </Empty>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {shown.map((p) => {
            const pct = total > 0 ? (measureOf(p) / total) * 100 : 0;
            const figure = tokens
              ? `${compact(p.tokens)} tokens (${Math.round(pct)}% of them) · ≈ ${money(p.cost)}`
              : `≈ ${money(p.cost)} (${Math.round(pct)}% of the cost) · ${compact(p.tokens)} tokens`;
            const tip = `${projectName(p.name)}${projectName(p.name) !== p.name ? ` (${p.name})` : ''}\n${plural(p.sessions.length, 'session')} · ${figure}\n${duration(p.agentMs)} agent time · ${duration(p.waitMs)} waiting for you`;
            const on = p === selected;
            return (
              <li key={p.name}>
                <button
                  type="button"
                  data-row=""
                  data-project={p.name}
                  aria-current={on}
                  data-tip={tip}
                  onClick={() => pick(p.name)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-row px-2 py-[var(--row-py)] text-left',
                    on ? 'bg-sunken' : 'hover:bg-sunken/60',
                  )}
                >
                  <ProjectDot name={p.name} className="size-2.5" />
                  <span className="flex min-w-0 grow flex-col gap-1">
                    <span className="truncate font-semibold">{projectName(p.name)}</span>
                    <span className="truncate text-detail text-muted">
                      {plural(p.sessions.length, 'session')} · {duration(p.agentMs)} of agent time ·{' '}
                      <LastActive t={p.lastAt} />
                    </span>
                    <span className="h-1 overflow-hidden rounded-full bg-sunken">
                      <i
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(pct > 0 ? 1.5 : 0, pct).toFixed(1)}%`,
                          background: projectColor(p.name),
                        }}
                      />
                    </span>
                  </span>
                  <b className="shrink-0 font-semibold tnum">{measureCol(p)}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The project you picked. Drawn again when it or the list changes (the list moves on at midnight too). */
const Detail = memo(function Detail({
  p,
  list,
  range,
  all,
}: {
  p: Project | null;
  list: Project[];
  range: Range;
  all: ReturnType<typeof useSessions>['data'];
}) {
  useChanged();
  const open = useProjectDialog((s) => s.open);
  const provider = useLive((s) => s.provider);
  const kind = useChartKind('project-daily');
  if (!p) {
    return (
      <Card>
        <CardHead title="Project" />
        <Empty>Pick a project to see it here.</Empty>
      </Card>
    );
  }
  const tokens = byTokens();
  const total = list.reduce((n, x) => n + measureOf(x), 0);
  const share = total > 0 ? Math.round((measureOf(p) / total) * 100) : 0;
  const renamed = projectName(p.name) !== p.name;

  // Its days: the range, or the last week when the range is only today.
  const days = range === '30' ? 30 : 7;
  const first = calendarDay(serverNow(), 1 - days);
  const perDay = new Map<number, number>();
  for (const s of sessionsIn(all, provider, first)) {
    if ((s.project || 'Unknown') !== p.name) continue;
    for (const d of s.days)
      if (d.day >= first)
        perDay.set(d.day, (perDay.get(d.day) || 0) + measureOf({ cost: d.cost || 0, tokens: d.tokens || 0 }));
  }
  const bars = Array.from({ length: days }, (_, i) => {
    const day = calendarDay(first, i);
    return { value: perDay.get(day) || 0, day, current: i === days - 1 };
  });

  // What it ran on. Models are each session's, over the 30 days the list covers.
  const models = new Map<string, number>();
  for (const s of p.sessions)
    for (const m of s.models || [])
      models.set(m.name, (models.get(m.name) || 0) + measureOf({ cost: m.cost, tokens: m.tokens || 0 }));
  const modelTotal = [...models.values()].reduce((n, c) => n + c, 0);
  const modelRows = [...models.entries()]
    .filter(([, v]) => something(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  // Which providers worked on it, when it's more than one.
  const providers = SOURCES.filter((s) => something(measureOf(p.bySource[s])));

  const top = [...p.sessions].sort((a, b) => measureOf(b) - measureOf(a)).slice(0, 5);
  const allWait = list.reduce((n, x) => n + x.waitMs, 0);
  const biggest = top[0];
  const worth = tokens ? p.tokens > 1e6 : p.cost > 1; // enough for one session's share to mean something
  let tip = '';
  if (allWait > 0 && p.waitMs / allWait >= 0.4 && p.waitMs >= 30 * 60_000)
    tip = `${Math.round((p.waitMs / allWait) * 100)}% of the time your agents waited for you was here (${duration(p.waitMs)}).`;
  else if (biggest && worth && measureOf(biggest) / measureOf(p) >= 0.5 && p.sessions.length > 1)
    tip = `One session, “${clip(titleFor(biggest.id, biggest.title), 50)}”, is ${Math.round((measureOf(biggest) / measureOf(p)) * 100)}% of this project's ${tokens ? 'tokens' : 'cost'}.`;

  return (
    <Card data-project-detail="" aria-label={projectName(p.name)} className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-title font-semibold">
            <ProjectDot name={p.name} className="size-3" />
            <span className="truncate" data-tip={renamed ? `Folder: ${p.name}` : undefined}>
              {projectName(p.name)}
            </span>
            {p.name !== 'Unknown' && (
              <IconButton
                size="sm"
                variant="quiet"
                label="Name and colour"
                tip="Rename it or pick its colour, on this dashboard only"
                onClick={() => open(p.name)}
              >
                <Pencil size={13} strokeWidth={2} aria-hidden />
              </IconButton>
            )}
          </h2>
          <p className="text-detail text-muted">
            {range === 'today' ? 'Today' : `Last ${RANGES[range]}`} · {share}% of the {tokens ? 'tokens' : 'cost'}
            {renamed ? ` · folder ${p.name}` : ''}
          </p>
        </div>
        <TextLink
          href={pageLink('sessions', { project: p.name, range: range === '30' ? null : range })}
          className="ml-auto"
        >
          {plural(p.sessions.length, 'session')} →
        </TextLink>
      </header>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-4 @max-[559px]:[&_dd]:text-[1.125rem] @min-[1040px]:grid-cols-6 [&_dt]:truncate">
        {tokens ? (
          <Stat
            label="Tokens"
            value={compact(p.tokens)}
            tip={`Including subagents · ≈ ${costText(p.cost, p.partial)} at API list prices`}
          />
        ) : (
          <Stat
            label="Cost"
            value={costText(p.cost, p.partial)}
            tip={`At API list prices, including subagents · ${compact(p.tokens)} tokens`}
          />
        )}
        <Stat label="Your messages" value={compact(p.messages)} />
        <Stat label="Agent time" value={duration(p.agentMs)} tip="How long the agents worked on your messages" />
        <Stat
          label="Waited for you"
          value={duration(p.waitMs)}
          tip="From an agent's last reply to your next message, leaving out breaks over 30 minutes"
        />
        <Stat label="Lines changed" value={<Lines added={p.added} removed={p.removed} />} />
        <Stat
          label="Tool calls"
          value={compact(p.tools)}
          sub={p.failed ? `${Math.round((p.failed / Math.max(1, p.tools)) * 100)}% failed` : undefined}
        />
      </dl>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-detail font-semibold text-muted">
            {tokens ? 'Daily tokens' : 'Daily cost'} · last {days} days
          </h3>
          <ChartSwitch id="project-daily" />
        </div>
        <Plot
          label={`${tokens ? 'Daily tokens' : 'Daily cost'} for ${projectName(p.name)}, last ${days} days`}
          kind={kind}
          values={bars}
          color={projectColor(p.name)}
          tip={(v) =>
            `${dayLabel(v.day)} · ${valueText(v.value)}${something(v.value) ? '\nClick for that day’s sessions' : ''}`
          }
          link={(v) => (something(v.value) ? pageLink('sessions', { day: dayParam(v.day), project: p.name }) : null)}
          labels={
            days === 30
              ? [dayLabel(bars[0].day), dayLabel(bars[10].day), dayLabel(bars[20].day), 'Today']
              : bars.map((b) => new Date(b.day).toLocaleDateString([], { weekday: 'narrow' }))
          }
          height={120}
          even={days === 7}
          markLabel={days === 7 ? 6 : -1}
          gridLabel={valueShort}
          table={{
            head: ['Day', tokens ? 'Tokens' : 'Cost'],
            row: (v) => [dayLabel(v.day), something(v.value) ? valueShort(v.value) : ''],
            newestFirst: true,
          }}
        />
      </section>
      {(modelRows.length > 0 || providers.length > 1) && (
        <div className="grid gap-6 @min-[640px]:grid-cols-2">
          {modelRows.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h3 className="text-detail font-semibold text-muted">
                Models <small className="font-normal">last 30 days</small>
              </h3>
              <ShareList
                total={modelTotal}
                items={modelRows.map(([name, value]) => ({ name, value, valueText: valueShort(value) }))}
              />
            </section>
          )}
          {providers.length > 1 && (
            <section className="flex flex-col gap-2.5">
              <h3 className="text-detail font-semibold text-muted">Providers</h3>
              <ShareList
                total={measureOf(p)}
                items={providers.map((s) => ({
                  name: SOURCE[s].name,
                  value: measureOf(p.bySource[s]),
                  color: SOURCE[s].color,
                  valueText: valueShort(measureOf(p.bySource[s])),
                }))}
              />
            </section>
          )}
        </div>
      )}
      {top.length > 0 && (
        <section className="flex flex-col">
          <h3 className="mb-1 text-detail font-semibold text-muted">
            {tokens ? 'Sessions with the most tokens' : 'Priciest sessions'}
          </h3>
          {top.map((s) => (
            <SessionRow
              key={s.id}
              id={s.id}
              source={s.source}
              title={s.title}
              meta={[plural(s.messages, 'message'), duration(s.agentMs), s.model || '']}
              end={measureCol(s)}
              context={s.context}
              tip={`${titleFor(s.id, s.title)}\n${tokens ? `≈ ${costText(s.cost, s.partial)}` : `${compact(s.tokens)} tokens`}\nClick for details`}
              className="border-b border-line last:border-b-0"
            />
          ))}
        </section>
      )}
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
});

export function Projects() {
  useChanged();
  // By the minute: when it was updated, and the range's first day at midnight.
  useMinute();
  useFollowAddress();
  const { range, sort, selected, query, set } = useProjectsView();
  const setRange = (r: Range) => set({ range: r });
  const setQuery = (q: string) => set({ query: q });
  const wide = useMedia('(min-width: 1280px)');
  const small = useCompact();

  const { data, isError, refetch, dataUpdatedAt } = useSessions();
  const provider = useLive((s) => s.provider);
  const from = calendarDay(serverNow(), range === 'today' ? 0 : 1 - Number(range));
  const list = useMemo(
    () => projectsOf(sessionsIn(data, provider, from), sort),
    [data, provider, from, sort, env.measure],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const shown = list.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || projectName(p.name).toLowerCase().includes(q),
  );
  const current = list.find((p) => p.name === selected) || shown[0] || list[0] || null;
  const when = range === 'today' ? 'today' : `in the last ${RANGES[range]}`;
  const age = Date.now() - dataUpdatedAt;
  const sub = `Active ${when}${data && age > 45_000 ? ` · updated ${ago(age)} ago` : ''}`;
  const pick = (name: string) => {
    set({ selected: name });
    // On a narrow screen the project opens below the list.
    if (!wide)
      requestAnimationFrame(() =>
        document.querySelector('[data-project-detail]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
  };

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title="Projects"
        id="h-projects"
        sub="Where your time and money go, by project · costs at API list prices"
      />
      <fieldset aria-label="Filters" className="min-w-0 -mt-1 flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[160px] grow basis-[240px] @max-[640px]:basis-[160px] items-center gap-2 rounded-control border border-line bg-card px-2.5 text-detail focus-within:border-accent @min-[900px]:max-w-[360px]">
          <Search size={15} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            placeholder="Search projects"
            aria-label="Search projects"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 grow bg-transparent outline-none placeholder:text-faint"
          />
        </label>
        <span className="grow @max-[640px]:hidden" />
        {/* Compact, Cost | Tokens sits beside the search and the range goes under. */}
        <span className="@max-[640px]:order-2">
          <Seg<Range>
            size={small ? 'sm' : 'md'}
            label="Range"
            value={range}
            onChange={setRange}
            options={RANGE_OPTIONS}
          />
        </span>
        <span className="@max-[640px]:order-1">
          <Seg
            size={small ? 'sm' : 'md'}
            label="Compare by"
            value={env.measure}
            onChange={(m) => setMeasure(m)}
            options={MEASURES}
          />
        </span>
      </fieldset>
      {!data ? (
        <Card>
          {isError ? (
            <Empty>
              Couldn't load your sessions from Overtime's server.{' '}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => refetch()}>
                Try again
              </button>
            </Empty>
          ) : (
            <Skeleton lines={6} />
          )}
        </Card>
      ) : !list.length ? (
        <Card>
          <CardHead title="Projects" sub={sub} />
          <Empty>
            No sessions {when}.{' '}
            {range !== '30' && (
              <button
                type="button"
                className="font-semibold text-accent hover:underline"
                onClick={() => setRange('30')}
              >
                Show the last 30 days
              </button>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="grid items-start gap-[var(--page-gap)] @min-[1100px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ProjectList
            list={list}
            shown={shown}
            selected={current}
            sort={sort}
            setSort={(s) => set({ sort: s })}
            pick={pick}
            sub={sub}
            query={query}
            clear={() => setQuery('')}
          />
          <div className="@container min-w-0">
            <Detail p={current} list={list} range={range} all={data} />
          </div>
        </div>
      )}
    </div>
  );
}
