// The Cost page: what your usage would cost at API list prices, and where it
// goes. The band has today, yesterday, the last 7 and 30 days; the cards under it
// (in the order you arrange them) are what your plans are worth, daily cost,
// where the money goes, the priciest sessions of the week, cache savings,
// context size, and what long conversations cost extra. The Cost page always
// counts money, whatever you compare by.

import { useMemo, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useAllAgents, useInsight, useInsightOf, useProvider, useSources, useSpend, useSpendOf } from '@/data/scope';
import { useChanged, useMinute } from '@/data/hooks';
import { useLive } from '@/data/live';
import { useSessions } from '@/data/queries';
import { calendarDay, clip, compact, costText, dayLabel, linesPer, longDate, money, plural, projectColor, projectName, weekday } from '@/lib/format';
import { env, serverNow } from '@/lib/env';
import { titleFor } from '@/lib/labels';
import { dayParam, pageLink } from '@/lib/route';
import { sessionsIn } from '@/lib/sessions';
import { providerName } from '@/lib/limits';
import { planBlock, planInsight, planName, plans, times } from '@/lib/plans';
import { SHARE_KINDS } from '@/lib/charts';
import { Card, CardHead, Eyebrow, InfoTip } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { Seg } from '@/components/Seg';
import { TextLink } from '@/components/Button';
import { Empty, Insight, ProjectDot, Skeleton } from '@/components/Bits';
import { ChartSwitch, Donut, DONUT_COLORS, Plot, ShareList, useChartKind, type Share } from '@/components/Chart';
import { ArrangeButton, PageGrid, type GridCard } from '@/components/PageGrid';
import { SessionRow } from '@/components/SessionRow';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { SOURCE, plansIn, sourceInfo, type Source } from '@/lib/sources';

type Day = { start: number; cost: number; tokens: number };
type Period = { cost: number; tokens: number; unpricedTokens?: number };

const unpriced = (p?: Period | null) => !!p && (p.unpricedTokens || 0) > p.tokens * 0.01;

// ── The band: the tiles ──────────────────────────────────────────────────────

function delta(current: number, previous: number | undefined, label: string) {
  if (!(previous! > 0.5)) return null;
  const pct = Math.round(((current - previous!) / previous!) * 100);
  if (Math.abs(pct) < 1) return { text: `Same as ${label}`, tip: '' };
  return { text: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs ${label}`, tip: `${money(previous)} ${label}` };
}

function Tile({ label, period, extra, href, children }: { label: string; period: Period | null | undefined; extra?: { text: string; tip: string } | null; href?: string; children?: ReactNode }) {
  if (!period) {
    return (
      <div className="flex flex-col gap-1.5 px-[var(--card-px)] py-[var(--card-py)]">
        <Eyebrow>{label}</Eyebrow>
        <Skeleton lines={2} />
      </div>
    );
  }
  const has = period.cost > 0.005 || period.tokens > 0;
  const body = (
    <>
      <Eyebrow>{label}</Eyebrow>
      <p className="text-figure font-bold tracking-[-0.02em] tnum" data-tip={unpriced(period) ? 'Some models used have no known price, so this is what the rest cost' : undefined}>
        {has ? `≈ ${costText(period.cost, unpriced(period))}` : '—'}
      </p>
      <p className="text-detail text-muted">{has ? `${compact(period.tokens)} tokens` : 'No usage'}</p>
      {extra && (
        <p className="text-detail text-muted" data-tip={extra.tip || undefined}>
          {extra.text}
        </p>
      )}
      {children}
    </>
  );
  return href && has ? (
    <a href={href} data-tip="See these sessions" className="flex min-w-0 flex-col gap-1 px-[var(--card-px)] py-[var(--card-py)] text-ink no-underline hover:bg-sunken/50">
      {body}
    </a>
  ) : (
    <div className="flex min-w-0 flex-col gap-1 px-[var(--card-px)] py-[var(--card-py)]">{body}</div>
  );
}

function Spark({ days }: { days: Day[] }) {
  const max = Math.max(...days.map((d) => d.cost), 0.01);
  return (
    <div className="mt-1 flex h-7 items-end gap-[2px]" aria-hidden>
      {days.map((d, i) => (
        <i key={d.start} data-tip={`${dayLabel(d.start)} · ≈ ${money(d.cost)}`} className={cx('block flex-1 rounded-t-[2px]', i === days.length - 1 ? 'bg-ink/60' : 'bg-s1')} style={{ height: `${Math.max(d.cost > 0 ? 8 : 0, Math.round((d.cost / max) * 100))}%` }} />
      ))}
    </div>
  );
}

function Tiles() {
  // Yesterday's link moves on at midnight.
  useMinute();
  const spend = useSpend();
  const days = (useInsight<{ days: Day[] }>('trend')?.days || []) as Day[];
  const sum = (from: number, to: number) => days.slice(from, to).reduce((n, d) => n + d.cost, 0);
  const now = serverNow();
  const active = days.filter((x) => x.cost > 0.005).length;
  return (
    <Card band flush className="grid grid-cols-2 @min-[1000px]:grid-cols-4 [&>*]:border-line @max-[999px]:[&>*:nth-child(-n+2)]:border-b @max-[999px]:[&>*:nth-child(odd)]:border-r @min-[1000px]:[&>*:not(:last-child)]:border-r @max-[559px]:[&_.text-figure]:text-[1.375rem]" aria-label="Cost at a glance">
      <Tile label="Today" period={spend?.today} extra={spend?.yesterdayByNow ? delta(spend.today.cost, spend.yesterdayByNow.cost, 'yesterday by now') : null} href={pageLink('sessions', { range: 'today' })} />
      <Tile label="Yesterday" period={spend?.yesterday} extra={days.length === 30 ? delta(days[28].cost, days[27].cost, weekday(days[27].start)) : null} href={pageLink('sessions', { day: dayParam(calendarDay(now, -1)) })} />
      <Tile label="Last 7 days" period={spend?.last7} extra={days.length === 30 ? delta(sum(23, 30), sum(16, 23), 'the 7 days before') : null} href={pageLink('sessions', { range: '7' })} />
      <Tile label="Last 30 days" period={spend?.last30} extra={days.length ? { text: `≈ ${money(active ? sum(0, 30) / active : 0)} per active day`, tip: '' } : null} href={pageLink('sessions', { range: '30' })}>
        {days.length > 0 && <Spark days={days} />}
      </Tile>
    </Card>
  );
}

// ── What your plans are worth ────────────────────────────────────────────────

export function PlansCard() {
  useChanged();
  // The month's pace moves on by the minute.
  useMinute();
  const provider = useProvider();
  const now = serverNow();
  const inView = plansIn(provider, useSources());
  const set = inView.filter((p) => plans[p]);
  const spends = useSpendOf(set);
  const head = <CardHead title="What your plans are worth" sub="Your usage at API list prices, against what you pay" tools={<TextLink href={pageLink('settings')}>Your plans →</TextLink>} />;
  if (!inView.length) {
    return (
      <Card>
        {head}
        <Empty>{providerName(provider)} has no plan of its own: you pay the provider you sign it in to, and its cost here is that usage at their list prices.</Empty>
      </Card>
    );
  }
  if (!set.length) {
    return (
      <Card>
        {head}
        <Empty>
          Tell the dashboard what you pay for {inView.map(providerName).join(' and ')} each month, and this shows how much API-priced usage your plan covers. <TextLink href={pageLink('settings')}>Set your plans</TextLink>
        </Empty>
      </Card>
    );
  }
  const blocks = set.map((p, i) => planBlock(p, spends[i] as never, now));
  const { together, tip } = planInsight(blocks, providerName);
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <div className="grid gap-4 @min-[700px]:grid-cols-2">
        {blocks.map((b) => (
          <div key={b.provider} className={cx('flex flex-col gap-1 rounded-row border px-4 py-3.5', b.ratio == null ? 'border-line' : b.ratio >= 1 ? 'border-ok/30 bg-ok-soft/40' : 'border-warn-line bg-warn-soft/40')}>
            <p className="text-detail font-semibold">
              {providerName(b.provider)} <small className="font-normal text-muted">{planName(b.provider)} · {money(b.p.usd)} a month</small>
            </p>
            <p className="text-figure font-bold tracking-[-0.02em] tnum" data-tip="Usage in the last 30 days at API list prices, divided by what you pay a month">
              {b.ratio == null ? '—' : times(b.ratio)}
            </p>
            <p className="text-detail text-muted">≈ {b.last30 == null ? '—' : money(b.last30)} of usage at API prices in the last 30 days</p>
            {b.mo && (
              <dl className="mt-2 grid grid-cols-2 gap-3 border-t border-line pt-2.5">
                <Stat label="This month so far" value={<>≈ {money(b.mo.cost)}{b.mo.partial ? '+' : ''} <small className="text-detail font-normal text-muted @max-[519px]:block">{times(b.mo.cost / b.p.usd)}</small></>} />
                <Stat label="On pace for" value={<>≈ {money(b.mo.projected)} <small className="text-detail font-normal text-muted @max-[519px]:block">by {dayLabel(b.mo.lastDay)}</small></>} tip="This month so far, plus the rest of it at your pace over the last 7 days" />
              </dl>
            )}
          </div>
        ))}
      </div>
      {together && <p className="text-detail">{together}</p>}
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

// ── Daily cost ───────────────────────────────────────────────────────────────

export function TrendCard() {
  const provider = useProvider();
  const sources = useSources();
  const kind = useChartKind('trend');
  const split = useInsightOf<{ days: Day[] }>(sources, 'trend');
  const trend = useInsight<{ days: Day[] }>('trend');
  if (!trend) {
    return (
      <Card>
        <CardHead title="Daily cost" />
        <Skeleton lines={4} />
      </Card>
    );
  }
  const days = trend.days;
  const total = days.reduce((n, d) => n + d.cost, 0);
  const active = days.filter((d) => d.cost > 0.01).length;
  const peak = days.reduce((best, d) => (d.cost > best.cost ? d : best), days[0]);
  const n = days.length;
  const both = provider === 'all' && sources.length > 1;
  // Each provider's days, to split the bars by when they're all in view.
  const series = sources.map((s, i) => ({ s, days: split[i]?.days || [] }));
  const splitDays = both && series.every((x) => x.days.length === n);
  return (
    <Card>
      <CardHead
        title="Daily cost"
        sub={`Last ${n} days · click a day for its sessions`}
        tools={
          <>
            <dl className="flex gap-5 text-right [&_dd]:text-[1.0625rem]">
              <Stat label="Total" value={money(total)} />
              <Stat label="Per active day" value={money(active ? total / active : 0)} />
              <Stat label="Biggest day" value={peak.cost > 0 ? money(peak.cost) : '—'} />
            </dl>
            <ChartSwitch id="trend" />
          </>
        }
      />
      <Plot
        kind={kind}
        values={days.map((d, i) => ({ value: d.cost, current: i === n - 1, d, i }))}
        color={sourceInfo(provider === 'all' ? 'claude' : provider).color}
        segments={splitDays ? (v) => series.map((x) => ({ value: x.days[v.i as number]?.cost || 0, color: SOURCE[x.s].color, name: SOURCE[x.s].name })) : null}
        tip={(v) => {
          const d = v.d as Day;
          const i = v.i as number;
          const spent = both ? series.filter((x) => (x.days[i]?.cost || 0) > 0.005) : [];
          const parts = spent.length > 1 ? ` (${spent.map((x) => `${SOURCE[x.s].name} ${money(x.days[i].cost)}`).join(', ')})` : '';
          return `${dayLabel(d.start)} · ≈ ${money(d.cost)}${parts} · ${compact(d.tokens)} tokens${d.cost > 0.005 ? '\nClick for that day’s sessions' : ''}`;
        }}
        link={(v) => ((v.d as Day).cost > 0.005 ? pageLink('sessions', { day: dayParam((v.d as Day).start) }) : null)}
        labels={n > 8 ? [dayLabel(days[0].start), dayLabel(days[Math.round(n / 3)].start), dayLabel(days[Math.round((2 * n) / 3)].start), 'Today'] : days.map((d, i) => (i === n - 1 ? 'Today' : weekday(d.start)))}
        even={n <= 8}
        markLabel={n <= 8 ? n - 1 : -1}
        height={170}
        gridLabel={(v) => money(v)}
        table={{ head: ['Day', 'Cost', 'Tokens'], row: (v) => [longDate((v.d as Day).start), (v.d as Day).cost > 0.005 ? money((v.d as Day).cost) : '', (v.d as Day).tokens ? compact((v.d as Day).tokens) : ''], newestFirst: true }}
      />
      {both && (
        <p className="mt-2 flex gap-3 text-label text-muted" aria-hidden>
          {sources.map((s) => <span key={s} className="inline-flex items-center gap-1.5"><i className={cx('size-2 rounded-[2px]', SOURCE[s].bg)} />{SOURCE[s].name}</span>)}
        </p>
      )}
    </Card>
  );
}

// ── Where the money goes ─────────────────────────────────────────────────────

type Item = { name: string; key?: string; cost: number; tokens: number; other?: boolean };
type Breakdown = { cost: number; tokens: number; models: Item[]; agents: Item[]; types?: Item[]; projects?: Item[] };

const MONEY_RANGE = 'overtime-breakdown';
const MONEY_VIEW = 'overtime-breakdown-view';
const readKey = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeKey = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function MoneyCard() {
  useChanged();
  const kind = useChartKind('money', SHARE_KINDS);
  const [range, setRange] = useState<'7' | '30'>(() => (readKey(MONEY_RANGE) === '30' ? '30' : '7'));
  const [view, setView] = useState<'models' | 'projects' | 'agents' | 'types'>(() => {
    const v = readKey(MONEY_VIEW);
    return v === 'agents' || v === 'types' || v === 'projects' ? v : 'models';
  });
  const breakdown = useInsight<{ d7: Breakdown; d30: Breakdown }>('breakdown');
  const head = (sub?: string) => (
    <CardHead
      title="Where the money goes"
      sub={sub}
      tools={
        <>
          <ChartSwitch id="money" kinds={SHARE_KINDS} />
          <Seg size="sm" label="Period" value={range} onChange={(r) => { setRange(r); writeKey(MONEY_RANGE, r); }} options={[['7', '7 days'], ['30', '30 days']]} />
        </>
      }
    />
  );
  if (!breakdown) {
    return (
      <Card>
        {head()}
        <Skeleton lines={4} />
      </Card>
    );
  }
  const b = range === '30' ? breakdown.d30 : breakdown.d7;
  const items = view === 'agents' ? b.agents : view === 'types' ? b.types || [] : view === 'projects' ? b.projects || [] : b.models;
  const linkFor = (it: Item) => (it.other ? null : view === 'projects' ? pageLink('projects', { p: it.name, range }) : view === 'models' ? pageLink('sessions', { q: it.name, range, sort: 'cost' }) : null);
  const labelOf = (it: Item) => (view === 'projects' && !it.other ? projectName(it.name) : it.name);
  const shares: Share[] = items.map((it, i) => ({
    name: view === 'projects' && !it.other ? (
      <>
        <ProjectDot name={it.name} />
        {labelOf(it)}
      </>
    ) : (
      labelOf(it)
    ),
    value: it.cost,
    valueText: money(it.cost),
    color: view === 'projects' && !it.other ? projectColor(it.name) : it.other ? 'var(--faint)' : kind === 'donut' ? DONUT_COLORS[i % DONUT_COLORS.length] : undefined,
    href: linkFor(it),
    tip: `${labelOf(it)}: ≈ ${money(it.cost)} · ${compact(it.tokens)} tokens${linkFor(it) ? `\nClick for ${view === 'projects' ? 'the project' : 'its sessions'}` : ''}`,
  }));
  const subs = b.agents.find((a) => a.name === 'Subagents');
  const opus5 = b.models.find((m) => m.name === 'Opus 5');
  const opus55 = b.models.find((m) => m.name === 'Opus 5.5');
  const share = (key: string) => (b.cost > 0 ? ((b.types || []).find((x) => x.key === key)?.cost || 0) / b.cost : 0);
  let tip = '';
  const topProject = (b.projects || [])[0];
  if (view === 'projects') {
    if (topProject && !topProject.other && b.cost > 0 && topProject.cost / b.cost >= 0.5) tip = `${projectName(topProject.name)} took ${Math.round((topProject.cost / b.cost) * 100)}% of the cost. Its page shows which sessions and models drove it.`;
  } else if (view === 'types') {
    if (share('cacheRead') >= 0.5) tip = `Cache reads are ${Math.round(share('cacheRead') * 100)}% of the cost: every message re-reads the whole conversation. Smaller conversations (a fresh session or /clear between tasks) cut this the most.`;
    else if (share('cacheWrite') >= 0.25) tip = `Cache writes are ${Math.round(share('cacheWrite') * 100)}% of the cost. They grow when a session sits idle past 5 minutes or compacts, and the conversation has to be written again.`;
    else if (share('output') >= 0.4) tip = `Output, including thinking, is ${Math.round(share('output') * 100)}% of the cost. A lower effort level gives shorter, cheaper replies.`;
  } else if (subs && b.cost > 0 && subs.cost / b.cost >= 0.25) tip = `Subagents are ${Math.round((subs.cost / b.cost) * 100)}% of the cost. Fewer or smaller helper agents is the biggest lever.`;
  else if (opus5 && opus55 && b.cost > 0 && opus5.cost / b.cost >= 0.1) tip = `${Math.round((opus5.cost / b.cost) * 100)}% went to Opus 5. Opus 5.5 has lower list prices, especially for cache reads.`;
  return (
    <Card className="flex flex-col gap-3">
      {head(`${range === '30' ? 'Last 30 days' : 'Last 7 days'} · ≈ ${money(b.cost)}, ${compact(b.tokens)} tokens`)}
      <Seg size="sm" className="self-start" label="Group by" value={view} onChange={(v) => { setView(v); writeKey(MONEY_VIEW, v); }} options={[{ value: 'models', label: 'Models' }, { value: 'projects', label: 'Projects' }, { value: 'agents', label: 'Agents', tip: 'Main agents against subagents' }, { value: 'types', label: 'Token type' }]} />
      {!items.length ? <Empty>No usage in this period.</Empty> : kind === 'donut' ? <Donut items={shares} total={b.cost} /> : <ShareList items={shares} total={b.cost} />}
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

// ── The priciest sessions of the week ────────────────────────────────────────

export function PriciestCard() {
  useChanged();
  // The week moves on at midnight.
  useMinute();
  const { data } = useSessions();
  const provider = useProvider();
  const from = calendarDay(serverNow(), -6);
  const rows = useMemo(
    () =>
      sessionsIn(data, provider, from)
        .filter((s) => s.cost > 0.005 || s.partial)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 8),
    [data, provider, from],
  );
  return (
    <Card>
      <CardHead title="Priciest sessions" sub="Last 7 days · including their subagents" tools={<TextLink href={pageLink('sessions', { range: '7', sort: 'cost' })}>All sessions →</TextLink>} />
      {!data ? (
        <Skeleton lines={4} />
      ) : !rows.length ? (
        <Empty>No session has cost anything in the last 7 days.</Empty>
      ) : (
        rows.map((s) => {
          const lines = s.added + s.removed;
          return (
            <SessionRow
              key={s.id}
              id={s.id}
              source={s.source}
              title={s.title}
              project={s.project}
              context={s.context}
              meta={[lines ? `+${compact(s.added)} −${compact(s.removed)} lines` : 'no edits', lines && s.cost > 0.05 ? linesPer(lines / s.cost) : '']}
              end={costText(s.cost, s.partial)}
              endSub={s.subCost > 0.005 ? `${money(s.subCost)} subagents` : undefined}
              endTip={s.partial ? 'Some models it used have no known price, so this is what the rest cost' : undefined}
              tip={`${titleFor(s.id, s.title)}\n≈ ${money(s.cost)} in the last 7 days${s.subCost > 0.005 ? `, ${money(s.subCost)} of it on subagents` : ''} · ${compact(s.tokens)} tokens\nClick for details`}
              className="border-b border-line last:border-b-0"
            />
          );
        })
      )}
    </Card>
  );
}

// ── Cache, context and long conversations ────────────────────────────────────

type Cache = { d7: { cost: number; saved: number; hitRate: number | null; rebuilds: number; rebuildCost: number; afterPause: number; afterPauseCost: number }; today: { saved: number } };

export function CacheCard() {
  const provider = useProvider();
  const cache = useInsight<Cache>('cache');
  const note = 'What the same tokens would cost at the normal input price, minus what reading and writing the cache cost. At API list prices, last 7 days.';
  const head = <CardHead title="Cache savings" sub="Last 7 days" tools={<InfoTip note={note} />} />;
  if (!cache) {
    return (
      <Card>
        {head}
        <Skeleton lines={3} />
      </Card>
    );
  }
  const c = cache.d7;
  if (!(c.cost > 0.005)) {
    return (
      <Card>
        {head}
        <Empty>No usage in the last 7 days.</Empty>
      </Card>
    );
  }
  const cut = c.saved > 0 ? Math.round((c.saved / (c.saved + c.cost)) * 100) : 0;
  const hit = c.hitRate != null ? `${(c.hitRate * 100).toFixed(1).replace(/\.0$/, '')}%` : '—';
  let tip = '';
  if (c.afterPause >= 3 && c.afterPauseCost >= 1) tip = `${c.afterPause} of ${c.rebuilds} rebuilds came after a break of 5+ minutes and cost ≈ ${money(c.afterPauseCost)}. The cache expires when a session sits idle, so the next message writes the whole conversation again. The bigger the conversation, the more that costs.`;
  else if (c.hitRate != null && c.hitRate < 0.8) tip = 'Less than 80% of your input came from the cache. Short sessions and frequent restarts keep it cold.';
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <div>
        <p className="text-figure font-bold tracking-[-0.02em] text-ok tnum">{c.saved > 0 ? `≈ ${money(c.saved)}` : '$0'}</p>
        <p className="text-detail text-muted">saved by prompt caching{cut ? `, ${cut}% less than without it` : ''}</p>
      </div>
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="From cache" value={hit} tip="Share of input tokens read from the cache instead of sent fresh" />
        <Stat label="Rebuilds (Claude)" value={provider === 'codex' ? '—' : c.rebuilds} sub={provider === 'codex' ? 'Unavailable' : `≈ ${money(c.rebuildCost)}`} tip={`Times most of a conversation had to be written to the cache again, costing ≈ ${money(c.rebuildCost)}. It happens when a session starts, compacts, or sits idle until the cache expires.`} />
        <Stat label="Saved today" value={`≈ ${money(cache.today.saved)}`} />
      </dl>
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

type Context = { messages: number; cost: number; avgContext: number; buckets: { label: string; max: number | null; messages: number; cost: number }[]; compactions: { count: number; auto: number; avgBefore: number | null } };

export function ContextCard() {
  const ctx = useInsight<Context>('context');
  const agents = useAllAgents();
  const note = 'Every message re-sends the whole conversation, so the bigger it gets, the more each message costs, even when it comes from the cache. Main agents and subagents, last 7 days.';
  const head = <CardHead title="Context size" sub="Last 7 days · what each message carried" tools={<InfoTip note={note} />} />;
  if (!ctx) {
    return (
      <Card>
        {head}
        <Skeleton lines={3} />
      </Card>
    );
  }
  if (!ctx.messages) {
    return (
      <Card>
        {head}
        <Empty>No messages in the last 7 days.</Empty>
      </Card>
    );
  }
  const group = (test: (b: Context['buckets'][number]) => boolean) => ctx.buckets.filter(test).reduce((g, b) => ({ messages: g.messages + b.messages, cost: g.cost + b.cost }), { messages: 0, cost: 0 });
  const small = group((b) => b.max != null && b.max <= 100_000);
  const big = group((b) => b.max == null || b.max > 200_000);
  const ratio = small.messages >= 20 && big.messages >= 20 ? big.cost / big.messages / (small.cost / small.messages) : null;
  const k = ctx.compactions;
  const full = agents.filter((a) => a.kind === 'main' && ((a as { context?: { pct?: number } }).context?.pct || 0) >= 70).sort((a, b) => ((b as { context: { pct: number } }).context.pct - (a as { context: { pct: number } }).context.pct)).slice(0, 4) as unknown as { id: string; source: Source; title: string; project: string; context: { used: number; window: number; pct: number } }[];
  let tip = '';
  if (ratio && ratio >= 1.5 && big.cost / ctx.cost >= 0.3) tip = `Messages with over 200K tokens of context cost ${ratio.toFixed(1)}× as much as those under 100K, and were ${Math.round((big.cost / ctx.cost) * 100)}% of the cost. A fresh session or /clear between tasks keeps messages small.`;
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <ShareList
        total={ctx.cost}
        items={ctx.buckets.map((b) => {
          const each = b.messages ? b.cost / b.messages : 0;
          return { name: b.label, value: b.cost, valueText: money(b.cost), tip: `${b.label} tokens: ${compact(b.messages)} messages · ≈ ${money(b.cost)} · about ${each >= 0.1 ? money(each) : `${(each * 100).toFixed(1)}¢`} each` };
        })}
      />
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Average" value={compact(ctx.avgContext)} tip="Average context per message, in tokens" />
        <Stat label="Big vs small" value={ratio ? `${ratio.toFixed(1)}×` : '—'} tip="Messages over 200K tokens cost this many times as much as those under 100K" />
        <Stat label="Compactions" value={k.count} tip={k.count ? `${k.auto} automatic, ${k.count - k.auto} manual${k.avgBefore ? `. On average at ${compact(k.avgBefore)} tokens` : ''}.` : 'No compactions in the last 7 days.'} />
      </dl>
      {full.length > 0 && (
        <section>
          <h3 className="mb-1 text-detail font-semibold text-muted">Filling up now</h3>
          {full.map((a) => (
            <SessionRow
              key={a.id}
              id={a.id}
              source={a.source}
              title={a.title}
              project={a.project}
              meta={[`${compact(a.context.used)} of ${compact(a.context.window)} tokens`]}
              end={<span className={a.context.pct >= 90 ? 'text-bad' : 'text-warn'}>{a.context.pct}%</span>}
              endSub="full"
              tip={`${titleFor(a.id, a.title)}: ${compact(a.context.used)} of ${compact(a.context.window)} tokens in the conversation\nClick for details`}
              className="border-b border-line last:border-b-0"
            />
          ))}
        </section>
      )}
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

type LongContext = { from: number; cost: number; spend: number; count: number; sessions: { id: string; source: Source; title: string; project: string; peak: number; messages: number; cost: number; surcharge: number }[]; size: { cost: number; messages: number }; surcharge: { cost: number; requests: number } };

const LONG_NOTE = "Two ways a long conversation costs more, over the last 7 days. The surcharge is exact: OpenAI's models charge 2× for input and 1.5× for output once a request passes 272K tokens. The rest is an estimate: every message re-reads the whole conversation from the cache, so the part of those reads beyond 200K tokens is roughly what compacting (or a fresh session) at 200K would have saved.";

export function LongContextCard() {
  const lc = useInsight<LongContext>('longContext');
  if (!lc) {
    return (
      <Card>
        <CardHead title="Long-context premium" tools={<InfoTip note={LONG_NOTE} />} />
        <Skeleton lines={3} />
      </Card>
    );
  }
  const head = <CardHead title="Long-context premium" sub={`Last 7 days · what conversations past ${compact(lc.from)} tokens cost extra`} tools={<InfoTip note={LONG_NOTE} />} />;
  if (!(lc.cost > 0.005)) {
    return (
      <Card>
        {head}
        <Empty>No conversation went past {compact(lc.from)} tokens in the last 7 days, so there was nothing extra to pay.</Empty>
      </Card>
    );
  }
  const share = lc.spend > 0 ? Math.round((lc.cost / lc.spend) * 100) : 0;
  const top = lc.sessions[0];
  const tip =
    lc.size.cost >= lc.surcharge.cost
      ? `Compacting or starting fresh once a conversation passes ${compact(lc.from)} tokens would have saved about ${money(lc.size.cost)} this week${top && lc.count > 1 && top.cost / lc.cost >= 0.4 ? `, ${Math.round((top.cost / lc.cost) * 100)}% of it in “${clip(titleFor(top.id, top.title), 40)}”` : ''}.`
      : `Codex charged the long-context rate on ${plural(lc.surcharge.requests, 'request')}: keeping a thread under 272K tokens (a new thread, or /compact) avoids it.`;
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <div className="grid grid-cols-1 gap-6 @min-[800px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-figure font-bold tracking-[-0.02em] tnum">≈ {money(lc.cost)}</p>
            <p className="text-detail text-muted">{share}% of the week's cost, across {plural(lc.count, 'session')}</p>
          </div>
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Long-context rate" value={lc.surcharge.requests ? money(lc.surcharge.cost) : 'None'} sub={lc.surcharge.requests ? `${compact(lc.surcharge.requests)} ${lc.surcharge.requests === 1 ? 'request' : 'requests'}` : 'Codex, past 272K'} tip="What OpenAI's long-context rate added to Codex requests past 272K tokens (2× input, 1.5× output). Exact." />
            <Stat label="Reading it all back" value={`≈ ${money(lc.size.cost)}`} sub={`${compact(lc.size.messages)} ${lc.size.messages === 1 ? 'message' : 'messages'}`} tip={`The share of each message's cache reads that was conversation beyond ${compact(lc.from)} tokens. An estimate.`} />
          </dl>
        </div>
        <section>
          <h3 className="mb-1 text-detail font-semibold text-muted">Where it went</h3>
          {lc.sessions.map((s) => (
            <SessionRow
              key={s.id}
              id={s.id}
              source={s.source}
              title={s.title}
              project={s.project}
              meta={[`peaked at ${compact(s.peak)} tokens`, `${compact(s.messages)} long ${s.messages === 1 ? 'message' : 'messages'}`]}
              end={money(s.cost)}
              endSub={s.surcharge > 0.005 ? `${money(s.surcharge)} surcharge` : undefined}
              tip={`${titleFor(s.id, s.title)}\n≈ ${money(s.cost)} extra over ${plural(s.messages, 'message')} past ${compact(lc.from)} tokens${s.surcharge > 0.005 ? `, ${money(s.surcharge)} of it the long-context rate` : ''}\nClick for the session`}
              className="border-b border-line last:border-b-0"
            />
          ))}
        </section>
      </div>
      <Insight>{tip}</Insight>
    </Card>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export const COST_CARDS = (): GridCard[] => [
  { id: 'plan', name: 'What your plans are worth', span: 12, node: <PlansCard /> },
  { id: 'trend', name: 'Daily cost', span: 12, node: <TrendCard /> },
  { id: 'money', name: 'Where the money goes', span: 6, node: <MoneyCard /> },
  { id: 'sessions', name: 'Priciest sessions', span: 6, node: <PriciestCard /> },
  { id: 'cache', name: 'Cache savings', span: 6, node: <CacheCard /> },
  { id: 'context', name: 'Context size', span: 6, node: <ContextCard /> },
  { id: 'longctx', name: 'Long-context premium', span: 12, node: <LongContextCard /> },
];

export function Cost() {
  useChanged();
  // Only whether to say some usage has no known price, so the page's cards aren't drawn again with each change to the spend.
  const partly = useLive((s) => {
    const spend = s.snap?.analytics?.[s.provider]?.spend;
    return [spend?.today, spend?.last7, spend?.last30].some((p) => unpriced(p as Period));
  });
  const cards = COST_CARDS();
  const rate = env.currency.code === 'USD' ? '' : ` Converted from US dollars at 1 US$ = ${env.currency.rate} ${env.currency.code}, the rate set in Settings.`;
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title="Cost"
        id="h-cost"
        sub={
          <span data-tip={`What your usage on this Mac would cost at each provider’s API list prices, including cache reads and writes. Your subscriptions and hosted tool charges are billed separately. ≈ marks such an estimate, and a + after a figure means some usage had no known price, so the real figure is a little higher.${rate}`} className="inline-flex items-center gap-1">
            What your usage would cost at API list prices
            <Info size={13} strokeWidth={1.8} aria-hidden />
          </span>
        }
        tools={<ArrangeButton page="cost" title="Cost" cards={cards} />}
      />
      {partly && <p role="status" className="rounded-row bg-warn-soft px-4 py-2.5 text-detail text-warn">Some of your usage is from models without a known price, so costs show what the rest cost, marked with a +. Tokens and working time count everything.</p>}
      <Tiles />
      <PageGrid page="cost" cards={cards} />
    </div>
  );
}
