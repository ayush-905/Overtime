// The You page: when and how long you work with your agents, and how long they
// wait for you. The activity heatmap of every day on record, your active and
// working hours, your messages, prompts you repeat (and making one a command),
// waiting for you and who waited, and which hours and days you work. Cards in
// the order you arrange them.

import { useState, type ReactNode } from 'react';
import { Bell, CalendarDays, Check, Clock, Lightbulb, Moon, Wand2, X } from 'lucide-react';
import { useScope, useAgents, useAlertPrefs } from '@/data/scope';
import { useChanged, useNow } from '@/data/hooks';
import { useHistory } from '@/data/queries';
import { activeBetween, ago, atOffset, calendarDay, change, clip, clock, compact, costText, dayLabel, dayRuns, dayTicks, DAY, duration, hourLabel, hoursShort, hoursText, HOUR, longDate, MINUTE, money, plural, projectColor, projectName, weekday, WEEKDAY_NAMES, WEEK_ORDER, whenText, workDay, workdayHour } from '@/lib/format';
import { env, serverNow } from '@/lib/env';
import { titleFor } from '@/lib/labels';
import { waitingNow } from '@/lib/agents';
import { dayParam, pageLink } from '@/lib/route';
import type { ChartKind } from '@/lib/charts';
import { Card, CardHead, InfoTip } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { Seg } from '@/components/Seg';
import { Button, IconButton } from '@/components/Button';
import { Avatar, Empty, Insight, Skeleton } from '@/components/Bits';
import { Dropdown } from '@/components/Dropdown';
import { Calendar, ChartSwitch, heatStyle, HourGrid, Plot, ShareList, useChartKind, type CalendarColumn } from '@/components/Chart';
import { ArrangeButton, PageGrid, type GridCard } from '@/components/PageGrid';
import { SessionRow } from '@/components/SessionRow';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { offerUndo } from '@/app/toasts';
import { useUi } from '@/app/ui';
import { useCommand } from '@/app/CommandDialog';
import { ExpandButton, ExpandDialog } from '@/cards/Expand';
import { Hero } from './Agents';
import type { Source } from '@/lib/sources';

function Loading({ title }: { title: string }) {
  return (
    <Card>
      <CardHead title={title} />
      <Skeleton lines={4} />
    </Card>
  );
}

const Tip = ({ icon: Icon, children }: { icon: typeof Moon; children: string }) => (
  <p className="flex items-start gap-2 text-detail text-muted">
    <Icon size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
    <span>{children}</span>
  </p>
);

const Small = ({ children }: { children: ReactNode }) => <small className="ml-1 text-detail font-normal text-muted">{children}</small>;

// ── The activity heatmap ─────────────────────────────────────────────────────

type HistDay = { day: number; cost: number; tokens: number; activeMs: number; agentMs: number; messages: number; sessions: number };
const METRICS: Record<string, { label: string; text: (v: number) => string; short: (v: number) => string; none: string }> = {
  cost: { label: 'Cost', text: (v) => `≈ ${money(v)}`, short: (v) => money(v), none: 'no cost' },
  tokens: { label: 'Tokens', text: (v) => `${compact(v)} tokens`, short: (v) => compact(v), none: 'no tokens' },
  activeMs: { label: 'Your time', text: (v) => `${duration(v)} active`, short: duration, none: 'no active time' },
  agentMs: { label: 'Agent time', text: (v) => `agents worked ${duration(v)}`, short: duration, none: 'no agent work' },
  messages: { label: 'Messages', text: (v) => plural(v, 'message'), short: (v) => compact(Math.round(v)), none: 'no messages' },
};
const HM_KEY = 'overtime-heatmap';
const HM_NOTE = "Each square is a day, Monday at the top, and darker means more of what you picked. The last 30 days come from your transcripts; Overtime keeps a summary of every day in ~/.overtime, so the graph keeps growing after Claude Code clears transcripts older than a month. A day from the last 30 opens its sessions.";
const HM_COLOR: Record<string, string> = { cost: 'var(--claude)', tokens: 'var(--s3)', activeMs: 'var(--you)', agentMs: 'var(--claude)', messages: 'var(--s1)' };

/** Midnight on the Monday of the week `t` falls in. */
function monday(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function HeatmapCard() {
  useChanged();
  const { scope, provider } = useScope();
  const h = useHistory(provider);
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      const v = localStorage.getItem(HM_KEY);
      return v && v in METRICS ? v : null;
    } catch {
      return null;
    }
  });
  const metric = picked || (env.measure === 'tokens' ? 'tokens' : 'cost');
  const pick = (m: string) => {
    setPicked(m);
    try {
      localStorage.setItem(HM_KEY, m);
    } catch {}
  };
  const head = (sub: string) => (
    <CardHead
      title="Activity"
      sub={sub}
      tools={
        <>
          {/* Five choices don't fit a narrow card side by side, so there they're a menu. */}
          <span className="hidden @min-[640px]:block">
            <Seg size="sm" label="Shade by" value={metric} onChange={pick} options={Object.entries(METRICS).map(([k, m]) => [k, m.label] as [string, string])} />
          </span>
          <Dropdown
            label="Shade by"
            value={metric}
            onChange={pick}
            options={Object.entries(METRICS).map(([value, m]) => ({ value, label: m.label }))}
            className="min-w-32 @min-[640px]:hidden"
          />
          <InfoTip note={HM_NOTE} />
        </>
      }
    />
  );
  if (h.isPending) return <Loading title="Activity" />;
  if (h.isError || !h.data) {
    return (
      <Card>
        {head('Every day on record')}
        <Empty>Couldn't get your history from Overtime's server.</Empty>
      </Card>
    );
  }
  const now = serverNow();
  const today = calendarDay(now);
  const byDay = new Map((h.data.days as HistDay[]).map((d) => [calendarDay(d.day), { ...d }]));
  // Today from the live numbers, which move faster than the history does.
  const ins = scope?.insights as { messages?: { today?: number }; hours?: never; agentHours?: { dates?: { wallMs: number }[] } } | null;
  const live: Partial<HistDay> = {
    cost: scope?.spend?.today?.cost,
    tokens: scope?.spend?.today?.tokens,
    messages: ins?.messages?.today,
    activeMs: ins?.hours ? activeBetween(ins.hours, today, now) : undefined,
    agentMs: ins?.agentHours?.dates?.[ins.agentHours.dates.length - 1]?.wallMs,
  };
  const t0 = byDay.get(today) || { day: today, cost: 0, tokens: 0, activeMs: 0, agentMs: 0, messages: 0, sessions: 0 };
  for (const [k, v] of Object.entries(live)) if (v != null) (t0 as Record<string, number>)[k] = v as number;
  byDay.set(today, t0);
  const firstDay = Math.min(...byDay.keys());
  const weeks = 53;
  const start = calendarDay(monday(now), -(weeks - 1) * 7);
  const m = METRICS[metric];
  const value = (d: HistDay | undefined) => (d ? (d as unknown as Record<string, number>)[metric] || 0 : 0);
  // Four shades, split where the days with any activity fall.
  const values = [...byDay.values()].map(value).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? Infinity;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (v: number) => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
  const linkFrom = calendarDay(now, -29);
  const color = HM_COLOR[metric];
  // A narrow card shows the last 26 or 17 weeks (older ones hide).
  const age = (wk: number) => (wk < weeks - 26 ? 'hidden @min-[900px]:block' : wk < weeks - 17 ? 'hidden @min-[600px]:block' : '');
  const cells = Array.from({ length: weeks }, (_, wk) => {
    const hide = age(wk);
    const first = calendarDay(start, wk * 7);
    const d0 = new Date(first);
    const month = d0.getDate() <= 7 && wk < weeks - 2 ? d0.toLocaleDateString([], { month: 'short' }) : '';
    return [
      <span key={`m${wk}`} className={cx('h-3.5 overflow-visible whitespace-nowrap text-[10px] leading-none text-muted', hide)}>
        {month}
      </span>,
      ...Array.from({ length: 7 }, (_, wd) => {
        const t = calendarDay(start, wk * 7 + wd);
        const key = `${wk}-${wd}`;
        if (t > today) return <i key={key} className={cx('aspect-square', hide)} aria-hidden />;
        const d = byDay.get(t);
        if (!d && t < firstDay) return <i key={key} className={cx('aspect-square rounded-[2px] bg-sunken/50', hide)} data-tip={`${longDate(t)} · before Overtime's records`} />;
        const v = value(d);
        const tip = `${longDate(t)} · ${v > 0 ? m.text(v) : m.none}${d && d.sessions ? ` · ${plural(d.sessions, 'session')}` : ''}${d && metric !== 'cost' && d.cost > 0.005 ? ` · ≈ ${money(d.cost)}` : ''}${t >= linkFrom && d?.sessions ? '\nClick for that day’s sessions' : ''}`;
        const cls = cx('block aspect-square rounded-[2px]', t === today && 'ring-1 ring-ink/50', hide);
        return t >= linkFrom && d?.sessions ? <a key={key} href={pageLink('sessions', { day: dayParam(t) })} data-tip={tip} aria-label={tip.split('\n')[0]} className={cls} style={heatStyle(level(v), color)} /> : <i key={key} data-tip={tip} className={cls} style={heatStyle(level(v), color)} />;
      }),
    ];
  });
  // Totals over the days on record.
  const recorded = [...byDay.values()].filter((d) => d.day <= today);
  const sum = recorded.reduce((n, d) => n + value(d), 0);
  const activeDays = recorded.filter((d) => value(d) > 0).length;
  const best = recorded.reduce((b, d) => (value(d) > value(b) ? d : b), recorded[0]);
  const worked = (t: number) => {
    const d = byDay.get(t);
    return !!d && (d.messages > 0 || d.cost > 0.01);
  };
  let streak = 0;
  for (let t = worked(today) ? today : calendarDay(today, -1); worked(t); t = calendarDay(t, -1)) streak++;
  let longest = 0;
  for (let t = firstDay, run = 0; t <= today; t = calendarDay(t, 1)) {
    run = worked(t) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const total = `${metric === 'cost' ? '≈ ' : ''}${m.short(sum)}`;
  const perDay = activeDays ? `${metric === 'cost' ? '≈ ' : ''}${m.short(sum / activeDays)}` : '—';
  const byWeekday = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (const d of recorded) {
    const wd = (new Date(d.day).getDay() + 6) % 7;
    byWeekday[wd].sum += value(d);
    byWeekday[wd].n++;
  }
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const busiest = byWeekday.map((x, i) => [i, x.n ? x.sum / x.n : 0]).sort((a, b) => b[1] - a[1])[0];
  const days = Math.round((today - firstDay) / DAY) + 1;
  const tip = days <= 35 ? 'Overtime keeps a summary of each day from now on, so this fills in past the 30 days your transcripts cover.' : busiest[1] > 0 ? `${names[busiest[0]]} is your busiest day of the week for ${m.label.toLowerCase()}.` : '';
  return (
    <Card className="flex flex-col gap-4">
      {head(`${plural(days, 'day')} on record · since ${longDate(firstDay)}`)}
      {/* One grid: a column of weekday names, then a column per week (older ones drop out on a narrow card). */}
      <div role="img" aria-label={`${m.label} per day, ${plural(days, 'day')} on record`} className="grid gap-[3px]" style={{ gridTemplateRows: 'auto repeat(7, auto)', gridTemplateColumns: '28px', gridAutoColumns: 'minmax(0, 1fr)', gridAutoFlow: 'column' }}>
        <span />
        {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => (
          <span key={i} className="self-center text-[10px] leading-none text-muted" aria-hidden>
            {d}
          </span>
        ))}
        {cells}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 @min-[640px]:grid-cols-4">
          <Stat label="Total" value={total} />
          <Stat label="Active days" value={<>{activeDays}<Small>{perDay} a day</Small></>} tip={`Days with any ${m.label.toLowerCase()}, and the average over them`} />
          <Stat label="Streak" value={<>{streak}<Small>{longest > streak ? `best ${longest}` : streak === 1 ? 'day' : 'days'}</Small></>} tip="Days in a row with a message or some cost, up to today" />
          <Stat label="Best day" value={best && value(best) > 0 ? <>{m.short(value(best))}<Small>{new Date(best.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Small></> : '—'} tip={best ? `${longDate(best.day)}: ${m.text(value(best))}` : undefined} />
        </dl>
        <p className="flex items-center gap-1 text-label text-muted" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className="size-2.5 rounded-[2px]" style={heatStyle(l, color)} />
          ))}
          More
        </p>
      </div>
      {tip && <Tip icon={days <= 35 ? CalendarDays : Lightbulb}>{tip}</Tip>}
    </Card>
  );
}

// ── Your hours ───────────────────────────────────────────────────────────────

type HourDay = { start: number; messages: number; first: number; last: number; stretches: [number, number][]; late?: boolean; activeMs: number };
type Hours = { days: HourDay[]; dates: HourDay[]; typicalStart: number | null; typicalStop: number | null; typicalLength: number | null; lateNights: number; lastLate: number | null; streak: number; longestStreak: number; daysOff: number; week: number; prevWeek: number };

function useHours() {
  const { scope } = useScope();
  return (scope?.insights as { hours?: Hours } | null)?.hours;
}

export function ActiveHoursCard({ expanded = false }: { expanded?: boolean }) {
  const w = useHours();
  const kind = useChartKind('activehours');
  if (!w) return <Loading title="Your active hours" />;
  const note = "Your own time: from each message you typed until the agent's reply to it ends, with breaks under 30 minutes bridged. Work agents did on their own, like subagents reporting back or a long run after you stopped, is in Agent hours. Days run midnight to midnight.";
  const days = w.dates.slice(-(expanded ? 30 : 14));
  const head = (
    <CardHead
      title="Your active hours"
      sub={`Last ${days.length} days · per day`}
      tools={
        <>
          <ChartSwitch id="activehours" />
          <InfoTip note={note} />
          {!expanded && <ExpandButton card="activehours" />}
        </>
      }
    />
  );
  const worked = days.filter((d) => d.activeMs > 0);
  if (!worked.length) {
    return (
      <Card>
        {head}
        <Empty>You haven't sent a message in the last {days.length} days.</Empty>
      </Card>
    );
  }
  const today = days[days.length - 1];
  const perDay = worked.reduce((n, d) => n + d.activeMs, 0) / worked.length;
  const longest = worked.reduce((best, d) => (d.activeMs > best.activeMs ? d : best), worked[0]);
  const tip = (d: HourDay) => {
    if (!d.activeMs) return `${longDate(d.start)} · ${d === today ? 'no messages yet' : 'day off'}`;
    const span = d.messages ? ` · ${clock(d.first)} to ${d === today ? 'now' : clock(d.last)} · ${plural(d.messages, 'message')}` : ' · carried on from a message the day before';
    return `${longDate(d.start)} · ${duration(d.activeMs)} active${span}`;
  };
  const c = change(w.week, w.prevWeek);
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero value={hoursText(perDay)} sub={`a day on average, over the ${plural(worked.length, 'day')} you worked${today.activeMs ? ` · ${duration(today.activeMs)} today` : ''}`} />
      <Plot
        kind={kind}
        values={days.map((d) => ({ value: d.activeMs, current: d === today, d }))}
        color="var(--you)"
        tip={(v) => tip(v.d as HourDay)}
        link={(v) => ((v.d as HourDay).activeMs ? pageLink('sessions', { day: dayParam((v.d as HourDay).start) }) : null)}
        labels={dayTicks(days.map((d) => d.start))}
        valueText={days.length <= 14 ? (v) => ((v.d as HourDay).activeMs ? hoursShort((v.d as HourDay).activeMs) : '–') : null}
        gridLabel={hoursText}
        height={expanded ? 240 : 140}
        even
        markLabel={days.length - 1}
        table={{ head: ['Day', 'Active', 'First message', 'Last message', 'Messages'], row: (v) => { const d = v.d as HourDay; return [longDate(d.start), d.activeMs ? duration(d.activeMs) : '', d.first ? clock(d.first) : '', d.last ? clock(d.last) : '', d.messages || '']; }, newestFirst: true }}
      />
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="This week" value={<>{hoursText(w.week)}{c && <Small>{c}</Small>}</>} tip="Active time over the last 7 days, today included" />
        <Stat label="Week before" value={w.prevWeek ? hoursText(w.prevWeek) : '—'} tip="Active time in the 7 days before that" />
        <Stat label="Longest day" value={<>{hoursText(longest.activeMs)}<Small>{weekday(longest.start)}</Small></>} tip={tip(longest)} />
      </dl>
    </Card>
  );
}

export function WorkHoursCard() {
  useNow();
  const w = useHours();
  if (!w) return <Loading title="Your working hours" />;
  const note = `Your own time, from the messages you typed. A day runs ${dayRuns()}${workdayHour() ? ', so working past midnight counts toward the day you started' : ''} (you can change when it starts in Settings). Start and stop are your first and last messages. The solid bars are active time: from each message until the agent's reply to it ends, with breaks under 30 minutes bridged. Past midnight is shown in amber.`;
  const head = <CardHead title="Your working hours" sub="Last 14 days" tools={<InfoTip note={note} />} />;
  if (!w.days.some((d) => d.messages)) {
    return (
      <Card>
        {head}
        <Empty>You haven't sent a message in the last 14 days.</Empty>
      </Card>
    );
  }
  const now = serverNow();
  const today = w.days[w.days.length - 1];
  const columns: CalendarColumn[] = w.days.map((d) => {
    const blocks: CalendarColumn['blocks'] = [];
    if (d.messages) {
      const midnight = new Date(d.start).setHours(24, 0, 0, 0);
      blocks.push({ from: d.first, to: Math.max(d.last, ...d.stretches.map((s) => s[1])), color: 'color-mix(in srgb, var(--you) 18%, transparent)', dark: false });
      for (const [a, b] of d.stretches) {
        if (a < midnight) blocks.push({ from: a, to: Math.min(b, midnight), color: 'var(--you)' });
        if (b > midnight) blocks.push({ from: Math.max(a, midnight), to: b, color: 'var(--warn-fill)' });
      }
    }
    const tip = d.messages ? `${longDate(d.start)} · ${clock(d.first)} to ${clock(d.last)}${d.late ? ', past midnight' : ''} · ${hoursText(d.activeMs)} active · ${plural(d.messages, 'message')}` : `${longDate(d.start)} · ${d === today ? 'no messages yet' : 'day off'}`;
    return { day: d.start, label: new Date(d.start).toLocaleDateString([], { weekday: 'narrow' }), current: d === today, tip, blocks };
  });
  const typical = w.typicalStart != null && w.typicalStop != null;
  const lastLate = w.lastLate == null ? '' : w.lastLate === today.start ? 'including tonight' : w.lastLate === workDay(now, -1) ? 'most recently last night' : `most recently on ${WEEKDAY_NAMES[new Date(w.lastLate).getDay()]}`;
  let tip = '';
  let icon = Moon;
  if (w.lateNights >= 3 && w.streak >= 10) tip = `You worked past midnight on ${w.lateNights} of the last 14 days, and you've worked ${w.streak} days in a row.`;
  else if (w.lateNights >= 3) tip = `You worked past midnight on ${w.lateNights} of the last 14 days, ${lastLate}.`;
  else if (w.streak >= 10) [tip, icon] = [`You've worked ${w.streak} days in a row without a day off.`, CalendarDays];
  else if ((w.typicalLength || 0) >= 12 * HOUR) [tip, icon] = [`Your typical day runs ${hoursText(w.typicalLength!)} from your first message to your last.`, Clock];
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero value={typical ? `${atOffset(w.typicalStart!)} – ${atOffset(w.typicalStop!)}` : '—'} sub={`${typical ? `a typical day, first to last message${w.typicalLength ? ` (${hoursText(w.typicalLength)})` : ''}` : 'Not enough days yet for a typical day'}${today.messages ? ` · today since ${clock(today.first)}` : ''}`} />
      <Calendar columns={columns} height={170} now={now} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-you" />Active</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-[2px]" style={{ background: 'color-mix(in srgb, var(--you) 18%, transparent)' }} />First to last message</span>
        {w.lateNights > 0 && <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-warn-fill" />After midnight</span>}
      </p>
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Late nights" value={<>{w.lateNights}<Small>of 14</Small></>} tip="Days you were still sending messages after midnight, out of the last 14" />
        <Stat label="Streak" value={<>{w.streak}<Small>{w.streak === 1 ? 'day' : 'days'}</Small></>} tip={`Days in a row with at least one message${w.longestStreak > w.streak ? `. Your longest in the last 30 days was ${w.longestStreak}` : ''}.`} />
        <Stat label="Days off" value={<>{w.daysOff}<Small>of 13</Small></>} tip="Days in the last 2 weeks, before today, when you didn't send a message" />
      </dl>
      {tip && <Tip icon={icon}>{tip}</Tip>}
    </Card>
  );
}

// ── Your messages ────────────────────────────────────────────────────────────

type Msg = { text: string; project: string; session: string; t: number; cost: number; partial?: boolean; ms: number; inOffice?: boolean };
type Messages = { count: number; cost: number; partial?: boolean; buckets: { label: string; count: number }[]; top?: Msg[]; priciest?: Msg; longest?: Msg; today: number; activeDays: number; interrupts: number; medianMs: number | null };

export function MessagesCard() {
  const { scope } = useScope();
  const m = (scope?.insights as { messages?: Messages } | null)?.messages;
  const openSession = useUi((s) => s.openSession);
  if (!m) return <Loading title="Your messages" />;
  const note = "Messages you typed in your agents, not background task notices or subagent tasks. A message's cost includes the subagents it started. Last 7 days.";
  const head = <CardHead title="Your messages" sub="Last 7 days" tools={<InfoTip note={note} />} />;
  if (!m.count) {
    return (
      <Card>
        {head}
        <Empty>You haven't sent a message in the last 7 days.</Empty>
      </Card>
    );
  }
  const per = m.cost / m.count;
  const top = m.top?.length ? m.top : [m.priciest].filter(Boolean) as Msg[];
  const isLongest = (x: Msg) => !!m.longest && x.t === m.longest.t && x.session === m.longest.session;
  const standouts: [string, Msg][] = [...top.map((x, i) => [`${['Priciest', '2nd priciest', '3rd priciest'][i]}${isLongest(x) ? ', longest' : ''}`, x] as [string, Msg])];
  if (!top.some(isLongest) && m.longest) standouts.push(['Longest', m.longest]);
  const quick = m.buckets[0].count / m.count;
  let tip = '';
  if (m.interrupts >= 5 && m.interrupts / m.count >= 0.08) tip = `You stopped ${m.interrupts} turns early (${Math.round((m.interrupts / m.count) * 100)}% of your messages). Saying what "done" looks like in the first message usually saves a restart.`;
  else if (m.count >= 30 && quick >= 0.4) tip = `${Math.round(quick * 100)}% of your messages got a reply in under a minute. Each message re-sends the whole conversation, so batching small asks into one saves money.`;
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <div className="grid gap-5 @min-[560px]:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Hero value={`≈ ${costText(per, m.partial)}`} sub={`per message on average, across ${m.count} messages`} />
          <dl className="grid grid-cols-3 gap-4">
            <Stat label="Today" value={m.today} />
            <Stat label="Per day" value={Math.round(m.count / Math.max(1, m.activeDays))} tip={`Over the ${plural(m.activeDays, 'day')} you sent any`} />
            <Stat label="Interrupted" value={m.interrupts} tip="Times you stopped an agent mid-turn" />
          </dl>
        </div>
        <section className="flex flex-col gap-2.5">
          <h3 className="text-detail font-semibold text-muted">How long each kept an agent busy{m.medianMs != null ? ` · typically ${duration(m.medianMs)}` : ''}</h3>
          <ShareList color="var(--you)" total={m.count} items={m.buckets.map((b) => ({ name: b.label, value: b.count, valueText: String(b.count), tip: `${b.count} message${b.count === 1 ? '' : 's'} kept an agent busy for ${b.label.toLowerCase()}` }))} />
        </section>
      </div>
      {standouts.length > 0 && (
        <ul className="flex flex-col">
          {standouts.map(([label, x]) => (
            <li key={`${x.session}:${x.t}`}>
              <button
                type="button"
                data-row=""
                data-session={x.session}
                onClick={() => openSession(x.session, { at: x.t })}
                data-tip={`${x.text || 'Untitled'} · ${projectName(x.project)} · ${whenText(x.t)} · ≈ ${money(x.cost)}, ${duration(x.ms)}${x.inOffice ? ' · session still running' : ''}\nClick for the session`}
                className="grid w-full grid-cols-[110px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-2 text-left text-detail last:border-b-0 hover:bg-sunken/50"
              >
                <span className="text-label font-semibold text-muted">{label}</span>
                <span className="truncate">“{clip(x.text || 'Untitled', 90)}”</span>
                <b className="whitespace-nowrap font-semibold tnum">
                  {costText(x.cost, x.partial)} · {duration(x.ms)}
                </b>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

// ── Prompts you repeat ───────────────────────────────────────────────────────

export type Repeat = { key: string; count: number; sessions: number; lastAt: number; projects?: string[]; exact: boolean; examples: string[]; source: Source; sources?: Record<string, number>; name: string; description: string; body: string; words: number; exists?: Record<string, boolean> };
type Repeats = { groups: Repeat[]; prompts: number };

const HIDDEN_KEY = 'overtime-repeats-hidden';
export const MADE_KEY = 'overtime-commands-made';
const SHOWN = 5;
export const usage = (target: string, name: string) => (target === 'codex' ? `/prompts:${name}` : `/${name}`);
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown, empty = false) => {
  try {
    if (empty) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export function RepeatsCard() {
  useChanged();
  const { scope } = useScope();
  const r = (scope?.insights as { repeats?: Repeats } | null)?.repeats;
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readJson<string[]>(HIDDEN_KEY, [])));
  const [expanded, setExpanded] = useState(false);
  const made = readJson<Record<string, { name: string; target: string }>>(MADE_KEY, {});
  const make = useCommand((s) => s.open);
  if (!r) return <Loading title="Prompts you repeat" />;
  const note = "Prompts you sent on two or more occasions an hour or more apart in the last 30 days, allowing for small changes in the wording. A resumed session's copy of a message counts once. A command keeps the prompt in a file, so you type /its-name instead, with anything that changes after it.";
  const groups = r.groups.filter((g) => !hidden.has(g.key));
  const head = <CardHead title="Prompts you repeat" sub={`Last 30 days · ${groups.length ? `${plural(groups.length, 'prompt')} you sent more than once` : 'what you send again and again'}`} tools={<InfoTip note={note} />} />;
  const put = (next: Set<string>) => {
    setHidden(next);
    writeJson(HIDDEN_KEY, [...next], !next.size);
  };
  if (!groups.length) {
    return (
      <Card className="flex flex-col gap-3">
        {head}
        <Empty>
          {r.groups.length ? `You've hidden ${plural(r.groups.length, 'one')}. ` : ''}Nothing you sent on two or more occasions, out of {plural(r.prompts, 'prompt')} in the last 30 days. When there is, it shows here, ready to become a slash command.
        </Empty>
        {hidden.size > 0 && (
          <button type="button" className="self-start text-detail font-semibold text-accent hover:underline" onClick={() => { const before = hidden; put(new Set()); offerUndo('The hidden prompts are back', () => put(before)); }}>
            Show the hidden ones
          </button>
        )}
      </Card>
    );
  }
  const shown = expanded ? groups : groups.slice(0, SHOWN);
  const open = groups.filter((g) => !made[g.key]);
  const words = Math.round(open.reduce((n, g) => n + g.words, 0) / Math.max(1, open.length));
  const tip = open.length ? `${open.length === 1 ? 'It’s' : 'They’re'} about ${plural(words, 'word')} you type again each time. As a command it’s ${usage(open[0].source, open[0].name)}, with whatever changes that time after it.` : 'You made every one of these into a command.';
  return (
    <Card className="flex flex-col gap-3">
      {head}
      <ul className="flex flex-col">
        {shown.map((g) => {
          const done = made[g.key];
          const meta = [`${g.count} times`, g.sessions > 1 ? `in ${plural(g.sessions, 'session')}` : 'in one session', `last ${ago(serverNow() - g.lastAt)} ago`, g.projects?.length ? g.projects.map(projectName).join(', ') : '', g.exact ? '' : 'worded a little differently'].filter(Boolean).join(' · ');
          const tipText = [g.examples.length > 1 ? 'As you wrote it:' : '', ...g.examples.map((e) => `“${clip(e, 220)}”`)].filter(Boolean).join('\n\n');
          return (
            <li key={g.key} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <span className="flex shrink-0 -space-x-1.5">
                {Object.keys(g.sources || { [g.source]: 1 }).map((src) => (
                  <Avatar key={src} source={src as Source} size={18} />
                ))}
              </span>
              <div className="flex min-w-0 grow flex-col" data-tip={tipText}>
                <p className="truncate">“{clip(g.examples[0], 160)}”</p>
                <p className="truncate text-detail text-muted">
                  {meta}
                  {!done && (
                    <>
                      {' '}· as <code className="rounded-sm bg-sunken px-1 text-label">{usage(g.source, g.name)}</code>
                    </>
                  )}
                </p>
              </div>
              {done ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-detail font-semibold text-ok" data-tip={`Made as ${usage(done.target, done.name)}`}>
                  <Check size={14} strokeWidth={2.2} aria-hidden />
                  <code>{usage(done.target, done.name)}</code>
                </span>
              ) : (
                <Button size="sm" icon={<Wand2 size={13} strokeWidth={2} aria-hidden />} onClick={() => make(g)}>
                  Make a command
                </Button>
              )}
              <IconButton size="sm" variant="quiet" label="Hide this one" tip="Not worth a command: hide it" onClick={() => { const before = hidden; put(new Set([...hidden, g.key])); offerUndo('Hid that prompt', () => put(before)); }}>
                <X size={14} strokeWidth={2} aria-hidden />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {groups.length > SHOWN && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="self-start text-detail font-semibold text-accent hover:underline">
          {expanded ? 'Show fewer' : `Show ${groups.length - SHOWN} more`}
        </button>
      )}
      <Tip icon={Wand2}>{tip}</Tip>
    </Card>
  );
}

// ── Waiting ──────────────────────────────────────────────────────────────────

type Waiting = { replies: number; ms: number; medianMs: number; today: { ms: number }; days: { start: number; ms: number; replies: number }[]; projects?: { name: string; ms: number; replies: number }[]; longest?: { session: string; source: Source; title: string; project: string; t: number; ms: number }[] };
const WAIT_NOTE = "From an agent's last reply to your next message in that session: time it sat done and waiting. A wait over 30 minutes counts as you stepping away, not the agent waiting, so it's left out. A message you sent while the agent was still busy kept nobody waiting.";

export function WaitingCard() {
  const { scope } = useScope();
  const w = (scope?.insights as { waiting?: Waiting } | null)?.waiting;
  const kind = useChartKind('waiting');
  const prefs = useAlertPrefs();
  if (!w) return <Loading title="Waiting for you" />;
  const head = <CardHead title="Waiting for you" sub="Last 7 days · from an agent's reply to your next message" tools={<><ChartSwitch id="waiting" /><InfoTip note={WAIT_NOTE} /></>} />;
  if (!w.replies) {
    return (
      <Card>
        {head}
        <Empty>No replies to a finished agent in the last 7 days.</Empty>
      </Card>
    );
  }
  const active = w.days.filter((d) => d.replies).length;
  const alertOn = prefs.waiting;
  const tip = w.ms >= 30 * MINUTE ? `Your agents sat waiting ${duration(w.ms)} this week, about ${duration(w.ms / Math.max(1, active))} on a day you worked. ${alertOn ? `You get an alert once one has waited ${prefs.waitMinutes} minutes.` : 'An alert in Settings can tell you when one has waited a while.'}` : `Agents rarely wait long for you: typically ${duration(w.medianMs)} before you reply.`;
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero value={duration(w.ms)} sub={`agents waited for your replies, across ${plural(w.replies, 'reply', 'replies')}`} />
      <Plot
        kind={kind}
        values={w.days.map((d, i) => ({ value: d.ms, current: i === w.days.length - 1, d }))}
        color="var(--warn-fill)"
        tip={(v) => { const d = v.d as Waiting['days'][number]; return `${dayLabel(d.start)} · ${d.replies ? `${duration(d.ms)} waiting over ${plural(d.replies, 'reply', 'replies')}` : 'no waits'}${d.replies ? '\nClick for that day’s sessions' : ''}`; }}
        link={(v) => ((v.d as Waiting['days'][number]).replies ? pageLink('sessions', { day: dayParam((v.d as Waiting['days'][number]).start) }) : null)}
        labels={w.days.map((d) => new Date(d.start).toLocaleDateString([], { weekday: 'narrow' }))}
        height={110}
        even
        markLabel={w.days.length - 1}
        gridLabel={(v) => duration(v)}
        table={{ head: ['Day', 'Waiting', 'Replies'], row: (v) => { const d = v.d as Waiting['days'][number]; return [longDate(d.start), d.replies ? duration(d.ms) : '', d.replies || '']; }, newestFirst: true }}
      />
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Today" value={duration(w.today.ms)} />
        <Stat label="Per day" value={duration(w.ms / Math.max(1, active))} tip={`Over the ${plural(active, 'day')} with any`} />
        <Stat label="Typical reply" value={duration(w.medianMs)} tip="Half your replies came sooner than this" />
      </dl>
      <Tip icon={alertOn ? Bell : Lightbulb}>{tip}</Tip>
    </Card>
  );
}

export function WaitingWhereCard() {
  useNow();
  const { scope } = useScope();
  const { all } = useAgents();
  const w = (scope?.insights as { waiting?: Waiting } | null)?.waiting;
  if (!w) return <Loading title="Who waited" />;
  const now = serverNow();
  const waiting = waitingNow(all, now);
  return (
    <Card className="flex flex-col gap-4">
      <CardHead title="Who waited" sub="Right now, and over the last 7 days" tools={<InfoTip note={WAIT_NOTE} />} />
      <section>
        <h3 className="mb-1 text-detail font-semibold text-muted">Waiting now</h3>
        {waiting.length ? (
          waiting.slice(0, 3).map(({ a, ms }) => <SessionRow key={a.id} id={a.id} source={a.source} title={a.title} project={a.project} now="Waiting for you" end={duration(ms)} className="border-b border-line last:border-b-0" />)
        ) : (
          <Empty>No agent is waiting for you right now.</Empty>
        )}
      </section>
      {(w.projects || []).length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-detail font-semibold text-muted">By project</h3>
          <ShareList
            total={w.ms}
            items={(w.projects || []).map((p) => ({ name: projectName(p.name), value: p.ms, valueText: duration(p.ms), color: projectColor(p.name), href: pageLink('projects', { p: p.name, range: '7' }), tip: `${projectName(p.name)}: ${duration(p.ms)} over ${plural(p.replies, 'reply', 'replies')}\nClick for the project` }))}
          />
        </section>
      )}
      {(w.longest || []).length > 0 && (
        <section>
          <h3 className="mb-1 text-detail font-semibold text-muted">Longest waits</h3>
          {(w.longest || []).slice(0, 3).map((x) => (
            <SessionRow key={`${x.session}:${x.t}`} id={x.session} source={x.source} title={x.title} project={x.project} at={x.t} meta={[`you replied ${weekday(x.t)} ${clock(x.t)}`]} end={duration(x.ms)} endSub="waiting" tip={`${titleFor(x.session, x.title)} · ${projectName(x.project)}\nYou replied ${whenText(x.t)}, ${dayLabel(x.t)}, after ${duration(x.ms)}\nClick for the session`} className="border-b border-line last:border-b-0" />
          ))}
        </section>
      )}
    </Card>
  );
}

// ── Which hours and days ─────────────────────────────────────────────────────

type Trend = { hours: { cost: number; tokens?: number }[]; grid?: number[][]; weekdays?: { since: number; today?: { cost: number }; days: { cost: number; total: number; activeDays: number; count: number }[] } };

export function HoursCard() {
  const { scope } = useScope();
  const trend = (scope?.insights as { trend?: Trend } | null)?.trend;
  const kind = useChartKind('hours');
  if (!trend) return <Loading title="When you work" />;
  const total = trend.hours.reduce((n, h) => n + h.cost, 0);
  const busiest = trend.hours.map((h, i) => [i, h.cost]).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c > 0).map(([h]) => hourLabel(h));
  return (
    <Card className="flex flex-col gap-3">
      <CardHead title="When you work" sub={`Last 30 days · ${busiest.length ? `busiest around ${busiest.join(', ')}` : 'share of the cost by hour'}`} tools={<ChartSwitch id="hours" />} />
      {kind === 'heat' && trend.grid ? (
        <HourGrid grid={trend.grid} color="var(--claude)" tip={(d, h, v) => `${WEEKDAY_NAMES[d]}s, ${hourLabel(h)}–${hourLabel((h + 1) % 24)} · ${total ? Math.round((v / total) * 100) : 0}% of the cost (≈ ${money(v)})`} />
      ) : (
        <Plot
          kind={kind}
          values={trend.hours.map((h, i) => ({ value: h.cost, h, i }))}
          color="var(--claude)"
          tip={(v) => { const i = v.i as number; return `${hourLabel(i)}–${hourLabel((i + 1) % 24)} · ${total ? Math.round((v.value / total) * 100) : 0}% of the cost (≈ ${money(v.value)})`; }}
          labels={[0, 6, 12, 18, 23].map(hourLabel)}
          height={170}
          gridLabel={(v) => (total ? `${Math.round((v / total) * 100)}%` : '')}
          table={{ head: ['Hour', 'Share of cost', 'Cost'], row: (v) => { const i = v.i as number; return [`${hourLabel(i)}–${hourLabel((i + 1) % 24)}`, v.value > 0.005 && total ? `${Math.round((v.value / total) * 100)}%` : '', v.value > 0.005 ? money(v.value) : '']; } }}
        />
      )}
    </Card>
  );
}

const WEEKDAY_KINDS: ChartKind[] = ['bars', 'line', 'heat', 'table']; // seven averages: an area would suggest they follow on

export function WeekdaysCard() {
  const { scope } = useScope();
  const w = (scope?.insights as { trend?: Trend } | null)?.trend?.weekdays;
  const kind = useChartKind('weekdays', WEEKDAY_KINDS);
  if (!w) return <Loading title="Which days you work" />;
  const days = w.days;
  const total = days.reduce((n, d) => n + d.total, 0);
  if (!total) {
    return (
      <Card>
        <CardHead title="Which days you work" sub="Last 4 weeks · average cost per weekday" />
        <Empty>Not enough history yet.</Empty>
      </Card>
    );
  }
  const busiest = WEEK_ORDER.filter((i) => days[i].cost > 0).sort((a, b) => days[b].cost - days[a].cost).slice(0, 2).map((i) => WEEKDAY_NAMES[i].slice(0, 3));
  const weekend = Math.round(((days[0].total + days[6].total) / total) * 100);
  const today = new Date(serverNow()).getDay();
  const weeks = Math.max(...days.map((d) => d.count));
  const span = weeks >= 4 ? 'last 4 weeks' : `since ${dayLabel(w.since)}`;
  return (
    <Card className="flex flex-col gap-3">
      <CardHead title="Which days you work" sub={`${weeks >= 4 ? 'Last 4 weeks' : `Since ${dayLabel(w.since)}`} · ${busiest.length ? `busiest on ${busiest.join(' and ')}, ` : ''}weekends ${weekend}% of the cost`} tools={<ChartSwitch id="weekdays" kinds={WEEKDAY_KINDS} />} />
      <Plot
        kind={kind}
        values={WEEK_ORDER.map((i) => ({ value: days[i].cost, d: days[i], i }))}
        color="var(--claude)"
        tip={(v) => { const i = v.i as number; const d = days[i]; return `${WEEKDAY_NAMES[i]}s · ≈ ${money(d.cost)} on average · used on ${d.activeDays} of ${d.count} (${span})${i === today && w.today ? `\nIncludes today so far: ≈ ${money(w.today.cost)}` : ''}`; }}
        labels={WEEK_ORDER.map((i) => WEEKDAY_NAMES[i].slice(0, 3))}
        height={170}
        gridLabel={(v) => money(v)}
        even
        markLabel={WEEK_ORDER.indexOf(today)}
        table={{ head: ['Day', 'Average cost', 'Days used'], row: (v) => { const i = v.i as number; const d = days[i]; return [`${WEEKDAY_NAMES[i]}s`, money(d.cost), `${d.activeDays} of ${d.count}`]; } }}
      />
    </Card>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

const YOU_CARDS = (): GridCard[] => [
  { id: 'heatmap', name: 'Activity', span: 12, node: <HeatmapCard /> },
  { id: 'activehours', name: 'Your active hours', span: 6, node: <ActiveHoursCard /> },
  { id: 'messages', name: 'Your messages', span: 6, node: <MessagesCard /> },
  { id: 'repeats', name: 'Prompts you repeat', span: 12, node: <RepeatsCard /> },
  { id: 'waiting', name: 'Waiting for you', span: 6, node: <WaitingCard /> },
  { id: 'waiting-where', name: 'Who waited', span: 6, node: <WaitingWhereCard /> },
  { id: 'workhours', name: 'Your working hours', span: 12, node: <WorkHoursCard /> },
  { id: 'hours', name: 'When you work', span: 6, node: <HoursCard /> },
  { id: 'weekdays', name: 'Which days you work', span: 6, node: <WeekdaysCard /> },
];

const EXPANDABLE = { activehours: { name: 'Your active hours', render: () => <ActiveHoursCard expanded /> } };

export function You() {
  useChanged();
  const cards = YOU_CARDS();
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader title="You" id="h-you" sub="When and how long you work with your agents, and how long they wait for you" tools={<ArrangeButton page="you" title="You" cards={cards} />} />
      <PageGrid page="you" cards={cards} />
      <ExpandDialog cards={EXPANDABLE} />
    </div>
  );
}
