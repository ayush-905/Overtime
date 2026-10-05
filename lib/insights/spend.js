// Where the money goes: by model, agent, project and kind of token over 7 and 30
// days, the 30-day trend with the hour-of-day and weekday patterns, the average
// weekday, what caching saved, how context size drives cost, what very long
// conversations cost, and which tool calls failed. Costs are at API list prices.
// @ts-check
/** @import { Breakdown, CacheStats, ContextHealth, LongContext, LongContextSession, TokenTypeCost, ToolFailures, Trend, Weekdays } from '../../types/api.js' */

import { modelName } from '../models.js';
import { longContextSurcharge } from '../pricing.js';
import { DAY, dayStart } from './time.js';
import { add, prettyTool, sessionTitle, topList } from './common.js';

/** @type {[TokenTypeCost['key'], string, (x: any) => number][]} */
const TOKEN_TYPES = [
  ['output', 'Output (incl. thinking)', (x) => x.output],
  ['cacheRead', 'Cache reads', (x) => x.read],
  ['cacheWrite', 'Cache writes', (x) => x.write],
  ['input', 'Fresh input', (x) => x.fresh],
  ['search', 'Web searches', () => 0],
];

/** @returns {Breakdown} */
export function breakdown(events, since, projectOf) {
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
      const v = /** @type {TokenTypeCost} */ (types.get(key));
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

/** @returns {Omit<Trend, 'weekdays'>} */
export function trend(events, now) {
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
 * @returns {Weekdays}
 */
export function weekdays(events, now) {
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

/** What prompt caching saved, how much input came from the cache, and what rebuilding it cost. @returns {CacheStats} */
export function cacheStats(events, since) {
  const out = /** @type {CacheStats} */ ({
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
  });
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

/** @type {[number, string][]} */
const CONTEXT_BUCKETS = [
  [50_000, 'Under 50K'],
  [100_000, '50K–100K'],
  [200_000, '100K–200K'],
  [400_000, '200K–400K'],
  [Infinity, 'Over 400K'],
];

/** How much each message carried in context, what that cost, and how often sessions compacted. @returns {ContextHealth} */
export function contextHealth(index, events, since) {
  const buckets = CONTEXT_BUCKETS.map(([max, label]) => ({ max, label, messages: 0, cost: 0 }));
  let messages = 0;
  let cost = 0;
  let sum = 0;
  for (const [t, c, , , , x] of events) {
    if (t < since || !x) continue;
    // The last one has no top, so there's always one.
    const b = /** @type {(typeof buckets)[number]} */ (buckets.find((k) => x.context <= k.max));
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
 * @returns {LongContext}
 */
export function longContextStats(index, agents, events, since) {
  let spend = 0;
  const surcharge = { cost: 0, requests: 0 };
  const size = { cost: 0, messages: 0 };
  /** @type {Map<string, Omit<LongContextSession, 'title' | 'project'>>} */
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

const STALE_EDIT = /has not been read yet|modified since read/i;

/** Tool calls in the last 7 days: how many failed, which tools and why, and how many you denied. @returns {ToolFailures} */
export function toolFailures(index, now) {
  const since = dayStart(now, 6);
  const today = dayStart(now);
  /** @type {Map<string, ToolFailures['byTool'][number]>} */
  const tools = new Map();
  /** @type {Map<string, number>} */
  const reasons = new Map();
  const out = /** @type {ToolFailures} */ ({
    calls: 0,
    failed: 0,
    denied: 0,
    staleEdits: 0,
    today: { calls: 0, failed: 0, denied: 0 },
  });
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
