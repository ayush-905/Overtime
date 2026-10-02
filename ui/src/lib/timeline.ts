// Today as a timeline: a lane for each
// session that did something today (when its agent worked, its subagents, the
// messages you sent, the stretches it waited for you), brought up to now by
// what the live agents are doing; your own active time; your usual day as
// shading; and one line saying what stands out. The view runs from the hour
// the first thing happened (or you usually start) to now.

import { clock, duration, HOUR, plural, workdayHour, clip } from './format';
import { titleFor } from './labels';
import { WORKING, sinceFor, type LiveAgent } from './agents';

const SLOT_MS = 15 * 60_000;

type Span = [number, number];

export type Lane = {
  id: string;
  source: 'claude' | 'codex';
  title: string;
  project: string | null;
  work: Span[];
  sub: Span[];
  waits: Span[];
  messages: number[];
  cost: number;
  tokens: number;
  partial: boolean;
  first: number;
  busyMs?: number;
};

export type TimelineData = {
  from: number;
  you?: Span[];
  usual?: { days: number; slots: number[] } | null;
  lanes: Lane[];
  others?: { sessions: number; busyMs: number; cost: number; tokens?: number };
};

/** Merge [from, to] stretches that touch or overlap (within a minute). */
export function merge(list: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const prev = out[out.length - 1];
    if (prev && a <= prev[1] + 60_000) prev[1] = Math.max(prev[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const total = (list: Span[]) => list.reduce((n, [a, b]) => n + b - a, 0);

/** The server's lanes, brought up to now with what the live agents are doing. */
export function lanesNow(tl: TimelineData, agents: LiveAgent[], now: number): (Lane & { busyMs: number })[] {
  const lanes: Lane[] = tl.lanes.map((l) => ({ ...l, work: l.work.map((x) => [...x] as Span), waits: l.waits.map((x) => [...x] as Span) }));
  for (const a of agents) {
    if (a.kind !== 'main') continue;
    const working = WORKING.includes(a.status) && !a.needsYou;
    if (!working && !a.needsYou) continue;
    let lane = lanes.find((l) => l.id === a.id);
    if (!lane) {
      lane = { id: a.id, source: a.source, title: a.title, project: a.project, work: [], sub: [], waits: [], messages: [], cost: 0, tokens: 0, partial: false, first: now };
      lanes.push(lane);
    }
    if (working) {
      const from = Math.max(tl.from, a.turnStartedAt || a.lastActivity || now);
      lane.work = merge([...lane.work, [from, now]]);
    } else {
      // Waiting for you right now: the wait so far, which the server only counts once you reply.
      const since = sinceFor(a);
      if (since && since >= tl.from && now - since >= 60_000) lane.waits.push([since, now]);
    }
    lane.first = Math.min(lane.first ?? now, ...lane.work.map((x) => x[0]), ...lane.waits.map((x) => x[0]));
  }
  for (const l of lanes) l.busyMs = total(merge([...l.work, ...l.sub]));
  return (lanes as (Lane & { busyMs: number })[]).sort((a, b) => a.first - b.first);
}

/** The most sessions working at once today, and when. */
export function peak(lanes: Lane[]) {
  const edges = lanes.flatMap((l) => merge([...l.work, ...l.sub]).flatMap(([a, b]) => [[a, 1], [b, -1]] as [number, number][])).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let at = 0;
  let best: { count: number; t: number | null } = { count: 0, t: null };
  for (const [t, step] of edges) {
    at += step;
    if (at > best.count) best = { count: at, t };
  }
  return best;
}

export type Shade = { from: number; to: number; level: number; days: number };

/** Everything the timeline card draws, worked out once. Null when nothing happened today. */
export function timelineModel(tl: TimelineData, agents: LiveAgent[], now: number) {
  const lanes = lanesNow(tl, agents, now);
  if (!lanes.length) return null;
  const you = tl.you || [];
  // Your usual day, once there are a few days to go on: when you're active on at least a third of them.
  // Starts count from the hour your day starts, so a late night past midnight isn't an early start.
  const dayFrom = workdayHour() * 4;
  const usual = tl.usual && tl.usual.days >= 3 ? tl.usual : null;
  const usualFrom = usual ? usual.slots.findIndex((v, k) => k >= dayFrom && v >= 0.34) : -1;
  const usualStart = usualFrom >= 0 ? tl.from + usualFrom * SLOT_MS : null;
  // From the hour the first thing happened (or you usually start) to now, at least two hours wide.
  const first = Math.min(...lanes.map((l) => l.first), ...you.map((x) => x[0]), usualStart != null && usualStart < now ? usualStart : Infinity);
  const start = Math.floor(first / HOUR) * HOUR;
  const end = Math.max(now + (now - start) * 0.02, start + 2 * HOUR);
  const span = end - start;
  /** Where a moment falls, in % across. */
  const x = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / span) * 100;
  /** How wide a stretch is, in %, never too thin to see. */
  const w = (a: number, b: number) => Math.max(0.35, ((Math.min(b, end) - Math.max(a, start)) / span) * 100);
  const hours = Math.ceil(span / HOUR);
  const every = hours <= 6 ? 1 : hours <= 12 ? 2 : 3;
  const ticks: { t: number; hour: number; labelled: boolean }[] = [];
  for (let t = start; t <= end; t += HOUR) {
    const h = new Date(t).getHours();
    ticks.push({ t, hour: h, labelled: h % every === 0 });
  }
  const shade: Shade[] = [];
  if (usual) {
    const level = (v: number) => (v >= 0.67 ? 3 : v >= 0.34 ? 2 : v >= 0.12 ? 1 : 0);
    usual.slots.forEach((v, k) => {
      const a = tl.from + k * SLOT_MS;
      if (!level(v) || a + SLOT_MS <= start || a >= end) return;
      const last = shade[shade.length - 1];
      if (last && last.level === level(v) && last.to === a) {
        last.to = a + SLOT_MS;
        last.days = Math.max(last.days, Math.round(v * usual.days));
      } else shade.push({ from: a, to: a + SLOT_MS, level: level(v), days: Math.round(v * usual.days) });
    });
  }
  const activeMs = total(you);
  const busy = total(merge(lanes.flatMap((l) => [...l.work, ...l.sub])));
  const waited = lanes.reduce((n, l) => n + total(l.waits), 0);
  const p = peak(lanes);
  const startedAt = you.find(([a]) => a >= tl.from + dayFrom * SLOT_MS)?.[0];
  const late = startedAt != null && usualStart != null ? startedAt - usualStart : 0;
  let tip = '';
  let tipKind: 'clock' | 'bulb' = 'bulb';
  if (Math.abs(late) >= 2 * HOUR && startedAt! < now) {
    tip = `You started ${duration(Math.abs(late))} ${late > 0 ? 'later' : 'earlier'} than usual today (you usually start around ${clock(usualStart!)}).`;
  } else if (waited >= 20 * 60_000) {
    const most = [...lanes].sort((a, b) => total(b.waits) - total(a.waits))[0];
    tip = `Agents waited ${duration(waited)} for you today, ${duration(total(most.waits))} of it on “${clip(titleFor(most.id, most.title), 40)}”.`;
    tipKind = 'clock';
  } else if (p.count >= 3) {
    tip = `You had ${p.count} sessions working at once around ${clock(p.t!)}.`;
  } else if (busy > activeMs + HOUR) {
    tip = `Your agents worked ${duration(busy - activeMs)} more than you were active today.`;
  }
  const summary = `Today · ${plural(lanes.length, 'session')} · agents worked ${duration(busy)}${waited ? ` · waited ${duration(waited)} for you` : ''}`;
  /** "12:02–now", "12:02–13:40". */
  const spanText = (a: number, b: number) => `${clock(a)}–${b >= now - 30_000 ? 'now' : clock(b)}`;
  return { lanes, you, usual, usualStart, shade, start, end, x, w, ticks, activeMs, busy, waited, peak: p, tip, tipKind, summary, spanText, others: tl.others };
}
