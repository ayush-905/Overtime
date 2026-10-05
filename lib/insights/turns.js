// Stretches of work and your messages: when each agent was working (from a
// message to its last reply), how many worked at once, each message with what it
// set off (how long, what it cost, how long the agent had waited for you), and
// the 7-day summaries of your messages and of the waits.
// @ts-check
/** @import { MessageStats, MessageSummary, ParallelWork, WaitingStats } from '../../types/api.js' */

import { PRESENT_MS } from '../agents.js';
import { MINUTE, dayStart } from './time.js';
import { median, sessionTitle } from './common.js';

const IDLE_SPLIT_MS = 10 * 60_000; // a longer silence mid-turn counts as a break

/**
 * Stretches of work for every agent: from a message you sent (or a subagent's
 * task) until the agent's last reply before the next one.
 */
export function workSpans(index, since) {
  const byRec = new Map();
  const push = (rec, item) => {
    let list = byRec.get(rec);
    if (!list) byRec.set(rec, (list = []));
    list.push(item);
  };
  for (const e of index.events()) if (e[0] >= since && !e[4].work?.length) push(e[4], [e[0], false]);
  for (const [t, rec] of index.prompts()) if (t >= since && !rec.work?.length) push(rec, [t, true]);
  const spans = (index.work?.() || [])
    .filter((w) => w.end >= since && w.end > w.start)
    .map((w) => ({ ...w, start: Math.max(since, w.start) }));
  for (const [rec, items] of byRec) {
    items.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let start = null;
    let last = null;
    const close = () => {
      if (start != null && last != null) spans.push({ start, end: Math.max(last, start + 10_000), sub: rec.sub, rec });
      start = null;
      last = null;
    };
    for (const [t, prompt] of items) {
      if (prompt) {
        close();
        start = t;
        continue;
      }
      if (start == null || t - (last ?? start) > IDLE_SPLIT_MS) {
        close();
        start = t;
      }
      last = t;
    }
    close();
  }
  return spans;
}

/** How many agents worked at the same time: the peak, today hour by hour, and agent-hours vs your hours. @returns {ParallelWork} */
export function parallelWork(index, now) {
  const since = dayStart(now, 6);
  const today0 = dayStart(now);
  const points = [];
  for (const s of workSpans(index, since)) {
    points.push([s.start, 1, s.sub]);
    points.push([Math.min(s.end, now), -1, s.sub]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hours = Array.from({ length: 24 }, () => ({ max: 0, agentMs: 0 }));
  const peak = { count: 0, main: 0, sub: 0, at: null };
  const peakToday = { count: 0, main: 0, sub: 0, at: null };
  let main = 0;
  let sub = 0;
  let prev = null;
  let agentMs = 0;
  let busyMs = 0;
  let agentMsToday = 0;
  let busyMsToday = 0;
  for (const [t, step, isSub] of points) {
    const n = main + sub;
    if (prev != null && t > prev && n > 0) {
      agentMs += n * (t - prev);
      busyMs += t - prev;
      if (n > peak.count) Object.assign(peak, { count: n, main, sub, at: prev });
      if (t > today0) {
        const from = Math.max(prev, today0);
        if (n > peakToday.count) Object.assign(peakToday, { count: n, main, sub, at: from });
        busyMsToday += t - from;
        // Spread this stretch over the hours it covers.
        for (let a = from; a < t; ) {
          const b = Math.min(t, new Date(a).setMinutes(60, 0, 0));
          const h = hours[new Date(a).getHours()];
          h.max = Math.max(h.max, n);
          h.agentMs += n * (b - a);
          agentMsToday += n * (b - a);
          a = b;
        }
      }
    }
    if (isSub) sub += step;
    else main += step;
    prev = t;
  }
  return { peak, peakToday, agentMs, busyMs, agentMsToday, busyMsToday, hours };
}

const TURN_GAP_MS = 30 * 60_000; // a longer silence ends a turn even without a new message
const AWAY_MS = 30 * MINUTE; // a longer wait for your reply counts as time away, not the agent waiting
/** @type {[number, string][]} */
const DURATION_BUCKETS = [
  [60_000, 'Under 1 min'],
  [5 * 60_000, '1–5 min'],
  [15 * 60_000, '5–15 min'],
  [60 * 60_000, '15–60 min'],
  [Infinity, 'Over 1 hour'],
];

/**
 * A session's messages with what each set off: its cost, subagents included,
 * when the agent's last reply to it came, and for yours, how long the agent had
 * been waiting for you (`waitMs`, from its last reply before; `away` when that
 * was long enough that you'd stepped away). `prompts` are the main transcript's
 * [t, rec, kind, text] and `events` every usage event of the session
 * (subagents' too), both in time order.
 */
export function settleTurns(prompts, events) {
  const list = prompts.map(([t, rec, kind, text]) => ({ t, kind, text, rec, cost: 0, end: t, unpriced: false }));
  let i = 0;
  for (const [t, c, , , rec, d] of events) {
    while (i + 1 < list.length && list[i + 1].t <= t) i++;
    const turn = list[i];
    if (!turn || turn.t > t) continue;
    turn.cost += c;
    turn.unpriced ||= d?.costKnown === false;
    if (!rec.sub && t - turn.end <= TURN_GAP_MS) turn.end = t;
  }
  // Codex also records when each turn ended, which covers quiet stretches with no usage.
  list.forEach((turn, k) => {
    const work = turn.rec.work?.find((w) => w.start <= turn.t && w.end >= turn.t);
    if (work) turn.end = Math.max(turn.end, Math.min(work.end, list[k + 1]?.t ?? Infinity));
  });
  // A message sent while the agent was still working kept nobody waiting.
  list.forEach((turn, k) => {
    if (!k || turn.kind !== 'human') return;
    turn.waitMs = Math.max(0, turn.t - list[k - 1].end);
    turn.away = turn.waitMs > AWAY_MS;
  });
  return list;
}

/** The waits that count: your replies to an agent that was done, not coming back from a break. */
export const waited = (x) => x.kind === 'human' && x.waitMs != null && !x.away;

/**
 * Every message in a main session since `since` (yours, interruptions and
 * background notices), settled as above.
 */
export function turns(index, since) {
  const sessions = new Map();
  for (const p of index.prompts()) {
    const [t, rec] = p;
    if (rec.sub || t < since) continue;
    let s = sessions.get(rec.session);
    if (!s) sessions.set(rec.session, (s = { prompts: [], events: [] }));
    s.prompts.push(p);
  }
  for (const e of index.events()) if (e[0] >= since) sessions.get(e[4].session)?.events.push(e);
  return [...sessions.values()].flatMap((s) => settleTurns(s.prompts, s.events));
}

/**
 * The messages you sent in the last 7 days: how many, how often you
 * interrupted, and for each one how long the agent worked and what that cost,
 * including any subagents it started.
 * @returns {MessageStats}
 */
export function messageStats(index, agents, now, all = turns(index, dayStart(now, 6))) {
  const today0 = dayStart(now);
  const mine = all.filter((x) => x.kind === 'human');
  const interrupts = all.filter((x) => x.kind === 'interrupt');
  const days = new Set(mine.map((x) => new Date(x.t).toDateString()));
  const durations = mine.map((x) => x.end - x.t).sort((a, b) => a - b);
  const describe = (x) =>
    x &&
    /** @satisfies {MessageSummary} */ ({
      text: x.text,
      t: x.t,
      cost: x.cost,
      partial: x.unpriced,
      source: x.rec.source,
      ms: x.end - x.t,
      project: index.projectOf(x.rec),
      session: x.rec.session,
      inOffice: !!agents.get(x.rec.session) && now - agents.get(x.rec.session).lastActivity < PRESENT_MS,
    });
  const pick = (score) => mine.reduce((best, x) => (!best || score(x) > score(best) ? x : best), null);
  const priciest = [...mine].sort((a, b) => b.cost - a.cost).slice(0, 3);
  return {
    count: mine.length,
    today: mine.filter((x) => x.t >= today0).length,
    activeDays: days.size,
    interrupts: interrupts.length,
    cost: mine.reduce((n, x) => n + x.cost, 0),
    partial: mine.some((x) => x.unpriced),
    medianMs: durations.length ? durations[Math.floor(durations.length / 2)] : null,
    buckets: DURATION_BUCKETS.map(([max, label], i) => ({
      label,
      count: durations.filter((ms) => ms < max && ms >= (i ? DURATION_BUCKETS[i - 1][0] : 0)).length,
    })),
    priciest: describe(pick((x) => x.cost)),
    longest: describe(pick((x) => x.end - x.t)),
    top: priciest.map(describe),
  };
}

/**
 * How long your agents sat waiting for you over the last 7 days: from an agent's
 * last reply to your next message, leaving out waits over 30 minutes (you'd
 * stepped away). Per day, by project, and the longest waits.
 * @returns {WaitingStats}
 */
export function waitingStats(index, agents, now, all) {
  const days = Array.from({ length: 7 }, (_, i) => ({ start: dayStart(now, 6 - i), ms: 0, replies: 0 }));
  /** @type {Map<string, WaitingStats['projects'][number]>} */
  const projects = new Map();
  const list = all.filter(waited);
  for (const x of list) {
    let i = days.length - 1;
    while (i > 0 && x.t < days[i].start) i--;
    days[i].ms += x.waitMs;
    days[i].replies++;
    const name = index.projectOf(x.rec);
    const p = projects.get(name) || { name, ms: 0, replies: 0 };
    p.ms += x.waitMs;
    p.replies++;
    projects.set(name, p);
  }
  const ms = list.reduce((n, x) => n + x.waitMs, 0);
  const longest = [...list]
    .sort((a, b) => b.waitMs - a.waitMs)
    .slice(0, 5)
    .map((x) => ({
      session: x.rec.session,
      source: x.rec.source,
      title: sessionTitle(index, agents, x.rec.session),
      project: index.projectOf(x.rec),
      t: x.t,
      ms: x.waitMs,
    }));
  return {
    ms,
    replies: list.length,
    medianMs: median(list.map((x) => x.waitMs)),
    away: all.filter((x) => x.kind === 'human' && x.away).length,
    today: days[days.length - 1],
    days,
    projects: [...projects.values()].sort((a, b) => b.ms - a.ms).slice(0, 4),
    longest,
  };
}
