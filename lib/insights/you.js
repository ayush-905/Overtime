// Your time and your agents': your active time from the messages you typed, your
// working hours, when your agents worked, how you use the 5-hour session windows,
// today as a timeline of sessions, and a summary of each of the last 30 days.
// @ts-check
/** @import { AgentCalendarDay, AgentHours, AgentIdleDay, AgentWorkDay, DailyTotal, SessionPlan, SessionWindow, Span, TimelineLane, TodayTimeline, WindowsAdvice, WorkingHours, YouDayOff, YouWorkDay } from '../../types/api.js' */
/** @typedef {{ byDay: Map<number, YouWorkDay>, times: number[], stretches: Span[] }} YourTime */

import { sessionWindows } from '../limits.js';
import { DAY, HOUR, MINUTE, clip, dayStart, totalMs, uncovered, union, workDay } from './time.js';
import { median, sessionTitle } from './common.js';
import { turns, waited, workSpans } from './turns.js';

const STRETCH_GAP_MS = 30 * MINUTE; // a shorter break doesn't split a stretch of work

/**
 * Your own time, from the messages you typed: each message counts from when you
 * sent it until the agent's reply to it ended, and breaks under 30 minutes are
 * bridged. Grouped by working day (4am to 4am), with every message time and every
 * stretch kept for the cards that split days at midnight.
 * @returns {YourTime}
 */
export function yourTime(index, now) {
  /** @type {Map<number, YouWorkDay & { spans?: any }>} */
  const byDay = new Map();
  const times = [];
  for (const x of turns(index, workDay(now, 30))) {
    if (x.kind !== 'human') continue;
    times.push(x.t);
    const start = workDay(x.t);
    let d = byDay.get(start);
    if (!d)
      byDay.set(
        start,
        (d = /** @type {YouWorkDay & { spans?: any }} */ ({ start, first: x.t, last: x.t, messages: 0, spans: [] })),
      );
    d.first = Math.min(d.first, x.t);
    d.last = Math.max(d.last, x.t);
    d.messages++;
    d.spans.push([x.t, Math.max(x.t + 2 * MINUTE, x.end)]);
  }
  for (const d of byDay.values()) {
    d.stretches = union(d.spans, STRETCH_GAP_MS).map(([a, b]) => /** @type {Span} */ ([a, Math.min(b, now)]));
    d.activeMs = totalMs(d.stretches);
    d.late = d.last >= new Date(d.start).setHours(24, 0, 0, 0);
    delete d.spans;
  }
  return {
    byDay,
    times: times.sort((a, b) => a - b),
    stretches: union([...byDay.values()].flatMap((d) => d.stretches)),
  };
}

/**
 * When you started and stopped each working day (first and last message you
 * typed), when you were active, late nights, and your streak of days in a row,
 * all on the 4am day so a late night stays with the day it started. Times of day
 * are ms after the day's 4am. `dates` has your active time per calendar day
 * (midnight to midnight) for the bar chart.
 * @param {YourTime} mine
 * @returns {WorkingHours}
 */
export function workingHours(now, mine) {
  const { byDay } = mine;
  const today = workDay(now);
  const days = Array.from(
    { length: 14 },
    (_, i) =>
      byDay.get(workDay(now, 13 - i)) || /** @type {YouDayOff} */ ({ start: workDay(now, 13 - i), messages: 0 }),
  );
  const worked = /** @type {YouWorkDay[]} */ (days.filter((d) => d.messages));
  const done = worked.filter((d) => d.start < today);
  // A streak survives until today is over, so it counts back from yesterday until you start.
  let streak = 0;
  for (let i = byDay.has(today) ? 0 : 1; i <= 30 && byDay.has(workDay(now, i)); i++) streak++;
  let longestStreak = 0;
  for (let i = 30, run = 0; i >= 0; i--) {
    run = byDay.has(workDay(now, i)) ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  const lastLate = [...worked].reverse().find((d) => d.late);
  const dates = Array.from({ length: 30 }, (_, i) => {
    const start = dayStart(now, 29 - i);
    const end = i === 29 ? now + 1 : dayStart(now, 28 - i);
    const sent = mine.times.filter((t) => t >= start && t < end);
    return {
      start,
      activeMs: totalMs(clip(mine.stretches, start, end)),
      messages: sent.length,
      first: sent[0] ?? null,
      last: sent[sent.length - 1] ?? null,
    };
  });
  const activeSince = (from, to) =>
    dates.filter((d) => d.start >= from && d.start < to).reduce((n, d) => n + d.activeMs, 0);
  return {
    days,
    dates,
    typicalStart: median(worked.map((d) => d.first - d.start)),
    typicalStop: median(done.map((d) => d.last - d.start)),
    typicalLength: median(done.map((d) => d.last - d.first)),
    completedDays: done.length,
    lateNights: worked.filter((d) => d.late).length,
    lastLate: lastLate?.start ?? null,
    daysOff: days.filter((d) => d.start < today && !d.messages).length,
    streak,
    longestStreak,
    week: activeSince(dayStart(now, 6), Infinity),
    prevWeek: activeSince(dayStart(now, 13), dayStart(now, 6)),
  };
}

const AGENT_DRAW_GAP_MS = 10 * MINUTE; // closer stretches of agent work are drawn as one

/**
 * When your agents worked, whatever set them off: your messages, subagents
 * handing back, background tasks. For each day: the wall-clock time at least one
 * agent was working, agent time added up across agents (so overlaps count once per
 * agent), the most at once, and how much came while you weren't active. `days` are
 * 4am working days for the calendar; `dates` are midnight-to-midnight days for the
 * bar charts, and the weekly totals use them too.
 * @param {YourTime} mine
 * @returns {AgentHours}
 */
export function agentHours(index, now, mine) {
  const spans = workSpans(index, Math.min(workDay(now, 13), dayStart(now, 29)));
  const you = union(mine.stretches);
  /** @type {(start: number, end: number) => (AgentIdleDay | AgentWorkDay) & { busy?: Span[] }} */
  const stats = (start, end) => {
    const parts = [];
    const sessions = new Set();
    const subagents = new Set();
    for (const s of spans) {
      const a = Math.max(s.start, start);
      const b = Math.min(s.end, end);
      if (b <= a) continue;
      parts.push([a, b]);
      sessions.add(s.rec.session);
      if (s.sub) subagents.add(s.rec.file);
    }
    if (!parts.length) return { start, wallMs: 0, agentMs: 0 };
    const busy = union(parts);
    // The most at once: +1 at each start, -1 at each end.
    const edges = parts
      .flatMap(([a, b]) => [
        [a, 1],
        [b, -1],
      ])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let at = 0;
    let peak = 0;
    for (const [, step] of edges) peak = Math.max(peak, (at += step));
    return {
      start,
      first: busy[0][0],
      last: busy[busy.length - 1][1],
      wallMs: totalMs(busy),
      agentMs: totalMs(parts),
      peak,
      sessions: sessions.size,
      subagents: subagents.size,
      unattendedMs: uncovered(busy, you),
      busy,
    };
  };
  const today = workDay(now);
  /** @type {AgentHours['longest']} */
  let longest = null;
  const days = Array.from({ length: 14 }, (_, i) => {
    // Typed as a day with work: the line after returns a day without as it is.
    const d = /** @type {AgentWorkDay & { busy?: any, stretches?: Span[], late?: boolean }} */ (
      stats(workDay(now, 13 - i), i === 13 ? now : workDay(now, 12 - i))
    );
    if (!d.wallMs) return /** @type {AgentIdleDay} */ (/** @type {unknown} */ (d));
    d.stretches = union(d.busy, AGENT_DRAW_GAP_MS);
    d.late = d.last > new Date(d.start).setHours(24, 0, 0, 0);
    for (const [a, b] of d.stretches) if (!longest || b - a > longest.ms) longest = { ms: b - a, from: a, to: b };
    delete d.busy;
    return /** @type {AgentCalendarDay} */ (d);
  });
  const dates = Array.from({ length: 30 }, (_, i) => {
    const d = stats(dayStart(now, 29 - i), i === 29 ? now : dayStart(now, 28 - i));
    delete d.busy;
    return d;
  });
  const worked = /** @type {AgentCalendarDay[]} */ (days.filter((d) => d.wallMs));
  const done = worked.filter((d) => d.start < today);
  const sum = (from, to, key) =>
    dates.filter((d) => d.start >= from && d.start < to).reduce((n, d) => n + (d[key] || 0), 0);
  const week = dayStart(now, 6);
  const before = dayStart(now, 13);
  return {
    days,
    dates,
    typicalStart: median(worked.map((d) => d.first - d.start)),
    typicalStop: median(done.map((d) => d.last - d.start)),
    week: sum(week, Infinity, 'wallMs'),
    prevWeek: sum(before, week, 'wallMs'),
    weekAgentMs: sum(week, Infinity, 'agentMs'),
    prevWeekAgentMs: sum(before, week, 'agentMs'),
    weekUnattendedMs: sum(week, Infinity, 'unattendedMs'),
    lateNights: worked.filter((d) => d.late).length,
    lastLate: [...worked].reverse().find((d) => d.late)?.start ?? null,
    longest,
  };
}

const WINDOW_MS = 5 * HOUR;
const USEFUL_LEAD_MS = HOUR; // a window has to start this long before you stop to be worth having

/**
 * The 5-hour session windows of the last 7 days, what each cost, and a plan:
 * windows start with your first message, so one sent a bit before your usual
 * start can shift the resets and fit one more fresh window into your day.
 * @param {WorkingHours} hours
 * @returns {SessionPlan}
 */
export function sessionPlan(index, now, hours) {
  // Windows are grouped by calendar day; the plan uses your usual (4am) working day.
  const since = dayStart(now, 6);
  const windows = sessionWindows(index.events(), index.hits(), { from: since, now }).map(
    ({ start, end, cost, hitAt }) => ({ start, end, cost, hitAt }),
  );
  const started = windows.filter((w) => w.start >= since);
  /** @type {Map<number, number>} */
  const perDay = new Map();
  for (const w of started) perDay.set(dayStart(w.start), (perDay.get(dayStart(w.start)) || 0) + 1);
  const hit = /** @type {(SessionWindow & { hitAt: number })[]} */ (windows.filter((w) => w.hitAt));
  /** @type {WindowsAdvice | null} */
  let plan = null;
  const { typicalStart: start, typicalStop: stop } = hours;
  if (start != null && stop != null && hours.completedDays >= 3 && stop - start >= 2 * HOUR) {
    // Fresh windows that start at least an hour before you usually stop…
    const useful = Math.floor((stop - start - USEFUL_LEAD_MS) / WINDOW_MS) + 1;
    // …and the latest first message that fits one more, on a 10-minute mark.
    const by = Math.floor((stop - USEFUL_LEAD_MS - useful * WINDOW_MS) / (10 * MINUTE)) * 10 * MINUTE;
    plan = {
      start,
      stop,
      useful,
      by,
      lead: start - by,
      resets: Array.from({ length: useful }, (_, k) => by + (k + 1) * WINDOW_MS),
    };
  }
  return {
    since,
    windows,
    perDay: perDay.size ? started.length / perDay.size : null,
    today: perDay.get(dayStart(now)) || 0,
    hits: hit.length,
    lockedMs: hit.reduce((n, w) => n + Math.max(0, Math.min(w.end, now) - w.hitAt), 0),
    plan,
  };
}

const TIMELINE_LANES = 14;
const SLOT_MS = 15 * MINUTE;

/**
 * Your usual day: for each 15 minutes of the day, how often you were active
 * then, over the last 14 days you worked (today left out). 0 is never, 1 is
 * every one of those days. For shading today's timeline.
 */
/** @param {YourTime} mine */
function usualDay(now, mine) {
  const slots = new Array(96).fill(0);
  let days = 0;
  for (let i = 1; i <= 14; i++) {
    const start = dayStart(now, i);
    const parts = clip(mine.stretches, start, dayStart(now, i - 1));
    if (!parts.length) continue;
    days++;
    for (let k = 0; k < 96; k++) {
      const a = start + k * SLOT_MS;
      if (parts.some(([x, y]) => x < a + SLOT_MS && y > a)) slots[k]++;
    }
  }
  return { days, slots: slots.map((n) => (days ? Math.round((n / days) * 100) / 100 : 0)) };
}

/**
 * Today as lanes, one per session: when its agent worked (and its subagents),
 * when you sent a message, and when it sat done waiting for your reply. `you`
 * is your own active time, for the lane under them. Lanes are in the order the
 * sessions started; the busiest are kept when there are too many.
 * @param {YourTime} mine
 * @returns {TodayTimeline}
 */
export function todayTimeline(index, agents, now, mine) {
  const from = dayStart(now);
  /** @type {Map<string, Omit<TimelineLane, 'busyMs' | 'first' | 'last'>>} */
  const lanes = new Map();
  const lane = (rec) => {
    let l = lanes.get(rec.session);
    if (!l) {
      const main = index.sessionRecord(rec.session);
      lanes.set(
        rec.session,
        (l = {
          id: rec.session,
          source: rec.source,
          title: sessionTitle(index, agents, rec.session, main),
          project: index.projectOf(main || rec),
          work: [],
          sub: [],
          waits: [],
          messages: [],
          cost: 0,
          tokens: 0,
          partial: false,
        }),
      );
    }
    return l;
  };
  for (const s of workSpans(index, from))
    (s.sub ? lane(s.rec).sub : lane(s.rec).work).push([s.start, Math.min(s.end, now)]);
  for (const [t, c, n, , rec, d] of index.events()) {
    if (t < from) continue;
    const l = lane(rec);
    l.cost += c;
    l.tokens += n;
    l.partial ||= d?.costKnown === false;
  }
  for (const x of turns(index, from)) {
    if (x.kind !== 'human') continue;
    const l = lane(x.rec);
    l.messages.push(x.t);
    if (waited(x) && x.waitMs >= MINUTE) l.waits.push([x.t - x.waitMs, x.t]);
  }
  // Only the lanes with something in them, so each has a first moment.
  const list = /** @type {TimelineLane[]} */ (
    [...lanes.values()]
      .map((l) => {
        const work = union(
          l.work.filter(([a, b]) => b > a),
          MINUTE,
        );
        const sub = union(
          l.sub.filter(([a, b]) => b > a),
          MINUTE,
        );
        const all = union([...work, ...sub]);
        const starts = [...all.map((x) => x[0]), ...l.messages];
        return {
          ...l,
          work,
          sub,
          messages: l.messages.sort((a, b) => a - b),
          busyMs: totalMs(all),
          first: starts.length ? Math.min(...starts) : null,
          last: Math.max(...all.map((x) => x[1]), ...l.messages, 0) || null,
        };
      })
      .filter((l) => l.first != null)
  );
  const kept =
    list.length > TIMELINE_LANES
      ? new Set([...list].sort((a, b) => b.busyMs - a.busyMs).slice(0, TIMELINE_LANES))
      : new Set(list);
  const others = list.filter((l) => !kept.has(l));
  return {
    from,
    you: clip(mine.stretches, from, now),
    usual: usualDay(now, mine),
    lanes: list.filter((l) => kept.has(l)).sort((a, b) => a.first - b.first),
    others: {
      sessions: others.length,
      busyMs: others.reduce((n, l) => n + l.busyMs, 0),
      cost: others.reduce((n, l) => n + l.cost, 0),
      tokens: others.reduce((n, l) => n + l.tokens, 0),
    },
  };
}

/**
 * The last 30 calendar days, one summary each, for the activity heatmap: spend,
 * tokens, your active time and messages, how long agents worked (at least one
 * at a time, so overlaps count once) and how many sessions did something.
 * Oldest first. The server keeps these, so the heatmap outlives the transcripts.
 * @param {YourTime} mine
 * @returns {DailyTotal[]}
 */
export function dailyTotals(index, now, mine) {
  const from = dayStart(now, 29);
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: dayStart(now, 29 - i),
    cost: 0,
    tokens: 0,
    partial: false,
    activeMs: 0,
    agentMs: 0,
    messages: 0,
    sessions: 0,
  }));
  const at = (t) => {
    let i = Math.min(29, Math.max(0, Math.floor((t - from) / DAY)));
    // Daylight-saving shifts can nudge a timestamp across the naive boundary.
    while (i < 29 && t >= days[i + 1].day) i++;
    while (i > 0 && t < days[i].day) i--;
    return i;
  };
  const sessions = days.map(() => new Set());
  for (const [t, c, n, , rec, d] of index.events()) {
    if (t < from || t > now) continue;
    const i = at(t);
    days[i].cost += c;
    days[i].tokens += n;
    days[i].partial ||= d?.costKnown === false;
    sessions[i].add(rec.session);
  }
  for (const t of mine.times) if (t >= from && t <= now) days[at(t)].messages++;
  const busy = union(
    workSpans(index, from)
      .map((s) => [s.start, Math.min(s.end, now)])
      .filter(([a, b]) => b > a),
  );
  days.forEach((d, i) => {
    const end = i === 29 ? now : days[i + 1].day;
    d.activeMs = totalMs(clip(mine.stretches, d.day, end));
    d.agentMs = totalMs(clip(busy, d.day, end));
    d.sessions = sessions[i].size;
    d.cost = Math.round(d.cost * 1000) / 1000;
  });
  return days;
}
