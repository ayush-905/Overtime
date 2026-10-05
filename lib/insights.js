// Insights for the dashboard: where the money goes, the 30-day trend, the
// hour-of-day and weekday patterns, what caching saved, how context size drives
// cost, how many agents worked at once, which tool calls failed, the messages
// you sent (how long each kept an agent busy and what it cost), your working
// hours, how long your agents waited for you, how you use the 5-hour session
// windows, the most expensive sessions today, today as a timeline of sessions,
// the skills used and not, the prompts you repeat, a summary of each of the last 30 days, every session
// of the last 30 days and a weekly digest. Costs are at API list prices.

import { PRESENT_MS } from './agents.js';
import { contextWindow, longContextSurcharge } from './pricing.js';
import { modelName } from './models.js';
import { sessionWindows } from './limits.js';
import { skillUsage } from './skills.js';
import { repeatedPrompts } from './prompts.js';
import { turnPerformance } from './turn-performance.js';
import { SOURCES, harness } from './harnesses/index.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
// A working day runs from this hour to the same hour the next day (4am unless you
// choose otherwise), so a late night counts toward the day it started.
let WORKDAY_HOUR = 4;

export function setWorkdayHour(hour) {
  WORKDAY_HOUR = hour;
}

function dayStart(now, daysAgo = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/** The start (4am) of the working day that `t` belongs to, or of the one `daysAgo` before it. */
function workDay(t, daysAgo = 0) {
  const d = new Date(t);
  if (d.getHours() < WORKDAY_HOUR) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(WORKDAY_HOUR, 0, 0, 0);
  return d.getTime();
}

function median(values) {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function topList(map, limit = 5) {
  const sorted = [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const top = sorted.slice(0, limit).map(([name, v]) => ({ name, ...v }));
  const rest = sorted.slice(limit);
  if (rest.length) {
    top.push({
      name: `${rest.length} other${rest.length === 1 ? '' : 's'}`,
      cost: rest.reduce((n, [, v]) => n + v.cost, 0),
      tokens: rest.reduce((n, [, v]) => n + v.tokens, 0),
      other: true,
    });
  }
  return top;
}

function add(map, key, cost, tokens) {
  const v = map.get(key) || { cost: 0, tokens: 0 };
  v.cost += cost;
  v.tokens += tokens;
  map.set(key, v);
}

const TOKEN_TYPES = [
  ['output', 'Output (incl. thinking)', (x) => x.output],
  ['cacheRead', 'Cache reads', (x) => x.read],
  ['cacheWrite', 'Cache writes', (x) => x.write],
  ['input', 'Fresh input', (x) => x.fresh],
  ['search', 'Web searches', () => 0],
];

function breakdown(events, since, projectOf) {
  const types = new Map(TOKEN_TYPES.map(([key, name]) => [key, { name, key, cost: 0, tokens: 0 }]));
  const models = new Map();
  const agents = new Map();
  const projects = new Map();
  let cost = 0;
  let tokens = 0;
  for (const [t, c, n, model, rec, x] of events) {
    if (t < since) continue;
    cost += c;
    tokens += n;
    add(models, modelName(model), c, n);
    add(agents, rec.sub ? 'Subagents' : 'Main agents', c, n);
    add(projects, projectOf(rec), c, n);
    if (!x?.parts) continue;
    for (const [key, , count] of TOKEN_TYPES) {
      const v = types.get(key);
      v.cost += x.parts[key] || 0;
      v.tokens += count(x);
    }
  }
  const byType = [...types.values()].filter((v) => v.cost > 0.005 || v.tokens > 0).sort((a, b) => b.cost - a.cost);
  return {
    cost,
    tokens,
    models: topList(models),
    agents: topList(agents, 2),
    types: byType,
    projects: topList(projects, 6),
  };
}

function trend(events, now) {
  const start = dayStart(now, 29);
  const days = Array.from({ length: 30 }, (_, i) => ({ start: dayStart(now, 29 - i), cost: 0, tokens: 0 }));
  const hours = Array.from({ length: 24 }, () => ({ cost: 0, tokens: 0 }));
  // Spend by day of the week (Sunday first) and hour, for the When you work heatmap.
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const [t, c, n] of events) {
    if (t < start) continue;
    const i = Math.min(29, Math.floor((t - start) / DAY));
    // Daylight-saving shifts can nudge a timestamp across the naive boundary; correct it.
    let idx = i;
    while (idx < 29 && t >= days[idx + 1].start) idx++;
    while (idx > 0 && t < days[idx].start) idx--;
    days[idx].cost += c;
    days[idx].tokens += n;
    const at = new Date(t);
    const h = at.getHours();
    hours[h].cost += c;
    hours[h].tokens += n;
    grid[at.getDay()][h] += c;
  }
  return { days, hours, grid: grid.map((row) => row.map((c) => Math.round(c * 100) / 100)) };
}

/**
 * Average spend per weekday over up to four weeks, today so far included.
 * Averages start from your first day of real use, so a new install isn't
 * diluted by empty weeks. Index 0 is Sunday.
 */
function weekdays(events, now) {
  const starts = Array.from({ length: 28 }, (_, i) => dayStart(now, 27 - i));
  const daily = starts.map(() => ({ cost: 0, tokens: 0 }));
  for (const [t, c, n] of events) {
    if (t < starts[0] || t > now) continue;
    let i = Math.min(27, Math.floor((t - starts[0]) / DAY));
    while (i < 27 && t >= starts[i + 1]) i++;
    while (i > 0 && t < starts[i]) i--;
    daily[i].cost += c;
    daily[i].tokens += n;
  }
  const first = Math.max(
    0,
    daily.findIndex((d) => d.cost >= 1),
  );
  const days = Array.from({ length: 7 }, () => ({ total: 0, tokens: 0, count: 0, activeDays: 0 }));
  for (let i = first; i < 28; i++) {
    const w = days[new Date(starts[i]).getDay()];
    w.total += daily[i].cost;
    w.tokens += daily[i].tokens;
    w.count++;
    if (daily[i].cost >= 0.01) w.activeDays++;
  }
  return {
    since: starts[first],
    today: daily[27],
    days: days.map((w) => ({
      cost: w.count ? w.total / w.count : 0,
      tokens: w.count ? w.tokens / w.count : 0,
      total: w.total,
      count: w.count,
      activeDays: w.activeDays,
    })),
  };
}

/** What prompt caching saved, how much input came from the cache, and what rebuilding it cost. */
function cacheStats(events, since) {
  const out = {
    cost: 0,
    saved: 0,
    read: 0,
    write: 0,
    fresh: 0,
    writeCost: 0,
    rebuilds: 0,
    rebuildCost: 0,
    afterPause: 0,
    afterPauseCost: 0,
  };
  for (const [t, c, , , , x] of events) {
    if (t < since || !x) continue;
    out.cost += c;
    out.saved += x.saved;
    out.read += x.read;
    out.write += x.write;
    out.fresh += x.fresh;
    out.writeCost += x.writeCost;
    if (x.rebuild) {
      out.rebuilds++;
      out.rebuildCost += x.writeCost;
      if (x.rebuild === 'pause') {
        out.afterPause++;
        out.afterPauseCost += x.writeCost;
      }
    }
  }
  const input = out.read + out.write + out.fresh;
  out.hitRate = input ? out.read / input : null;
  return out;
}

const CONTEXT_BUCKETS = [
  [50_000, 'Under 50K'],
  [100_000, '50K–100K'],
  [200_000, '100K–200K'],
  [400_000, '200K–400K'],
  [Infinity, 'Over 400K'],
];

/** How much each message carried in context, what that cost, and how often sessions compacted. */
function contextHealth(index, events, since) {
  const buckets = CONTEXT_BUCKETS.map(([max, label]) => ({ max, label, messages: 0, cost: 0 }));
  let messages = 0;
  let cost = 0;
  let sum = 0;
  for (const [t, c, , , , x] of events) {
    if (t < since || !x) continue;
    const b = buckets.find((k) => x.context <= k.max);
    b.messages++;
    b.cost += c;
    messages++;
    cost += c;
    sum += x.context;
  }
  const compactions = index.compactions().filter((k) => k.t >= since);
  return {
    buckets: buckets.map((b) => ({ ...b, max: Number.isFinite(b.max) ? b.max : null })),
    messages,
    cost,
    avgContext: messages ? sum / messages : null,
    compactions: {
      count: compactions.length,
      auto: compactions.filter((k) => k.trigger === 'auto').length,
      avgBefore: compactions.length ? compactions.reduce((n, k) => n + k.before, 0) / compactions.length : null,
    },
  };
}

const LONG_CONTEXT = 200_000; // past this, compacting or a fresh session usually pays for itself

/**
 * What very long conversations cost over the last 7 days, two ways. The
 * surcharge is exact: OpenAI's models cost 2x for input and 1.5x for output
 * once a request passes 272K tokens. The size is an estimate: the share of
 * each message's cache reads that was conversation beyond 200K tokens, which is
 * roughly what compacting or a fresh session at that point would have saved.
 */
function longContextStats(index, agents, events, since) {
  let spend = 0;
  const surcharge = { cost: 0, requests: 0 };
  const size = { cost: 0, messages: 0 };
  const sessions = new Map();
  for (const [t, c, , model, rec, x] of events) {
    if (t < since || !x) continue;
    spend += c;
    const extra = longContextSurcharge(model, x);
    // Cache reads at the normal rate, so the surcharge isn't counted twice.
    const reads = extra > 0 && x.parts ? x.parts.cacheRead / 2 : x.parts?.cacheRead || 0;
    const over = x.context > LONG_CONTEXT && reads > 0 ? (reads * (x.context - LONG_CONTEXT)) / x.context : 0;
    if (!extra && !over) continue;
    if (extra) {
      surcharge.cost += extra;
      surcharge.requests++;
    }
    if (over) {
      size.cost += over;
      size.messages++;
    }
    const s = sessions.get(rec.session) || {
      id: rec.session,
      source: rec.source,
      cost: 0,
      surcharge: 0,
      messages: 0,
      peak: 0,
    };
    s.cost += extra + over;
    s.surcharge += extra;
    s.messages++;
    s.peak = Math.max(s.peak, x.context);
    sessions.set(rec.session, s);
  }
  const top = [...sessions.values()]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
    .map((s) => {
      const main = index.sessionRecord(s.id);
      return { ...s, title: sessionTitle(index, agents, s.id, main), project: main ? index.projectOf(main) : null };
    });
  return {
    since,
    spend,
    cost: surcharge.cost + size.cost,
    surcharge,
    size,
    from: LONG_CONTEXT,
    sessions: top,
    count: sessions.size,
  };
}

/** `mcp__Claude_Browser__computer` → `computer (Claude Browser)`; built-in tools keep their name. */
function prettyTool(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name || '');
  if (!m) return name || 'Unknown';
  if (/^[0-9a-f-]{16,}$/i.test(m[1])) return m[2];
  return `${m[2]} (${m[1]
    .replace(/^plugin_[^_]+_/, '')
    .replace(/^claude_ai_/, '')
    .replace(/_/g, ' ')})`;
}

const STALE_EDIT = /has not been read yet|modified since read/i;

/** Tool calls in the last 7 days: how many failed, which tools and why, and how many you denied. */
function toolFailures(index, now) {
  const since = dayStart(now, 6);
  const today = dayStart(now);
  const tools = new Map();
  const reasons = new Map();
  const out = { calls: 0, failed: 0, denied: 0, staleEdits: 0, today: { calls: 0, failed: 0, denied: 0 } };
  for (const c of index.calls()) {
    if (c.t < since) continue;
    const name = prettyTool(c.name);
    const tool = tools.get(name) || { name, calls: 0, failed: 0, denied: 0 };
    tools.set(name, tool);
    tool.calls++;
    out.calls++;
    if (c.t >= today) out.today.calls++;
    if (c.status === 'error') {
      tool.failed++;
      out.failed++;
      if (c.t >= today) out.today.failed++;
      if (c.reason) {
        reasons.set(c.reason, (reasons.get(c.reason) || 0) + 1);
        if (STALE_EDIT.test(c.reason)) out.staleEdits++;
      }
    } else if (c.status === 'denied') {
      tool.denied++;
      out.denied++;
      if (c.t >= today) out.today.denied++;
    }
  }
  out.byTool = [...tools.values()]
    .filter((t) => t.failed)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5);
  out.reasons = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([text, count]) => ({ text, count }));
  return out;
}

const IDLE_SPLIT_MS = 10 * 60_000; // a longer silence mid-turn counts as a break

/**
 * Stretches of work for every agent: from a message you sent (or a subagent's
 * task) until the agent's last reply before the next one.
 */
function workSpans(index, since) {
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

/** How many agents worked at the same time: the peak, today hour by hour, and agent-hours vs your hours. */
function parallelWork(index, now) {
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
function settleTurns(prompts, events) {
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
const waited = (x) => x.kind === 'human' && x.waitMs != null && !x.away;

/**
 * Every message in a main session since `since` (yours, interruptions and
 * background notices), settled as above.
 */
function turns(index, since) {
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
 */
function messageStats(index, agents, now, all = turns(index, dayStart(now, 6))) {
  const today0 = dayStart(now);
  const mine = all.filter((x) => x.kind === 'human');
  const interrupts = all.filter((x) => x.kind === 'interrupt');
  const days = new Set(mine.map((x) => new Date(x.t).toDateString()));
  const durations = mine.map((x) => x.end - x.t).sort((a, b) => a - b);
  const describe = (x) =>
    x && {
      text: x.text,
      t: x.t,
      cost: x.cost,
      partial: x.unpriced,
      source: x.rec.source,
      ms: x.end - x.t,
      project: index.projectOf(x.rec),
      session: x.rec.session,
      inOffice: !!agents.get(x.rec.session) && now - agents.get(x.rec.session).lastActivity < PRESENT_MS,
    };
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
 */
function waitingStats(index, agents, now, all) {
  const days = Array.from({ length: 7 }, (_, i) => ({ start: dayStart(now, 6 - i), ms: 0, replies: 0 }));
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

const STRETCH_GAP_MS = 30 * MINUTE; // a shorter break doesn't split a stretch of work

/**
 * Your own time, from the messages you typed: each message counts from when you
 * sent it until the agent's reply to it ended, and breaks under 30 minutes are
 * bridged. Grouped by working day (4am to 4am), with every message time and every
 * stretch kept for the cards that split days at midnight.
 */
function yourTime(index, now) {
  const byDay = new Map();
  const times = [];
  for (const x of turns(index, workDay(now, 30))) {
    if (x.kind !== 'human') continue;
    times.push(x.t);
    const start = workDay(x.t);
    let d = byDay.get(start);
    if (!d) byDay.set(start, (d = { start, first: x.t, last: x.t, messages: 0, spans: [] }));
    d.first = Math.min(d.first, x.t);
    d.last = Math.max(d.last, x.t);
    d.messages++;
    d.spans.push([x.t, Math.max(x.t + 2 * MINUTE, x.end)]);
  }
  for (const d of byDay.values()) {
    d.stretches = union(d.spans, STRETCH_GAP_MS).map(([a, b]) => [a, Math.min(b, now)]);
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
 */
function workingHours(now, mine) {
  const { byDay } = mine;
  const today = workDay(now);
  const days = Array.from(
    { length: 14 },
    (_, i) => byDay.get(workDay(now, 13 - i)) || { start: workDay(now, 13 - i), messages: 0 },
  );
  const worked = days.filter((d) => d.messages);
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

/** A sorted, merged copy of [start, end] intervals, joining any closer together than `gap`. */
function union(intervals, gap = 0) {
  const out = [];
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    const prev = out[out.length - 1];
    if (prev && a - prev[1] <= gap) prev[1] = Math.max(prev[1], b);
    else out.push([a, b]);
  }
  return out;
}

const totalMs = (intervals) => intervals.reduce((n, [a, b]) => n + b - a, 0);

/** The parts of the intervals that fall between `from` and `to`. */
const clip = (intervals, from, to) =>
  intervals.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);

/** How much of the merged intervals `a` the merged intervals `b` leave uncovered. */
function uncovered(a, b) {
  let ms = 0;
  for (const [s, e] of a) {
    let cur = s;
    for (const [bs, be] of b) {
      if (be <= cur) continue;
      if (bs >= e) break;
      if (bs > cur) ms += bs - cur;
      cur = Math.max(cur, be);
    }
    if (cur < e) ms += e - cur;
  }
  return ms;
}

const AGENT_DRAW_GAP_MS = 10 * MINUTE; // closer stretches of agent work are drawn as one

/**
 * When your agents worked, whatever set them off: your messages, subagents
 * handing back, background tasks. For each day: the wall-clock time at least one
 * agent was working, agent time added up across agents (so overlaps count once per
 * agent), the most at once, and how much came while you weren't active. `days` are
 * 4am working days for the calendar; `dates` are midnight-to-midnight days for the
 * bar charts, and the weekly totals use them too.
 */
function agentHours(index, now, mine) {
  const spans = workSpans(index, Math.min(workDay(now, 13), dayStart(now, 29)));
  const you = union(mine.stretches);
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
  let longest = null;
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = stats(workDay(now, 13 - i), i === 13 ? now : workDay(now, 12 - i));
    if (!d.wallMs) return d;
    d.stretches = union(d.busy, AGENT_DRAW_GAP_MS);
    d.late = d.last > new Date(d.start).setHours(24, 0, 0, 0);
    for (const [a, b] of d.stretches) if (!longest || b - a > longest.ms) longest = { ms: b - a, from: a, to: b };
    delete d.busy;
    return d;
  });
  const dates = Array.from({ length: 30 }, (_, i) => {
    const d = stats(dayStart(now, 29 - i), i === 29 ? now : dayStart(now, 28 - i));
    delete d.busy;
    return d;
  });
  const worked = days.filter((d) => d.wallMs);
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
 */
function sessionPlan(index, now, hours) {
  // Windows are grouped by calendar day; the plan uses your usual (4am) working day.
  const since = dayStart(now, 6);
  const windows = sessionWindows(index.events(), index.hits(), { from: since, now }).map(
    ({ start, end, cost, hitAt }) => ({ start, end, cost, hitAt }),
  );
  const started = windows.filter((w) => w.start >= since);
  const perDay = new Map();
  for (const w of started) perDay.set(dayStart(w.start), (perDay.get(dayStart(w.start)) || 0) + 1);
  const hit = windows.filter((w) => w.hitAt);
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

/** A session's name: what the live agent shows, else what its transcript says. */
function sessionTitle(index, agents, id, rec = index.sessionRecord(id)) {
  const live = agents.get(id);
  return (
    live?.agentName ||
    live?.title ||
    rec?.agentName ||
    rec?.title ||
    rec?.firstPrompt ||
    rec?.project ||
    'Untitled session'
  );
}

function topSessions(index, agents, now) {
  const since = dayStart(now);
  const sessions = new Map();
  for (const [t, c, n, , rec, d] of index.events()) {
    if (t < since) continue;
    const s = sessions.get(rec.session) || { cost: 0, tokens: 0, subCost: 0, added: 0, removed: 0, first: t, last: t };
    s.cost += c;
    s.unpriced ||= d?.costKnown === false;
    s.tokens += n;
    if (rec.sub) s.subCost += c;
    s.last = Math.max(s.last, t);
    sessions.set(rec.session, s);
  }
  for (const [t, added, removed, rec] of index.edits()) {
    if (t < since) continue;
    const s = sessions.get(rec.session);
    if (!s) continue;
    s.added += added;
    s.removed += removed;
  }
  // The priciest, and the ones that used the most tokens (a model with no known price costs nothing here).
  const all = [...sessions.entries()];
  const top = (key) => [...all].sort((a, b) => b[1][key] - a[1][key]).slice(0, 12);
  return [...new Set([...top('cost'), ...top('tokens')])]
    .sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens)
    .map(([id, s]) => {
      const rec = index.sessionRecord(id);
      const live = agents.get(id);
      return {
        id,
        source: rec?.source || 'claude',
        title: sessionTitle(index, agents, id),
        project: rec ? index.projectOf(rec) : null,
        cost: s.cost,
        partial: !!s.unpriced,
        subCost: s.subCost,
        tokens: s.tokens,
        added: s.added,
        removed: s.removed,
        linesPerDollar: s.cost > 0.05 ? (s.added + s.removed) / s.cost : null,
        inOffice: !!live && now - live.lastActivity < PRESENT_MS,
        last: s.last,
        context: contextOf(rec),
      };
    });
}

const LIST_DAYS = 30;

/**
 * How full a session's conversation is: its last reply's context against its
 * model's window, and when that was. Null before its first reply.
 */
function contextOf(rec) {
  for (let i = (rec?.events.length || 0) - 1; i >= 0; i--) {
    const [t, , , model, , d] = rec.events[i];
    if (!(d?.context > 0)) continue;
    const window = rec.contextWindow || contextWindow(model, d.context);
    return { used: d.context, window, pct: Math.min(100, Math.round((d.context / window) * 100)), at: t };
  }
  return null;
}

/**
 * Every session of the last 30 days, for the Sessions and Projects pages, newest
 * first: the models it used, when it started and was last active, and what it
 * did on each day it ran (cost with subagents, your messages, how long the agent
 * worked on them and waited for you, lines changed, tool calls), so any range
 * adds up exactly. A session that never got a reply (no tokens, no tool calls),
 * like a test run that couldn't sign in, is left out, unless it's still waiting
 * for its first.
 */
export function sessionList(index, agents, now = Date.now()) {
  const since = dayStart(now, LIST_DAYS - 1);
  const rows = new Map();
  const dayOf = (s, t) => {
    const key = dayStart(t);
    let d = s.days.get(key);
    if (!d)
      s.days.set(
        key,
        (d = {
          day: key,
          cost: 0,
          subCost: 0,
          tokens: 0,
          messages: 0,
          agentMs: 0,
          waitMs: 0,
          waits: 0,
          added: 0,
          removed: 0,
          tools: 0,
          failed: 0,
        }),
      );
    s.lastAt = Math.max(s.lastAt, t);
    return d;
  };
  const row = (rec) => {
    let s = rows.get(rec.session);
    if (!s) rows.set(rec.session, (s = { rec: null, days: new Map(), subs: new Set(), models: new Map(), lastAt: 0 }));
    if (!rec.sub) s.rec ||= rec;
    return s;
  };
  for (const [t, c, n, model, rec, d] of index.events()) {
    if (t < since) continue;
    const s = row(rec);
    const day = dayOf(s, t);
    day.cost += c;
    day.tokens += n;
    if (d?.costKnown === false) day.partial = true;
    if (rec.sub) {
      day.subCost += c;
      s.subs.add(rec);
    }
    add(s.models, modelName(model), c, n);
  }
  for (const x of turns(index, since)) {
    if (x.kind !== 'human') continue;
    const day = dayOf(row(x.rec), x.t);
    day.messages++;
    day.agentMs += x.end - x.t;
    if (waited(x)) {
      day.waitMs += x.waitMs;
      day.waits++;
    }
  }
  for (const [t, added, removed, rec] of index.edits()) {
    const s = t >= since && rows.get(rec.session);
    if (!s) continue;
    const day = dayOf(s, t);
    day.added += added;
    day.removed += removed;
  }
  for (const c of index.calls()) {
    const s = c.t >= since && rows.get(c.rec.session);
    if (!s) continue;
    const day = dayOf(s, c.t);
    day.tools++;
    if (c.status === 'error') day.failed++;
  }
  const replied = (s) => [...s.days.values()].some((d) => d.tokens > 0 || d.tools > 0);
  const waiting = (id) => {
    const a = agents?.get(id);
    return !!a && !a.turnEnded && now - a.lastActivity < PRESENT_MS;
  };
  return [...rows.entries()]
    .filter(([id, s]) => replied(s) || waiting(id))
    .map(([id, s]) => {
      const rec = s.rec || index.sessionRecord(id);
      const models = [...s.models.entries()].filter(([name]) => name !== 'unknown');
      const model = [...models].sort((a, b) => b[1].tokens - a[1].tokens)[0]?.[0];
      return {
        id,
        source: rec?.source || 'claude',
        title: sessionTitle(index, agents, id, rec),
        project: rec ? index.projectOf(rec) : null,
        model: model || null,
        models: models
          .sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens)
          .slice(0, 3)
          .map(([name, v]) => ({ name, cost: v.cost, tokens: v.tokens })),
        // When it began, even if that was before the last 30 days.
        startedAt: Math.min(rec?.prompts[0]?.[0] ?? Infinity, rec?.events[0]?.[0] ?? Infinity, s.lastAt),
        lastAt: s.lastAt,
        subagents: s.subs.size,
        context: contextOf(rec),
        days: [...s.days.values()].sort((a, b) => a.day - b.day),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** Midnight on the Monday of the week `t` falls in, moved by `weeks`. */
function weekStart(t, weeks = 0) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
  return d.getTime();
}

/** Midnight `days` after `t`'s midnight, safe across daylight-saving changes. */
function daysAfter(t, days) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * A week in review, Monday to Sunday: last week (`weeksAgo` 1) or this one so far
 * (0), with the same days of the week before for comparison. Built from the
 * session list, so it matches the Sessions and Projects pages; your active time
 * and limit hits come from the same index.
 */
export function weeklyDigest(index, agents, now = Date.now(), weeksAgo = 1) {
  const from = weekStart(now, -weeksAgo);
  const to = weeksAgo ? weekStart(now, 1 - weeksAgo) : daysAfter(now, 1);
  const days = Math.round((to - from) / DAY);
  const before = [weekStart(now, -weeksAgo - 1), daysAfter(weekStart(now, -weeksAgo - 1), days)];
  const list = sessionList(index, agents, now);
  const mine = yourTime(index, now);

  function totals(a, b) {
    const t = {
      cost: 0,
      partial: false,
      sessions: 0,
      messages: 0,
      agentMs: 0,
      waitMs: 0,
      waits: 0,
      added: 0,
      removed: 0,
      tools: 0,
      failed: 0,
      bySource: Object.fromEntries(SOURCES.map((s) => [s, 0])),
    };
    const projects = new Map();
    const perDay = new Map();
    const sessions = [];
    for (const s of list) {
      const own = s.days.filter((d) => d.day >= a && d.day < b);
      if (!own.length) continue;
      const x = { id: s.id, title: s.title, project: s.project, source: s.source, cost: 0, messages: 0, agentMs: 0 };
      for (const d of own) {
        for (const k of ['cost', 'messages', 'agentMs', 'waitMs', 'waits', 'added', 'removed', 'tools', 'failed'])
          t[k] += d[k] || 0;
        t.partial ||= !!d.partial;
        x.cost += d.cost;
        x.messages += d.messages;
        x.agentMs += d.agentMs;
        perDay.set(d.day, (perDay.get(d.day) || 0) + d.cost);
      }
      t.sessions++;
      t.bySource[s.source] = (t.bySource[s.source] || 0) + x.cost;
      sessions.push(x);
      const p = projects.get(s.project) || { name: s.project || 'Unknown', cost: 0, sessions: 0, agentMs: 0 };
      p.cost += x.cost;
      p.sessions++;
      p.agentMs += x.agentMs;
      projects.set(s.project, p);
    }
    t.activeMs = totalMs(clip(mine.stretches, a, Math.min(b, now)));
    t.projects = [...projects.values()].sort((x, y) => y.cost - x.cost).slice(0, 5);
    t.topSessions = sessions.sort((x, y) => y.cost - x.cost).slice(0, 5);
    t.busiest = [...perDay.entries()].sort((x, y) => y[1] - x[1])[0] || null;
    return t;
  }

  // Limits you ran into: Claude's as Claude Code recorded them; Codex's as the
  // windows whose readings reached 100%.
  const inWeek = (t) => t >= from && t < to;
  const codexHit = new Set();
  for (const [t, bucket, kind, used, reset] of index.quotaLog?.() || [])
    if (used >= 100 && inWeek(t)) codexHit.add(`${bucket}:${kind}:${Math.round(reset / 600_000)}`);
  return {
    from,
    to,
    weeksAgo,
    days,
    ...totals(from, to),
    before: totals(...before),
    // Claude Code notes a hit on every retry; each window counts once.
    hits: {
      claude: new Set(
        index
          .hits()
          .filter((h) => inWeek(h.t))
          .map((h) => `${h.type}:${Math.round(h.resetsAt / 600_000)}`),
      ).size,
      codex: codexHit.size,
    },
    computedAt: now,
  };
}

/**
 * One session in full, from the index: when it ran, what it cost and on what,
 * your messages with what each one set off, its subagents, edits and tool calls,
 * and its cost over time. For the dashboard's session panel.
 */
export function sessionDetail(index, id) {
  const recs = index.recordsOf(id);
  if (!recs.length) return null;
  const main = recs.find((r) => !r.sub) || null;
  const subs = recs.filter((r) => r.sub);
  const events = recs.flatMap((r) => r.events).sort((a, b) => a[0] - b[0]);
  const tokens = { fresh: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Map();
  let cost = 0;
  let subCost = 0;
  let saved = 0;
  for (const [, c, n, model, rec, d] of events) {
    cost += c;
    if (rec.sub) subCost += c;
    tokens.fresh += d.fresh;
    tokens.output += d.output;
    tokens.cacheRead += d.read;
    tokens.cacheWrite += d.write;
    saved += d.saved || 0;
    add(models, modelName(model), c, n);
  }
  const edits = recs.flatMap((r) => r.edits);
  const calls = recs.flatMap((r) => r.calls);
  const byTool = new Map();
  for (const c of calls) byTool.set(prettyTool(c.name), (byTool.get(prettyTool(c.name)) || 0) + 1);

  // Your messages, and what each one set off, as in the Your messages card.
  const turnList = settleTurns(
    [...(main?.prompts || [])].sort((a, b) => a[0] - b[0]),
    events,
  );
  const mine = turnList.filter((x) => x.kind === 'human');
  const partial = events.some((e) => e[5]?.costKnown === false);

  // Both lists are in time order, so their ends are the session's.
  const ends = [
    events[0]?.[0],
    events[events.length - 1]?.[0],
    turnList[0]?.t,
    turnList[turnList.length - 1]?.t,
  ].filter((t) => t != null);
  const firstAt = ends.length ? Math.min(...ends) : null;
  const lastAt = ends.length ? Math.max(...ends) : null;
  // Cost over time, in steps that suit how long the session ran.
  let timeline = null;
  if (firstAt != null) {
    const span = lastAt - firstAt;
    const step = span <= 6 * HOUR ? 10 * MINUTE : span <= 2 * DAY ? HOUR : DAY;
    const from = step === DAY ? dayStart(firstAt) : Math.floor(firstAt / step) * step;
    const costs = new Array(Math.floor((lastAt - from) / step) + 1).fill(0);
    for (const [t, c] of events) costs[Math.floor((t - from) / step)] += c;
    timeline = { from, step, costs };
  }
  const subInfo = subs.map((r) => ({
    title: r.agentName || r.firstPrompt || 'Subagent',
    cost: r.events.reduce((n, e) => n + e[1], 0),
    partial: r.events.some((e) => e[5]?.costKnown === false),
    firstAt: r.events[0]?.[0] ?? r.prompts[0]?.[0] ?? null,
    lastAt: r.events[r.events.length - 1]?.[0] ?? null,
    calls: r.calls.length,
  }));
  return {
    id,
    nativeId: main?.nativeId || id,
    source: main?.source || recs[0].source,
    title: main?.agentName || main?.title || main?.firstPrompt || null,
    project: index.projectOf(main || recs[0]),
    cwd: main?.cwd || null,
    firstAt,
    lastAt,
    cost,
    partial,
    subCost,
    saved,
    tokens: { ...tokens, total: tokens.fresh + tokens.output + tokens.cacheRead + tokens.cacheWrite },
    models: topList(models, 3),
    lines: { added: edits.reduce((n, e) => n + e[1], 0), removed: edits.reduce((n, e) => n + e[2], 0) },
    tools: {
      calls: calls.length,
      failed: calls.filter((c) => c.status === 'error').length,
      denied: calls.filter((c) => c.status === 'denied').length,
      top: [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    },
    compactions: recs.reduce((n, r) => n + r.compactions.length, 0),
    context: contextOf(main),
    // How long the agent worked on your messages, and waited for you, as the Sessions page counts them.
    agentMs: mine.reduce((n, x) => n + (x.end - x.t), 0),
    waitMs: mine.filter(waited).reduce((n, x) => n + x.waitMs, 0),
    messages: {
      count: mine.length,
      interrupts: turnList.filter((x) => x.kind === 'interrupt').length,
      list: mine
        .slice(-40)
        .reverse()
        .map((x) => ({ t: x.t, text: x.text, cost: x.cost, partial: x.unpriced, ms: x.end - x.t })),
    },
    subagents: { count: subs.length, list: subInfo.sort((a, b) => b.cost - a.cost).slice(0, 8) },
    timeline,
  };
}

/**
 * One of your messages in a session, with what it led to: the message itself,
 * the agent's replies to it (while search keeps the text), the files it read
 * and changed, the commands it ran, and what it cost. `at` is any moment in it,
 * like the time of a search's match: the message is the one you sent last by
 * then, and it runs until your next.
 */
export function turnDetail(index, id, at) {
  const recs = index.recordsOf(id);
  const main = recs.find((r) => !r.sub);
  if (!main) return null;
  const human = main.prompts.filter((p) => p[2] === 'human').sort((a, b) => a[0] - b[0]);
  const start = human.filter((p) => p[0] <= at + 1000).pop() || human[0];
  if (!start) return null;
  const next = human.find((p) => p[0] > start[0]);
  const from = start[0];
  const to = next ? next[0] : Infinity;
  const inTurn = (t) => t >= from && t < to;
  const files = new Map();
  const file = (p) => files.get(p) || files.set(p, { path: p, reads: 0, edits: 0, added: 0, removed: 0 }).get(p);
  const commands = [];
  const tools = new Map();
  let failed = 0;
  let denied = 0;
  let subagents = 0;
  for (const r of recs) {
    for (const c of r.calls) {
      if (!inTurn(c.t)) continue;
      tools.set(prettyTool(c.name), (tools.get(prettyTool(c.name)) || 0) + 1);
      if (c.status === 'error') failed++;
      if (c.status === 'denied') denied++;
      // Each harness says which of its tools read and write files, run commands and brief subagents.
      const kinds = harness(r.source).tools;
      if (kinds.delegate(c.name)) subagents++;
      if (c.file && kinds.reads.has(c.name)) file(c.file).reads++;
      if (c.file && kinds.writes.has(c.name)) file(c.file).edits++;
      if (c.what && kinds.command(c.name))
        commands.push({ t: c.t, text: c.what, status: c.status, reason: c.reason, sub: !!r.sub });
    }
    for (const [t, added, removed, , p] of r.edits) {
      if (!inTurn(t) || !p) continue;
      const f = file(p);
      f.added += added;
      f.removed += removed;
      f.edits ||= 1;
    }
  }
  let cost = 0;
  let tokens = 0;
  let last = from;
  let partial = false;
  for (const r of recs) {
    for (const [t, c, n, , , d] of r.events) {
      if (!inTurn(t)) continue;
      cost += c;
      tokens += n;
      last = Math.max(last, t);
      partial ||= d?.costKnown === false;
    }
  }
  const replies = (main.texts || [])
    .filter(([t, who]) => who === 'agent' && inTurn(t))
    .map(([t, , text]) => ({ t, text }));
  const own = index.youTextAt(main, from);
  return {
    id,
    cwd: main.cwd || null,
    t: from,
    next: next ? next[0] : null,
    text: own || start[3] || '',
    whole: !!own,
    searchOn: index.searchOn(),
    replies: replies.length > 24 ? [...replies.slice(0, 4), ...replies.slice(-20)] : replies,
    moreReplies: Math.max(0, replies.length - 24),
    files: [...files.values()]
      .sort((a, b) => (b.edits > 0) - (a.edits > 0) || b.added + b.removed - (a.added + a.removed) || b.reads - a.reads)
      .slice(0, 40),
    moreFiles: Math.max(0, files.size - 40),
    commands: commands.slice(-30),
    moreCommands: Math.max(0, commands.length - 30),
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    failed,
    denied,
    subagents,
    cost,
    partial,
    tokens,
    ms: last - from,
  };
}

const TIMELINE_LANES = 14;
const SLOT_MS = 15 * MINUTE;

/**
 * Your usual day: for each 15 minutes of the day, how often you were active
 * then, over the last 14 days you worked (today left out). 0 is never, 1 is
 * every one of those days. For shading today's timeline.
 */
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
 */
function todayTimeline(index, agents, now, mine) {
  const from = dayStart(now);
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
  const list = [...lanes.values()]
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
    .filter((l) => l.first != null);
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
 */
function dailyTotals(index, now, mine) {
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

export function computeInsights({ index, agents, now = Date.now() }) {
  if (!index.ready()) return null;
  const events = index.events();
  const mine = yourTime(index, now);
  const hours = workingHours(now, mine);
  const recent = turns(index, dayStart(now, 6));
  const projectOf = (rec) => index.projectOf(rec);
  return {
    breakdown: {
      d7: breakdown(events, dayStart(now, 6), projectOf),
      d30: breakdown(events, dayStart(now, 29), projectOf),
    },
    trend: { ...trend(events, now), weekdays: weekdays(events, now) },
    cache: { d7: cacheStats(events, dayStart(now, 6)), today: cacheStats(events, dayStart(now)) },
    context: contextHealth(index, events, dayStart(now, 6)),
    longContext: longContextStats(index, agents, events, dayStart(now, 6)),
    tools: toolFailures(index, now),
    messages: messageStats(index, agents, now, recent),
    turnPerformance: turnPerformance(recent, agents, now),
    waiting: waitingStats(index, agents, now, recent),
    parallel: parallelWork(index, now),
    hours,
    agentHours: agentHours(index, now, mine),
    windows: index.source === 'claude' ? sessionPlan(index, now, hours) : null,
    topSessions: topSessions(index, agents, now),
    timeline: todayTimeline(index, agents, now, mine),
    skills: skillUsage(index, now),
    repeats: repeatedPrompts(index, now, index.youTextAt),
    // For the heatmap's history; the server keeps it and serves it on its own.
    daily: dailyTotals(index, now, mine),
    computedAt: now,
  };
}

/**
 * Today's totals for the Today's activity card, from the same provider-filtered
 * index as the charts: tokens, cost, tool calls, lines changed, and the sessions
 * that did some work, priciest first.
 */
export function activitySummary(index, agents, now = Date.now()) {
  const start = dayStart(now);
  const totals = {
    tokens: 0,
    cost: 0,
    costPartial: false,
    tools: 0,
    added: 0,
    removed: 0,
    sessions: 0,
    sessionList: [],
  };
  const sessions = new Map();
  for (const [t, cost, tokens, , rec, d] of index.events()) {
    if (t < start || t > now) continue;
    totals.tokens += tokens;
    totals.cost += cost;
    totals.costPartial ||= d?.costKnown === false;
    let row = sessions.get(rec.session);
    if (!row)
      sessions.set(
        rec.session,
        (row = {
          id: rec.session,
          source: rec.source,
          title: sessionTitle(index, agents, rec.session),
          project: index.projectOf(rec),
          cost: 0,
          tokens: 0,
          partial: false,
          context: contextOf(index.sessionRecord(rec.session)),
        }),
      );
    row.cost += cost;
    row.tokens += tokens;
    row.partial ||= d?.costKnown === false;
  }
  for (const [t, added, removed] of index.edits()) {
    if (t < start || t > now) continue;
    totals.added += added;
    totals.removed += removed;
  }
  totals.tools = index.calls().filter((c) => c.t >= start && c.t <= now).length;
  totals.sessions = sessions.size;
  totals.sessionList = [...sessions.values()].sort((a, b) => b.cost - a.cost);
  return totals;
}
