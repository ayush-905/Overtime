// The Usage page's figures: today's
// share of the weekly limit, the 5-hour windows of the last week and when to
// start your first one, and the current window as a line (Claude's, from its
// spend on this Mac; Codex's, from the readings it writes here).

import {
  atOffset,
  calendarDay,
  clock,
  dayLabel,
  DAY,
  duration,
  HOUR,
  listText,
  longDate,
  MINUTE,
  money,
  nextMidnight,
  pctText,
  plural,
  weekday,
  whenText,
  workDay,
} from './format';
import {
  codexPace,
  codexQuota,
  limitInfo,
  quotaFreshness,
  windowName,
  type CodexWindow,
  type LimitInfo,
  type LimitsInput,
} from './limits';
import type { CalendarBlock, CalendarColumn } from '@/components/Chart';
import type { SessionPlan, WorkingHours } from '@/data/types';

type Info = Extract<LimitInfo, { active: true }>;
export const isActive = (i: LimitInfo | null): i is Info => !!i && 'active' in i;

// ── Today's share of the week ────────────────────────────────────────────────

export type Share =
  | { resetsToday: true; left: number }
  | { resetsToday?: false; share: number; tomorrowShare: number; usedToday: number | null; cap: number | null };

/**
 * What's left of the weekly limit, spread evenly over the days until it resets.
 * Today's share is fixed at midnight, so using some today doesn't shrink it.
 * Today's use in % comes from today's spend and what 1% of the week costs.
 */
export function dailyShare(info: Info, inp: LimitsInput): Share | null {
  if (info.limited || info.pct == null || !info.resetsAt) return null;
  const now = inp.now;
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  const tomorrow0 = nextMidnight(now);
  const left = 100 - info.pct;
  if (info.resetsAt <= tomorrow0) return { resetsToday: true, left };
  const cap =
    info.pct >= 3 && (info.spent ?? 0) > 0.5 ? info.spent! / (info.pct / 100) : inp.limits?.weekly?.capacity || null;
  const todaySpend = inp.limits?.spend?.today?.cost;
  // If the week started today, only what came after the reset counts.
  const usedToday =
    cap && todaySpend != null && info.spent != null
      ? Math.min(info.pct, (Math.min(todaySpend, info.spent) / cap) * 100)
      : null;
  const from = Math.max(today0, info.resetsAt - 7 * DAY);
  return {
    share: (left + (usedToday || 0)) / Math.max(1, (info.resetsAt - from) / DAY),
    tomorrowShare: left / Math.max(1, (info.resetsAt - tomorrow0) / DAY),
    usedToday,
    cap,
  };
}

/** How today's share reads: its line, its tip, and how today's use compares. */
export function shareText(d: Share, info: Info) {
  if (d.resetsToday)
    return {
      value: `All ${Math.round(d.left)}%`,
      line: 'The weekly limit resets today, so everything left is yours.',
      tip: '',
      ratio: null,
      over: false,
    };
  const dollars = d.cap ? ` That's about ${money((d.share / 100) * d.cap)} a day at API prices.` : '';
  const tip = `What's left of your weekly limit, spread evenly over the days until it resets ${whenText(info.resetsAt)}. It's set at midnight, so using some today doesn't shrink it.${dollars}`;
  if (d.usedToday == null)
    return {
      value: `≈ ${pctText(d.share)}%`,
      line: `A steady ${pctText(d.share)}% a day lasts until the reset.`,
      tip,
      ratio: null,
      over: false,
    };
  const ratio = d.share > 0 ? d.usedToday / d.share : 1;
  const line =
    ratio > 1
      ? `${pctText(d.usedToday)}% used today, ${pctText(d.usedToday - d.share)}% over · tomorrow's share ≈ ${pctText(d.tomorrowShare)}%`
      : `${pctText(d.usedToday)}% used today · ${pctText(d.share - d.usedToday)}% left for today`;
  return { value: `≈ ${pctText(d.share)}%`, line, tip, ratio, over: ratio > 1 };
}

// ── The 5-hour windows ───────────────────────────────────────────────────────

/** Claude Code's 5-hour windows of the last week and the plan for them (insights.windows). */
export type WindowPlan = SessionPlan;

/**
 * What a full 5-hour window costs at API prices: from the exact % when it's on
 * and far enough along to be steady, otherwise from when you last hit the limit.
 */
export function sessionCap(inp: LimitsInput) {
  const exact = inp.exactOn && inp.exact?.status === 'ok' ? inp.exact.session : null;
  const spent = exact?.spend?.cost;
  const fromExact = exact && exact.pct >= 3 && (spent ?? 0) > 0.5 ? spent! / (exact.pct / 100) : null;
  if (fromExact && exact!.pct >= 10) return fromExact;
  return inp.limits?.session?.capacity || fromExact;
}

/** When to start your first window of the day, from your usual day. */
export function planText(p: WindowPlan, fullest: number | null): { text: string; tip?: string; strong?: boolean } {
  const plan = p.plan;
  if (!plan) return { text: 'After a few more days, this suggests when to start your first window of the day.' };
  const start = atOffset(plan.start);
  const stop = atOffset(plan.stop);
  const by = atOffset(plan.by);
  const n = plan.useful;
  const tip = `Your usual day is ${start} to ${stop} (the typical first and last message). A window counts if it starts at least an hour before you usually stop. Any message starts a window, including a short one in claude.ai.`;
  if (plan.lead > 3 * HOUR)
    return {
      tip,
      text: `Your windows already fit your day (${start} to ${stop}): you get ${plural(n, 'fresh window')}. One more would need a message before ${by}.`,
    };
  const busy = p.hits > 0 || (fullest ?? 0) >= 70;
  if (busy)
    return {
      tip,
      strong: true,
      text: `Your day usually runs ${start} to ${stop}, which fits ${plural(n, 'window')}. Send a quick message before ${by} and you'd get ${n + 1}, with fresh ones starting around ${listText(plan.resets.map(atOffset))}.`,
    };
  const calm =
    fullest != null ? `Your fullest window this week was ${fullest}%` : "You haven't hit a session limit this week";
  return {
    tip,
    text: `${calm}, so timing doesn't matter much yet. If you start running out, a quick message before ${by} gets you ${n + 1} windows a day instead of ${n}.`,
  };
}

type Win = {
  start: number;
  end: number;
  cost: number;
  hitAt: number | null;
  current?: boolean;
  projected?: boolean;
  pct?: number | null;
};

/** The last 7 days' windows as calendar columns, with the fullest, the cap, and the planner's advice. */
export function windowsModel(
  p: WindowPlan,
  hours: Pick<WorkingHours, 'typicalStop'> | null | undefined,
  inp: LimitsInput,
) {
  const now = inp.now;
  const cap = sessionCap(inp);
  const exact = inp.exactOn && inp.exact?.status === 'ok' ? inp.exact.session : null;
  const windows: Win[] = p.windows.map((w) => ({ ...w }));
  // The window running now: the exact reset time wins over the rebuilt one.
  let current = windows.find((w) => w.start <= now && w.end > now);
  // Anthropic leaves the reset out now and then.
  if (exact && exact.resetsAt != null && exact.resetsAt > now && exact.pct > 0) {
    if (!current) windows.push((current = { cost: exact.spend?.cost || 0, hitAt: null, start: 0, end: 0 }));
    current.end = exact.resetsAt;
    current.start = exact.resetsAt - 5 * HOUR;
  }
  if (current) current.current = true;
  const pctOfCap = (w: Win) =>
    w.hitAt ? 100 : w.current && exact ? exact.pct : cap ? Math.min(100, Math.round((w.cost / cap) * 100)) : null;
  for (const w of windows) w.pct = pctOfCap(w);
  // If you keep working until your usual stop (on your working day), the next windows follow on from this one.
  const usualStop = hours?.typicalStop != null ? workDay(now) + hours.typicalStop : null;
  if (current && usualStop != null) {
    for (let start = current.end, i = 0; start < usualStop && i < 3; start += 5 * HOUR, i++)
      windows.push({ start, end: start + 5 * HOUR, projected: true, cost: 0, hitAt: null });
  }
  const blocksFor = (w: Win): CalendarBlock[] => {
    if (w.projected)
      return [
        {
          from: w.start,
          to: w.end,
          color: 'var(--claude)',
          opacity: 0.18,
          gap: true,
          tip: `If you keep working, a fresh window starts around ${clock(w.start)}`,
        },
      ];
    const tip = `${weekday(w.start)} ${clock(w.start)} → ${clock(w.end)} · ≈ ${money(w.cost)}${w.pct != null ? ` · about ${w.pct}% full` : ''}${w.hitAt ? ` · limit hit at ${clock(w.hitAt)}, ${duration(w.end - w.hitAt)} out` : ''}${w.current ? ' · running now' : ''}`;
    const mix = w.pct != null ? Math.round(14 + w.pct * 0.76) : 30;
    const list: CalendarBlock[] = [
      {
        from: w.start,
        to: w.end,
        gap: true,
        tip,
        color: `color-mix(in srgb, var(--claude) ${mix}%, var(--sunken))`,
        text: w.pct != null ? `${w.pct}%` : money(w.cost),
        dark: mix >= 55,
      },
    ];
    if (w.hitAt)
      list.push({
        from: w.hitAt,
        to: w.end,
        gap: true,
        tip,
        color: 'repeating-linear-gradient(135deg, var(--bad-fill) 0 3px, transparent 3px 7px)',
        text: '',
        dark: false,
      });
    return list;
  };
  const today = calendarDay(now);
  const columns: CalendarColumn[] = Array.from({ length: 7 }, (_, i) => {
    const day = calendarDay(p.since, i);
    const mine = windows.filter((w) => w.end > day && w.start < day + DAY);
    const count = mine.filter((w) => !w.projected && w.start >= day && w.start < day + DAY).length;
    return {
      day,
      label: weekday(day),
      current: day === today,
      tip: `${longDate(day)} · ${count ? plural(count, 'window') : 'no windows'}`,
      blocks: mine.flatMap(blocksFor),
    };
  });
  const real = windows.filter((w) => !w.projected && w.start >= p.since);
  const fullest = real
    .filter((w) => w.pct != null)
    .reduce<Win | null>((best, w) => (!best || w.pct! > best.pct! ? w : best), null);
  return {
    columns,
    cap,
    fullest,
    anyHit: real.some((w) => w.hitAt),
    anyProjected: windows.some((w) => w.projected),
    plan: planText(p, fullest?.pct ?? null),
  };
}

// ── This window, as a line ───────────────────────────────────────────────────

export type WindowChart = {
  start: number;
  end: number;
  now: number;
  points: [number, number][];
  nowValue: number;
  rate: number;
  limited: boolean;
  pctMode: boolean;
  total: number;
  cols: { a: number; b: number; tip: string | null }[];
  marks: string[];
  atReset: number;
  runOut: number | null;
  level: '' | 'warn' | 'crit';
};

/** The axis under a window: its hours, or its days, ending at the reset. */
export function windowMarks(start: number, end: number) {
  const session = end - start <= 6 * HOUR;
  const marks = session
    ? Array.from({ length: Math.round((end - start) / HOUR) + 1 }, (_, i) => clock(start + i * HOUR))
    : Array.from({ length: 8 }, (_, i) => (i === 0 ? `${weekday(start)} ${clock(start)}` : weekday(start + i * DAY)));
  marks[marks.length - 1] = `Resets ${session ? clock(end) : `${weekday(end)} ${clock(end)}`}`;
  return marks;
}

function chartOf({
  start,
  end,
  now,
  points,
  nowValue,
  rate,
  limited,
  pctMode = true,
  total = 0,
  colMs,
  colTip,
}: {
  start: number;
  end: number;
  now: number;
  points: [number, number][];
  nowValue: number;
  rate: number;
  limited: boolean;
  pctMode?: boolean;
  total?: number;
  colMs: number;
  colTip: (a: number, b: number) => string;
}): WindowChart {
  const atReset = nowValue + rate * Math.max(0, end - now);
  const runOut = pctMode && rate > 0 && !limited && atReset > 100 ? now + (100 - nowValue) / rate : null;
  const level = limited || runOut ? (runOut && runOut - now < HOUR ? 'crit' : 'warn') : '';
  const cols: WindowChart['cols'] = [];
  for (let a = start; a < end; a += colMs)
    cols.push({ a, b: Math.min(a + colMs, now), tip: a > now ? null : colTip(a, Math.min(a + colMs, now)) });
  return {
    start,
    end,
    now,
    points,
    nowValue,
    rate,
    limited,
    pctMode,
    total,
    cols,
    marks: windowMarks(start, end),
    atReset,
    runOut,
    level,
  };
}

/** What a window's chart says under it: the limit hit, running out, or where it ends. */
export function windowTip(
  c: WindowChart,
  basis: string,
  name: string,
): { text: string; tone: 'bad' | 'trend' | 'quiet' } {
  if (c.limited) return { text: `You've hit the ${name} limit. It resets ${whenText(c.end)}.`, tone: 'bad' };
  if (c.runOut && c.runOut < c.end)
    return {
      text: `At your pace ${basis}, you'd reach the limit around ${whenText(c.runOut)}, ${duration(c.end - c.runOut)} before it resets.`,
      tone: 'bad',
    };
  if (c.rate > 0)
    return {
      text: `At your pace ${basis}, you'd end this window at about ${Math.round(Math.min(100, c.atReset))}%.`,
      tone: 'trend',
    };
  return { text: `Quiet ${basis}, so this window would stay around ${pctText(c.nowValue)}%.`, tone: 'quiet' };
}

/** The figures beside a window's chart: used, where it's heading, and the pace. */
export function windowStats(c: WindowChart, used: string, per: number, perLabel: string) {
  const out = c.runOut && c.runOut < c.end;
  return {
    used,
    headLabel: out ? 'Runs out' : 'By the reset',
    head: c.limited
      ? 'Limit hit'
      : out
        ? clock(c.runOut!)
        : c.pctMode
          ? `~${Math.round(Math.min(100, c.atReset))}%`
          : `≈ ${money(c.atReset)}`,
    pace: c.rate > 0 ? (c.pctMode ? `${pctText(c.rate * per)}%` : money(c.rate * per)) : '—',
    perLabel,
  };
}

export type ChartResult =
  | { empty: string; sub?: string }
  | {
      chart: WindowChart;
      sub: string;
      stats: ReturnType<typeof windowStats>;
      tip: { text: string; tone: 'bad' | 'trend' | 'quiet' | 'info' };
      note?: string;
    };

const subOf = (start: number, end: number, now: number, short: boolean) =>
  short
    ? `${clock(start)} to ${clock(end)} · resets in ${duration(end - now)}`
    : `${dayLabel(start)}, ${clock(start)} to ${dayLabel(end)}, ${clock(end)} · resets in ${duration(end - now)}`;

/**
 * The current session or weekly window as a line: how much of the limit it used
 * over time, and where it's heading at your recent pace. The shape comes from
 * Claude Code on this Mac and ends at the limit card's %, so it matches it.
 */
export function claudeWindow(inp: LimitsInput, kind: 'session' | 'weekly'): ChartResult | null {
  const session = kind === 'session';
  const length = session ? 5 * HOUR : 7 * DAY;
  const info = limitInfo(inp, kind);
  const usage = inp.limits?.usage;
  if (!info || !usage) return null;
  if ('idle' in info)
    return {
      empty: 'A 5-hour window starts with your next message, and this shows it filling up.',
      sub: 'No window running',
    };
  if ('missing' in info || !info.resetsAt)
    return {
      empty:
        kind === 'weekly'
          ? "The weekly window's reset time isn't known yet. Turn on Exact from Anthropic, or hit the weekly limit once."
          : 'No figure for this window.',
    };
  if (info.stale)
    return {
      empty: 'The last exact reading is old. Refresh to see the current window and its forecast.',
      sub: 'Reading needs refresh',
    };
  const now = inp.now;
  const end = info.resetsAt;
  const start = end - length;
  const series = session ? usage.fine : usage.hourly;
  // Local spend in each step of the window, and the running total.
  const steps: { a: number; b: number; cost: number; cum: number }[] = [];
  let total = 0;
  series.costs.forEach((cost, i) => {
    const a = series.from + i * series.step;
    const b = a + series.step;
    if (b <= start || a > now) return;
    total += cost;
    steps.push({ a: Math.max(a, start), b: Math.min(b, now), cost, cum: total });
  });
  const pctMode = info.pct != null;
  const pctNow = pctMode ? Math.max(0, Math.min(100, info.limited ? 100 : info.pct!)) : null;
  const valueAt = (cum: number) => (pctMode ? (total > 0 ? (cum / total) * pctNow! : 0) : cum);
  const nowValue = pctMode ? pctNow! : total;
  // Where it's heading: your pace over the last 30 minutes (session) or 7 days (weekly).
  const rates: Partial<NonNullable<LimitsInput['limits']>['rates']> = inp.limits?.rates || {};
  const costRate = session ? (rates.cost30m || 0) / (30 * MINUTE) : (rates.cost7d || 0) / (7 * DAY);
  // The limit's size in dollars is the one the limit card's forecast goes by, so they agree.
  const cap = pctMode ? info.size : null;
  const rate = pctMode ? (cap ? (costRate / cap) * 100 : 0) : costRate;
  const points: [number, number][] = [[start, 0], ...steps.map((st) => [st.b, valueAt(st.cum)] as [number, number])];
  if (pctMode && total === 0 && pctNow! > 0) points.push([now, pctNow!]); // used elsewhere, like claude.ai
  const colMs = session ? 5 * MINUTE : 6 * HOUR;
  const colTip = (a: number, b: number) => {
    const inCol = steps.filter((st) => st.a >= a && st.a < a + colMs);
    const cost = inCol.reduce((n, st) => n + st.cost, 0);
    const cum = inCol.length ? inCol[inCol.length - 1].cum : steps.filter((st) => st.a < a).pop()?.cum || 0;
    const range = session ? `${clock(a)}–${clock(b)}` : `${weekday(a)} ${clock(a)}–${clock(b)}`;
    return `${range} · ≈ ${money(cost)}\n${pctMode ? `${pctText(valueAt(cum))}% used by then` : `≈ ${money(cum)} so far`}`;
  };
  const basis = session ? 'over the last 30 minutes' : 'over the last 7 days';
  const chart = chartOf({
    start,
    end,
    now,
    points,
    nowValue,
    rate,
    limited: info.limited,
    pctMode,
    total,
    colMs,
    colTip,
  });
  return {
    chart,
    sub: subOf(start, end, now, session),
    stats: windowStats(
      chart,
      pctMode ? `${pctNow}%` : `≈ ${money(total)}`,
      session ? HOUR : DAY,
      session ? 'h' : 'day',
    ),
    tip: pctMode
      ? windowTip(chart, basis, kind)
      : {
          text: "There's no % for this window yet, so this is what it has cost at API prices. Turn on Exact from Anthropic, or hit the limit once, to see it against your limit.",
          tone: 'info',
        },
  };
}

/** Codex's windows that have a chart: its own bucket, with a length and a reset. */
export const codexChartWindows = (inp: LimitsInput) =>
  (codexQuota(inp)?.windows || []).filter((w) => w.durationMs && w.resetsAt && (w.bucketId === 'codex' || !w.bucketId));

/**
 * Codex's current window as a line, from the readings it wrote here each time
 * you used it, and where it's heading at that pace. The same chart as Claude's.
 */
export function codexWindow(inp: LimitsInput, w: CodexWindow | undefined): ChartResult {
  if (!w) return { empty: "Codex hasn't reported a plan window on this Mac yet." };
  const now = inp.now;
  const q = codexQuota(inp);
  if (quotaFreshness({ source: q?.source, observedAt: q?.observedAt, stale: q?.stale }, now).stale)
    return {
      empty: 'The last Codex reading is old. Use Codex or refresh to see the current window and its forecast.',
      sub: 'Reading needs refresh',
    };
  const end = w.resetsAt!;
  const start = end - w.durationMs!;
  if (end <= now)
    return {
      empty: `This window reset ${whenText(end)}, and Codex hasn't reported since. It will once you use it again.`,
    };
  const pace = codexPace(inp, w);
  const readings = (pace?.history || []).filter(([t]) => t >= start && t <= now);
  const used = Math.max(0, Math.min(100, w.usedPercent ?? readings[readings.length - 1]?.[1] ?? 0));
  const limited = used >= 100;
  // Codex only reports as you use it, so the line holds its last reading until now.
  const points: [number, number][] = [[start, 0], ...readings, [now, used]];
  const usedBy = (t: number) => readings.reduce((v, [rt, u]) => (rt <= t ? u : v), 0);
  const short = w.durationMs! <= 6 * HOUR;
  const colMs = short ? 5 * MINUTE : 6 * HOUR;
  const colTip = (a: number, b: number) =>
    `${short ? `${clock(a)}–${clock(b)}` : `${weekday(a)} ${clock(a)}–${clock(b)}`}\n${pctText(usedBy(b))}% used by then`;
  const rate = pace?.rate || 0;
  const basis = pace?.basis || 'lately';
  const name = `Codex ${windowName(w.durationMs, w.kind).toLowerCase()}`;
  const chart = chartOf({ start, end, now, points, nowValue: used, rate, limited, colMs, colTip });
  return {
    chart,
    sub: subOf(start, end, now, short),
    stats: windowStats(chart, `${pctText(used)}%`, short ? HOUR : DAY, short ? 'h' : 'day'),
    tip: windowTip(chart, basis, name),
    note: readings.length
      ? undefined
      : 'No readings from this window on this Mac yet, so the line starts when you next use Codex here.',
  };
}
