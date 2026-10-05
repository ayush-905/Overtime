// The Agents page: what's running on this Mac and how much your agents worked.
// Open sessions and today's timeline, then agent hours and total agent time per
// day, when your agents worked across the last two weeks, how many worked at
// once, tool failures, and the skills they used. Cards in the order you arrange
// them.

import { useState } from 'react';
import { Layers, Moon, Sparkles } from 'lucide-react';
import { useInsight } from '@/data/scope';
import { useChanged, useMinute } from '@/data/hooks';
import {
  ago,
  atOffset,
  change,
  clock,
  compact,
  dayRuns,
  dayTicks,
  duration,
  hourLabel,
  hoursShort,
  hoursText,
  listText,
  longDate,
  MINUTE,
  HOUR,
  pctOf,
  plural,
  projectName,
  weekday,
  WEEKDAY_NAMES,
  whenText,
  workdayHour,
} from '@/lib/format';
import { serverNow } from '@/lib/env';
import { dayParam, pageLink } from '@/lib/route';
import type { ChartKind } from '@/lib/charts';
import { Card, CardHead, InfoTip } from '@/components/Card';
import { Hero, Stat } from '@/components/Stat';
import { Seg } from '@/components/Seg';
import { Avatar, Empty, Insight, Skeleton } from '@/components/Bits';
import { Calendar, ChartSwitch, Plot, ShareList, useChartKind, type CalendarColumn } from '@/components/Chart';
import { ArrangeButton, PageGrid, type GridCard } from '@/components/PageGrid';
import { Ago } from '@/components/Clock';
import { PageHeader } from '@/app/PageHeader';
import { TimelineCard } from '@/cards/Timeline';
import { OpenSessionsCard } from '@/cards/Sessions';
import { ExpandButton, ExpandDialog } from '@/cards/Expand';
import { sourceInfo, type Source } from '@/lib/sources';

const Delta = ({ now, before }: { now: number; before: number }) => {
  const c = change(now, before);
  return c ? <small className="ml-1 text-detail font-normal text-muted">{c}</small> : null;
};

type AgentDay = {
  start: number;
  wallMs: number;
  agentMs: number;
  first: number;
  last: number;
  peak: number;
  sessions: number;
  subagents: number;
  unattendedMs: number;
  stretches?: [number, number][];
};
type AgentHours = {
  dates: AgentDay[];
  days: AgentDay[];
  week: number;
  prevWeek: number;
  weekAgentMs: number;
  prevWeekAgentMs: number;
  weekUnattendedMs: number;
  typicalStart: number | null;
  typicalStop: number | null;
  lateNights: number;
  lastLate: number | null;
  longest: { from: number; to: number; ms: number } | null;
};

function agentDayTip(d: AgentDay, today: AgentDay) {
  if (!d.wallMs) return `${longDate(d.start)} · ${d === today ? 'no agent work yet' : 'no agent work'}`;
  return [
    `${longDate(d.start)} · agents worked ${duration(d.wallMs)}, ${clock(d.first)} to ${d === today ? 'now' : clock(d.last)}`,
    `${hoursText(d.agentMs)} of agent time added up, up to ${d.peak} at once`,
    `${plural(d.sessions, 'session')}${d.subagents ? `, ${plural(d.subagents, 'subagent')}` : ''}`,
    d.unattendedMs >= MINUTE ? `${duration(d.unattendedMs)} of it while you weren't active` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const useAgentHours = () => useInsight<AgentHours>('agentHours');

function Loading({ title }: { title: string }) {
  return (
    <Card>
      <CardHead title={title} />
      <Skeleton lines={4} />
    </Card>
  );
}

export function AgentHoursCard({ expanded = false }: { expanded?: boolean }) {
  const a = useAgentHours();
  const kind = useChartKind('agenthours');
  if (!a) return <Loading title="Agent hours" />;
  const note =
    'Time at least one agent was working, whatever set it off: your messages, subagents reporting back, background tasks or scheduled runs. Agents working at the same time count once here; Total agent time adds them up. Days run midnight to midnight.';
  const days = a.dates.slice(-(expanded ? 30 : 14));
  const head = (
    <CardHead
      title="Agent hours"
      sub={`Last ${days.length} days · per day`}
      tools={
        <>
          <ChartSwitch id="agenthours" />
          <InfoTip note={note} />
          {!expanded && <ExpandButton card="agenthours" />}
        </>
      }
    />
  );
  const worked = days.filter((d) => d.wallMs);
  if (!worked.length) {
    return (
      <Card>
        {head}
        <Empty>No agent work in the last {days.length} days.</Empty>
      </Card>
    );
  }
  const today = days[days.length - 1];
  const perDay = worked.reduce((n, d) => n + d.wallMs, 0) / worked.length;
  const away = [...worked].sort((x, y) => y.unattendedMs - x.unattendedMs)[0];
  const longest = worked.reduce((best, d) => (d.wallMs > best.wallMs ? d : best), worked[0]);
  const tip =
    a.weekUnattendedMs >= HOUR
      ? `Your agents worked ${hoursText(a.weekUnattendedMs)} this week while you weren't active, most on ${WEEKDAY_NAMES[new Date(away.start).getDay()]} (${hoursText(away.unattendedMs)}, until ${clock(away.last)}).`
      : '';
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero
        value={hoursText(perDay)}
        sub={`a day on average, over the ${plural(worked.length, 'day')} agents worked${today.wallMs ? ` · ${duration(today.wallMs)} today` : ''}`}
      />
      <Plot
        kind={kind}
        values={days.map((d) => ({ value: d.wallMs, current: d === today, d }))}
        color="var(--claude)"
        tip={(v) => agentDayTip(v.d as AgentDay, today)}
        link={(v) =>
          (v.d as AgentDay).wallMs ? pageLink('sessions', { day: dayParam((v.d as AgentDay).start) }) : null
        }
        labels={dayTicks(days.map((d) => d.start))}
        valueText={
          days.length <= 14 ? (v) => ((v.d as AgentDay).wallMs ? hoursShort((v.d as AgentDay).wallMs) : '–') : null
        }
        gridLabel={hoursText}
        height={expanded ? 240 : 140}
        even
        markLabel={days.length - 1}
        table={{
          head: ['Day', 'Agents worked', 'From', 'To', 'Most at once', 'Sessions'],
          row: (v) => {
            const d = v.d as AgentDay;
            return d.wallMs
              ? [
                  longDate(d.start),
                  duration(d.wallMs),
                  clock(d.first),
                  d === today ? 'now' : clock(d.last),
                  d.peak,
                  d.sessions,
                ]
              : [longDate(d.start)];
          },
          newestFirst: true,
        }}
      />
      <dl className="grid grid-cols-3 gap-4">
        <Stat
          label="This week"
          value={
            <>
              {hoursText(a.week)}
              <Delta now={a.week} before={a.prevWeek} />
            </>
          }
          tip={`Time at least one agent was working in the last 7 days, vs ${hoursText(a.prevWeek)} the 7 days before`}
        />
        <Stat
          label="Longest day"
          value={
            <>
              {hoursText(longest.wallMs)}{' '}
              <small className="text-detail font-normal text-muted">{weekday(longest.start)}</small>
            </>
          }
          tip={agentDayTip(longest, today)}
        />
        <Stat
          label="While you were away"
          value={hoursText(a.weekUnattendedMs)}
          tip="Agent work in the last 7 days while you weren't sending messages or waiting on a reply"
        />
      </dl>
      {tip && (
        <p className="flex items-start gap-2 text-detail text-muted">
          <Moon size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
          {tip}
        </p>
      )}
    </Card>
  );
}

export function TotalAgentTimeCard({ expanded = false }: { expanded?: boolean }) {
  const a = useAgentHours();
  const kind = useChartKind('agenttotal');
  if (!a) return <Loading title="Total agent time" />;
  const note =
    "Every agent's working time added up, so agents working at the same time each count. The solid part is time at least one agent was working (Agent hours); the lighter part on top is the extra from agents running in parallel. Days run midnight to midnight.";
  const days = a.dates.slice(-(expanded ? 30 : 14));
  const head = (
    <CardHead
      title="Total agent time"
      sub={`Last ${days.length} days · per day, overlaps counted`}
      tools={
        <>
          <ChartSwitch id="agenttotal" />
          <InfoTip note={note} />
          {!expanded && <ExpandButton card="agenttotal" />}
        </>
      }
    />
  );
  const worked = days.filter((d) => d.agentMs);
  if (!worked.length) {
    return (
      <Card>
        {head}
        <Empty>No agent work in the last {days.length} days.</Empty>
      </Card>
    );
  }
  const today = days[days.length - 1];
  const overlapMs = (d: AgentDay) => Math.max(0, (d.agentMs || 0) - (d.wallMs || 0));
  const weekOverlap = Math.max(0, a.weekAgentMs - a.week);
  const busiest = worked.reduce((best, d) => (d.agentMs > best.agentMs ? d : best), worked[0]);
  const atOnce = a.week > 0 ? a.weekAgentMs / a.week : null;
  const tip =
    atOnce && atOnce >= 1.3
      ? `This week your agents put in ${hoursText(a.weekAgentMs)} of work in ${hoursText(a.week)}: ${atOnce.toFixed(1)} at once on average. ${WEEKDAY_NAMES[new Date(busiest.start).getDay()]} was the busiest, with up to ${busiest.peak} at once.`
      : '';
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero
        value={hoursText(a.weekAgentMs)}
        sub={`of agent time this week${weekOverlap >= MINUTE ? `, ${hoursText(weekOverlap)} of it from agents running at the same time` : ''}`}
      />
      <Plot
        kind={kind}
        values={days.map((d) => ({ value: d.agentMs || 0, current: d === today, d }))}
        color="var(--claude)"
        segments={(v) => [
          { value: (v.d as AgentDay).wallMs, color: 'var(--claude)' },
          { value: overlapMs(v.d as AgentDay), color: 'color-mix(in srgb, var(--claude) 45%, var(--sunken))' },
        ]}
        tip={(v) => {
          const d = v.d as AgentDay;
          return d.agentMs
            ? `${longDate(d.start)} · ${hoursText(d.agentMs)} of agent time\n${hoursText(d.wallMs)} with at least one agent working\n+ ${hoursText(overlapMs(d))} from agents running at the same time (up to ${d.peak} at once)`
            : `${longDate(d.start)} · no agent work`;
        }}
        labels={dayTicks(days.map((d) => d.start))}
        valueText={
          days.length <= 14 ? (v) => ((v.d as AgentDay).agentMs ? hoursShort((v.d as AgentDay).agentMs) : '–') : null
        }
        gridLabel={hoursText}
        height={expanded ? 240 : 140}
        even
        markLabel={days.length - 1}
        table={{
          head: ['Day', 'Agent time', 'At least one', 'From overlaps', 'Most at once'],
          row: (v) => {
            const d = v.d as AgentDay;
            return d.agentMs
              ? [longDate(d.start), hoursText(d.agentMs), hoursText(d.wallMs), hoursText(overlapMs(d)), d.peak]
              : [longDate(d.start)];
          },
          newestFirst: true,
        }}
      />
      <p className="flex gap-4 text-label text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-[2px] bg-claude" />
          At least one agent
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i
            className="size-2 rounded-[2px]"
            style={{ background: 'color-mix(in srgb, var(--claude) 45%, var(--sunken))' }}
          />
          Extra from overlaps
        </span>
      </p>
      <dl className="grid grid-cols-3 gap-4">
        <Stat
          label="This week"
          value={
            <>
              {hoursText(a.weekAgentMs)}
              <Delta now={a.weekAgentMs} before={a.prevWeekAgentMs} />
            </>
          }
          tip={`All agent time in the last 7 days, vs ${hoursText(a.prevWeekAgentMs)} the 7 days before`}
        />
        <Stat
          label="From overlaps"
          value={
            <>
              {hoursText(weekOverlap)}{' '}
              <small className="text-detail font-normal text-muted">
                {a.weekAgentMs ? `${Math.round((weekOverlap / a.weekAgentMs) * 100)}%` : ''}
              </small>
            </>
          }
          tip="Agent time from agents running at the same time, in the last 7 days"
        />
        <Stat
          label="Busiest day"
          value={
            <>
              {hoursText(busiest.agentMs)}{' '}
              <small className="text-detail font-normal text-muted">{weekday(busiest.start)}</small>
            </>
          }
          tip={agentDayTip(busiest, today)}
        />
      </dl>
      {tip && (
        <p className="flex items-start gap-2 text-detail text-muted">
          <Layers size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
          {tip}
        </p>
      )}
    </Card>
  );
}

type YouDay = { start: number; stretches?: [number, number][] };

export function AgentWorkCard() {
  // Its "now" line moves by the minute.
  useMinute();
  const a = useAgentHours();
  const hours = useInsight<{ days: YouDay[] }>('hours');
  if (!a) return <Loading title="When your agents worked" />;
  const note = `When at least one agent was working, whatever set it off, next to your own active time (the thin grey blocks). A day runs ${dayRuns()} here${workdayHour() ? ', so agent work past midnight counts toward the day it started, shown deeper' : ''}.`;
  const head = <CardHead title="When your agents worked" sub="Last 14 days" tools={<InfoTip note={note} />} />;
  if (!a.days.some((d) => d.wallMs)) {
    return (
      <Card>
        {head}
        <Empty>No agent work in the last 14 days.</Empty>
      </Card>
    );
  }
  const now = serverNow();
  const today = a.days[a.days.length - 1];
  const columns: CalendarColumn[] = a.days.map((d, i) => {
    const blocks: CalendarColumn['blocks'] = [];
    for (const [s, e] of hours?.days[i]?.stretches || [])
      blocks.push({ from: s, to: e, color: 'var(--you)', opacity: 0.35 });
    if (d.wallMs) {
      const midnight = new Date(d.start).setHours(24, 0, 0, 0);
      for (const [s, e] of d.stretches || []) {
        if (s < midnight) blocks.push({ from: s, to: Math.min(e, midnight), color: 'var(--claude)', opacity: 0.85 });
        if (e > midnight)
          blocks.push({ from: Math.max(s, midnight), to: e, color: 'color-mix(in srgb, var(--claude) 70%, black)' });
      }
    }
    return {
      day: d.start,
      label: new Date(d.start).toLocaleDateString([], { weekday: 'narrow' }),
      current: d === today,
      tip: agentDayTip(d, today),
      blocks,
    };
  });
  const typical = a.typicalStart != null && a.typicalStop != null;
  const peak = a.days.reduce<AgentDay | null>((best, d) => ((d.peak || 0) > (best?.peak || 0) ? d : best), null);
  const lastLate = a.lastLate == null ? null : a.days.find((d) => d.start === a.lastLate);
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero
        value={typical ? `${atOffset(a.typicalStart!)} – ${atOffset(a.typicalStop!)}` : '—'}
        sub={`${typical ? 'a typical day, first to last agent activity' : 'Not enough days yet for a typical day'}${today.wallMs ? ` · today since ${clock(today.first)}` : ''}`}
      />
      <Calendar columns={columns} height={170} now={now} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-[2px] bg-claude" />
          Agents working
        </span>
        {a.lateNights > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i
              className="size-2 rounded-[2px]"
              style={{ background: 'color-mix(in srgb, var(--claude) 70%, black)' }}
            />
            After midnight
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-[2px] bg-you opacity-40" />
          You active
        </span>
      </p>
      <dl className="grid grid-cols-3 gap-4">
        <Stat
          label="Past midnight"
          value={
            <>
              {a.lateNights} <small className="text-detail font-normal text-muted">of 14</small>
            </>
          }
          tip={`Days agents were still working after midnight, out of the last 14${lastLate ? `. Most recently ${longDate(lastLate.start)}, until ${clock(lastLate.last)}.` : ''}`}
        />
        <Stat
          label="Longest stretch"
          value={
            a.longest ? (
              <>
                {hoursText(a.longest.ms)}{' '}
                <small className="text-detail font-normal text-muted">{weekday(a.longest.from)}</small>
              </>
            ) : (
              '—'
            )
          }
          tip={
            a.longest
              ? `${longDate(a.longest.from)}, ${clock(a.longest.from)} to ${clock(a.longest.to)}, with no break over 10 minutes`
              : 'No agent work yet'
          }
        />
        <Stat
          label="Most at once"
          value={
            peak ? (
              <>
                {peak.peak} <small className="text-detail font-normal text-muted">{weekday(peak.start)}</small>
              </>
            ) : (
              '—'
            )
          }
          tip={
            peak
              ? `${longDate(peak.start)}: ${plural(peak.sessions, 'session')} and ${plural(peak.subagents, 'subagent')} that day`
              : undefined
          }
        />
      </dl>
    </Card>
  );
}

type Parallel = {
  peak: { count: number; at: number; main: number; sub: number };
  peakToday: { count: number; at: number; main: number; sub: number };
  hours: { max: number; agentMs: number }[];
  busyMs: number;
  agentMs: number;
  agentMsToday: number;
};

export function ParallelCard() {
  // The hour it's in now is marked, so it's looked at again each minute.
  useMinute();
  const p = useInsight<Parallel>('parallel');
  const kind = useChartKind('parallel');
  if (!p) return <Loading title="Agents at once" />;
  const head = (
    <CardHead
      title="Agents at once"
      sub="Last 7 days · how many worked at the same time"
      tools={p.peak.count ? <ChartSwitch id="parallel" /> : undefined}
    />
  );
  if (!p.peak.count) {
    return (
      <Card>
        {head}
        <Empty>No agent work in the last 7 days.</Empty>
      </Card>
    );
  }
  const split = (x: Parallel['peak']) =>
    x.sub ? `${x.main} main, ${x.sub} subagent${x.sub === 1 ? '' : 's'}` : `${x.main} main`;
  const ratio = p.busyMs > 0 ? p.agentMs / p.busyMs : null;
  const hourNow = new Date(serverNow()).getHours();
  const top = Math.max(...p.hours.map((h) => h.max));
  const tip =
    ratio && ratio >= 1.3
      ? `This week your agents put in ${hoursText(p.agentMs)} of work in ${hoursText(p.busyMs)} of wall-clock time, ${ratio.toFixed(1)}× as much.`
      : '';
  return (
    <Card className="flex flex-col gap-4">
      {head}
      <Hero value={p.peak.count} sub={`most at once this week, ${whenText(p.peak.at)} (${split(p.peak)})`} />
      <section className="flex flex-col gap-2">
        <h3 className="text-detail font-semibold text-muted">Today, by hour</h3>
        {top ? (
          <Plot
            kind={kind}
            values={p.hours.map((h, i) => ({ value: h.max, current: i === hourNow, h, i }))}
            color="var(--claude)"
            tip={(v) => {
              const h = v.h as Parallel['hours'][number];
              const i = v.i as number;
              return `${hourLabel(i)}–${hourLabel((i + 1) % 24)} · ${h.max ? `up to ${h.max} at once · ${hoursText(h.agentMs)} of agent work` : 'no agents working'}`;
            }}
            labels={[0, 6, 12, 18, 23].map(hourLabel)}
            height={110}
            gridLabel={(v) => String(Math.round(v))}
            halfLine={top >= 4 && top % 2 === 0}
            table={{
              head: ['Hour', 'Most at once', 'Agent work'],
              row: (v) => {
                const h = v.h as Parallel['hours'][number];
                const i = v.i as number;
                return [
                  `${hourLabel(i)}–${hourLabel((i + 1) % 24)}`,
                  h.max || '',
                  h.agentMs ? hoursText(h.agentMs) : '',
                ];
              },
            }}
          />
        ) : (
          <Empty>No agents have worked yet today.</Empty>
        )}
      </section>
      <dl className="grid grid-cols-3 gap-4">
        <Stat
          label="Peak today"
          value={p.peakToday.count}
          tip={p.peakToday.count ? `${split(p.peakToday)}, ${whenText(p.peakToday.at)}` : 'Nobody has worked yet today'}
        />
        <Stat
          label="Agent time today"
          value={hoursText(p.agentMsToday)}
          tip="Time agents spent working today, added up across agents"
        />
        <Stat
          label="Average at once"
          value={ratio ? ratio.toFixed(1) : '—'}
          tip="How many agents were working, on average, whenever at least one was (last 7 days)"
        />
      </dl>
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

type Tools = {
  calls: number;
  failed: number;
  denied: number;
  today: { failed: number; calls: number };
  byTool: { name: string; failed: number; calls: number; denied?: number }[];
  reasons: { text: string; count: number }[];
  staleEdits: number;
};

export function ToolsCard() {
  const t = useInsight<Tools>('tools');
  if (!t) return <Loading title="Tool failures" />;
  const note =
    "Tool calls that came back with an error, over the last 7 days. A search that finds nothing (grep exiting with 1) doesn't count, and calls you said no to are counted separately.";
  const head = <CardHead title="Tool failures" sub="Last 7 days" tools={<InfoTip note={note} />} />;
  if (!t.calls) {
    return (
      <Card>
        {head}
        <Empty>No tool calls in the last 7 days.</Empty>
      </Card>
    );
  }
  const most = Math.max(1, ...t.byTool.map((x) => x.failed));
  const killed = t.reasons.find((r) => r.text.startsWith('Killed'));
  let tip = '';
  if (t.staleEdits >= 3)
    tip = `${t.staleEdits} edits failed because the file hadn't been read yet or changed after it was read. Each one costs the agent a retry.`;
  else if (killed && killed.count >= 3)
    tip = `${killed.count} commands were killed, usually for running too long or using too much memory.`;
  return (
    <Card className="@container/tools flex flex-col gap-4" aria-label="Tool failures">
      {head}
      <Hero
        value={t.failed}
        tone={t.failed ? undefined : 'ok'}
        sub={`failed, out of ${compact(t.calls)} tool calls (${pctOf(t.failed, t.calls)}%)`}
      />
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Failed today" value={t.today.failed} />
        <Stat label="Denied by you" value={t.denied} tip="Tool calls you said no to at a permission prompt" />
        <Stat label="Calls today" value={compact(t.today.calls)} />
      </dl>
      <div className="grid min-w-0 grid-cols-1 gap-6 @min-[640px]/tools:grid-cols-2 [&>*]:min-w-0">
        <section className="flex min-w-0 flex-col gap-2.5">
          <h3 className="flex justify-between gap-3 text-detail font-semibold text-muted">
            By tool <span className="shrink-0 font-normal">failed · rate</span>
          </h3>
          {t.byTool.length ? (
            <ShareList
              color="var(--bad-fill)"
              total={most}
              wrapNames
              items={t.byTool.map((x) => ({
                name: x.name,
                value: x.failed,
                valueText: String(x.failed),
                pctText: `${pctOf(x.failed, x.calls)}%`,
                tip: `${x.name}: ${x.failed} of ${compact(x.calls)} calls failed${x.denied ? `, ${x.denied} denied by you` : ''}`,
              }))}
            />
          ) : (
            <Empty>Nothing failed.</Empty>
          )}
        </section>
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-detail font-semibold text-muted">Why they failed</h3>
          {t.reasons.length ? (
            <ul className="flex min-w-0 flex-col">
              {t.reasons.map((r) => (
                <li
                  key={r.text}
                  data-tip={r.text}
                  className="flex min-w-0 items-start justify-between gap-3 border-b border-line py-2 text-detail last:border-b-0"
                >
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{r.text}</span>
                  <b className="shrink-0 font-semibold tnum">{r.count}</b>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No common reason.</Empty>
          )}
        </section>
      </div>
      {tip && <Insight>{tip}</Insight>}
    </Card>
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────

type Skill = {
  name: string;
  about?: string;
  kind: 'personal' | 'project' | 'plugin' | 'app' | 'builtin';
  source: Source;
  project?: string;
  plugin?: string;
  uses: number;
  you: number;
  agent: number;
  days: number;
  sessions: number;
  projects?: string[];
  lastAt: number;
};
type Skills = { offered: number; usedCount: number; uses: number; used: Skill[]; unused: Skill[] };

const KINDS: Record<Skill['kind'], [string, string]> = {
  personal: ['Yours', 'In ~/.claude/skills or ~/.codex/skills'],
  project: ['Project', "In a project's .claude/skills"],
  plugin: ['Plugin', 'From a plugin you installed'],
  app: ['Claude app', 'Synced from the Claude app, or your Claude account'],
  builtin: ['Built in', 'Comes with Claude Code or Codex'],
};
const SKILL_KINDS: ChartKind[] = ['list', 'table'];
const SKILLS_VIEW = 'overtime-skills-view';
const SKILLS_NOTE =
  'A skill counts as used when Claude Code loads it (you ran it as a command, or the agent chose it with its Skill tool) or when Codex reads its SKILL.md. What was on offer comes from the sessions themselves, so a skill no session was offered in 30 days isn’t listed.';

const shortName = (s: Skill) =>
  (s.kind === 'plugin' || s.kind === 'app') && s.name.includes(':') ? s.name.split(':').slice(1).join(':') : s.name;

function KindChip({ s }: { s: Skill }) {
  const [label, what] = KINDS[s.kind] || KINDS.builtin;
  const text =
    s.kind === 'project' && s.project ? projectName(s.project) : s.kind === 'plugin' && s.plugin ? s.plugin : label;
  const tip =
    s.kind === 'project' && s.project
      ? `A skill of the ${projectName(s.project)} project`
      : s.kind === 'plugin' && s.plugin
        ? `From the ${s.plugin} plugin`
        : what;
  return (
    <span data-tip={tip} className="shrink-0 rounded-sm bg-sunken px-1.5 text-label font-semibold text-muted">
      {text}
    </span>
  );
}

const skillTip = (s: Skill) =>
  [
    s.name,
    s.about,
    s.uses
      ? `${plural(s.uses, 'use')} on ${plural(s.days, 'day')}, in ${plural(s.sessions, 'session')}${s.projects?.length ? ` (${listText(s.projects.map(projectName))})` : ''}`
      : '',
    s.uses
      ? `${s.you ? `You ran it ${plural(s.you, 'time')}` : ''}${s.you && s.agent ? '; ' : ''}${s.agent ? `the agent chose it ${plural(s.agent, 'time')}` : ''}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

export function SkillsCard() {
  useMinute();
  const k = useInsight<Skills>('skills');
  const kind = useChartKind('skills', SKILL_KINDS);
  const [view, setView] = useState<'used' | 'unused'>(() => {
    try {
      return localStorage.getItem(SKILLS_VIEW) === 'unused' ? 'unused' : 'used';
    } catch {
      return 'used';
    }
  });
  const [builtIn, setBuiltIn] = useState(false);
  if (!k) return <Loading title="Skills" />;
  const now = serverNow();
  const sub = k.offered
    ? `Last 30 days · ${k.usedCount} of the ${k.offered} on offer used, ${plural(k.uses, 'time')}`
    : `Last 30 days · ${plural(k.usedCount, 'skill')} used, ${plural(k.uses, 'time')}`;
  const pick = (v: 'used' | 'unused') => {
    setView(v);
    try {
      if (v === 'used') localStorage.removeItem(SKILLS_VIEW);
      else localStorage.setItem(SKILLS_VIEW, v);
    } catch {}
  };
  const mine = k.unused.filter((s) => s.kind === 'personal' || s.kind === 'project');
  const you = k.used.reduce((n, s) => n + s.you, 0);
  const agent = k.used.reduce((n, s) => n + s.agent, 0);
  const named = mine.length > 4 ? [...mine.slice(0, 3).map(shortName), `${mine.length - 3} more`] : mine.map(shortName);
  let tip = '';
  if (view === 'unused' && mine.length)
    tip = `${plural(mine.length, 'skill')} of your own or your projects’ went unused: ${listText(named)}. If the agent should reach for them, their descriptions may need to say when.`;
  else if (view === 'used' && k.uses >= 3)
    tip =
      agent && you
        ? `You ran skills ${plural(you, 'time')}, and agents chose one themselves ${plural(agent, 'time')}.`
        : agent
          ? `Every use was an agent choosing a skill itself, ${plural(agent, 'time')}.`
          : 'Every use was you running a skill as a command. Agents didn’t pick one themselves.';
  const most = Math.max(1, ...k.used.map((s) => s.uses));
  const builtIns = k.unused.filter((s) => s.kind === 'builtin');
  const shownUnused = builtIn ? k.unused : k.unused.filter((s) => s.kind !== 'builtin');
  return (
    <Card className="flex flex-col gap-4">
      <CardHead
        title="Skills"
        sub={sub}
        tools={
          <>
            {view === 'used' && k.used.length > 0 && <ChartSwitch id="skills" kinds={SKILL_KINDS} />}
            <Seg
              size="sm"
              label="Show"
              value={view}
              onChange={pick}
              options={[
                ['used', `Used ${k.usedCount}`],
                ['unused', `Not used ${k.unused.length}`],
              ]}
            />
            <InfoTip note={SKILLS_NOTE} />
          </>
        }
      />
      {view === 'used' ? (
        !k.used.length ? (
          <Empty>No skills used in the last 30 days{k.offered ? `, of the ${k.offered} on offer` : ''}.</Empty>
        ) : kind === 'table' ? (
          <Plot
            kind="table"
            values={k.used.map((s) => ({ value: s.uses, s }))}
            tip={(v) => skillTip(v.s as Skill)}
            labels={[]}
            height={230}
            table={{
              head: [
                'Skill',
                'Provider',
                'Where from',
                'Uses',
                'You ran it',
                'Agent chose it',
                'Sessions',
                'Last used',
              ],
              row: (v) => {
                const s = v.s as Skill;
                return [
                  s.name,
                  sourceInfo(s.source).name,
                  s.kind === 'project' && s.project
                    ? `Project: ${s.project}`
                    : s.kind === 'plugin' && s.plugin
                      ? `Plugin: ${s.plugin}`
                      : KINDS[s.kind]?.[0],
                  s.uses,
                  s.you,
                  s.agent,
                  s.sessions,
                  `${ago(now - s.lastAt)} ago`,
                ];
              },
            }}
          />
        ) : (
          <>
            <ul className="flex flex-col">
              {k.used.map((s) => (
                <li
                  key={`${s.source}:${s.name}`}
                  data-tip={skillTip(s)}
                  className="grid grid-cols-[20px_minmax(0,1fr)_minmax(40px,160px)_auto_auto] items-center gap-3 border-b border-line py-2 last:border-b-0"
                >
                  <Avatar source={s.source} size={18} />
                  <span className="flex min-w-0 items-center gap-2">
                    <b className="truncate font-semibold">{shortName(s)}</b>
                    <KindChip s={s} />
                  </span>
                  <span className="flex h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                    <i className="bg-s1" style={{ width: `${((s.you / most) * 100).toFixed(1)}%` }} />
                    <i className="bg-claude" style={{ width: `${((s.agent / most) * 100).toFixed(1)}%` }} />
                  </span>
                  <span className="flex flex-col items-end">
                    <b className="font-semibold tnum">{s.uses}</b>
                    <small className="whitespace-nowrap text-label text-muted">
                      {s.you && s.agent ? `${s.you} you · ${s.agent} agent` : s.you ? 'you ran it' : 'agent chose it'}
                    </small>
                  </span>
                  <time className="whitespace-nowrap text-right text-label text-muted">
                    <Ago t={s.lastAt} /> ago
                  </time>
                </li>
              ))}
            </ul>
            <p className="flex gap-4 text-label text-muted" aria-hidden>
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-[2px] bg-s1" />
                You ran it as a command
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-[2px] bg-claude" />
                The agent chose it
              </span>
            </p>
          </>
        )
      ) : !k.unused.length ? (
        <Empty>
          {k.offered
            ? 'Every skill on offer was used in the last 30 days.'
            : 'The transcripts don’t list the skills on offer, so there’s nothing to compare with.'}
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {(Object.keys(KINDS) as Skill['kind'][]).map((kd) => {
            const list = shownUnused.filter((s) => s.kind === kd);
            if (!list.length) return null;
            return (
              <section key={kd} className="flex flex-col gap-1.5">
                <h3 className="text-detail font-semibold text-muted">
                  {KINDS[kd][0]} <small className="font-normal">{list.length}</small>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((s) => (
                    <span
                      key={`${s.source}:${s.name}`}
                      data-tip={[
                        s.name,
                        s.about,
                        s.kind === 'project' && s.project ? `From ${projectName(s.project)}` : '',
                      ]
                        .filter(Boolean)
                        .join('\n')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card py-0.5 pl-1 pr-2.5 text-detail"
                    >
                      <Avatar source={s.source} size={16} />
                      {shortName(s)}
                      {s.kind === 'plugin' && s.plugin && <small className="text-label text-muted">{s.plugin}</small>}
                    </span>
                  ))}
                </div>
              </section>
            );
          })}
          {!shownUnused.length && <Empty>Only built-in skills went unused.</Empty>}
          {builtIns.length > 0 && (
            <button
              type="button"
              aria-expanded={builtIn}
              onClick={() => setBuiltIn(!builtIn)}
              className="self-start text-detail font-semibold text-accent hover:underline"
            >
              {builtIn ? 'Hide the built-in ones' : `Show ${plural(builtIns.length, 'built-in skill')} too`}
            </button>
          )}
        </div>
      )}
      {tip && (
        <p className="flex items-start gap-2 text-detail text-muted">
          <Sparkles size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
          {tip}
        </p>
      )}
    </Card>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

const AGENT_CARDS = (): GridCard[] => [
  { id: 'open', name: 'Open agent sessions', span: 12, node: <OpenSessionsCard /> },
  { id: 'timeline', name: "Today's timeline", span: 12, node: <TimelineCard /> },
  { id: 'agenthours', name: 'Agent hours', span: 6, node: <AgentHoursCard /> },
  { id: 'agenttotal', name: 'Total agent time', span: 6, node: <TotalAgentTimeCard /> },
  { id: 'agentwork', name: 'When your agents worked', span: 12, node: <AgentWorkCard /> },
  { id: 'parallel', name: 'Agents at once', span: 6, node: <ParallelCard /> },
  { id: 'tools', name: 'Tool failures', span: 6, node: <ToolsCard /> },
  { id: 'skills', name: 'Skills', span: 12, node: <SkillsCard /> },
];

const EXPANDABLE = {
  timeline: { name: "Today's timeline", render: () => <TimelineCard expanded /> },
  agenthours: { name: 'Agent hours', render: () => <AgentHoursCard expanded /> },
  agenttotal: { name: 'Total agent time', render: () => <TotalAgentTimeCard expanded /> },
  'open-sessions': { name: 'Open agent sessions', render: () => <OpenSessionsCard expanded /> },
};

export function Agents() {
  useChanged();
  const cards = AGENT_CARDS();
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title="Agents"
        id="h-agents"
        sub="What's running on this Mac, and how much your agents worked"
        tools={<ArrangeButton page="agents" title="Agents" cards={cards} />}
      />
      <PageGrid page="agents" cards={cards} />
      <ExpandDialog cards={EXPANDABLE} />
    </div>
  );
}
