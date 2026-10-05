// Plan limits: the 5-hour session window and the weekly window.
//
// Two sources:
//  - estimate: rebuilt locally from the last 7 days of Claude Code usage,
//    calibrated against the moments you actually hit a limit (Claude Code records
//    those with the exact reset time). Nothing leaves the machine.
//  - exact: on by default, with an on/off switch in the dashboard. Reads the
//    Claude Code CLI login from the macOS Keychain (or ~/.claude/.credentials.json)
//    and asks api.anthropic.com for the same numbers as /usage, only when the page
//    asks. The login is only ever sent to Anthropic, and never refreshed or written
//    here, so it can't interfere with a running Claude Code. Switching exact off
//    drops it from memory.

import { promises as fsp, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Which Overtime is asking, said honestly in each request.
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '';
  } catch {
    return '';
  }
})();

const HOUR = 3_600_000;
const SESSION_MS = 5 * HOUR;
const WEEK_MS = 7 * 24 * HOUR;

// The usage index lives in usage-index.js; re-exported for the server.
export { createUsageIndex } from './usage-index.js';

// ── Estimate ───────────────────────────────────────────────────────────────

function costBetween(events, from, to) {
  let sum = 0;
  for (const [t, cost] of events) if (t >= from && t < to) sum += cost;
  return sum;
}

function totalsBetween(events, from, to) {
  let cost = 0;
  let tokens = 0;
  let unpricedTokens = 0;
  for (const [t, c, n, , , d] of events) {
    if (t >= from && t < to) {
      cost += c;
      tokens += n;
      if (d?.costKnown === false) unpricedTokens += n;
    }
  }
  return {
    cost,
    tokens,
    unpricedTokens,
    partial: unpricedTokens > 0,
    costKnown: tokens === 0 || unpricedTokens < tokens,
  };
}

/** Estimated dollars (at API prices) used inside a limit window, e.g. since the last weekly reset. */
export function windowSpend(index, start, end = Date.now() + 1) {
  if (!index.ready()) return null;
  return totalsBetween(index.events(), start, end);
}

/** Today, yesterday, the last 7 and the last 30 calendar days, and this month so far, in local time. */
export function spendSummary(index, now = Date.now()) {
  if (!index.ready()) return null;
  const events = index.events();
  const dayStart = (daysAgo) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.getTime();
  };
  const end = now + 1;
  // Yesterday up to this time of day, so today so far has a fair comparison.
  const sameTimeYesterday = Math.min(dayStart(0), dayStart(1) + (now - dayStart(0)));
  const monthStart = new Date(dayStart(0)).setDate(1);
  return {
    today: totalsBetween(events, dayStart(0), end),
    yesterday: totalsBetween(events, dayStart(1), dayStart(0)),
    yesterdayByNow: totalsBetween(events, dayStart(1), sameTimeYesterday + 1),
    last7: totalsBetween(events, dayStart(6), end),
    last30: totalsBetween(events, dayStart(29), end),
    // This calendar month so far; the index covers 31 days, so all of it.
    month: { ...totalsBetween(events, monthStart, end), from: monthStart },
  };
}

/** How much a window held when the limit was hit, averaged over recent hits. */
function calibrate(events, hits, windowMs) {
  const byReset = new Map();
  for (const h of hits) if (!byReset.has(h.resetsAt)) byReset.set(h.resetsAt, h.t);
  const capacities = [...byReset.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([resetsAt, firstHit]) => ({ resetsAt, firstHit, cost: costBetween(events, resetsAt - windowMs, firstHit) }))
    .filter((c) => c.cost > 0.5);
  if (!capacities.length) return null;
  return {
    capacity: capacities.reduce((n, c) => n + c.cost, 0) / capacities.length,
    lastHitAt: capacities[0].firstHit,
    samples: capacities.length,
  };
}

const FIVE_MIN = 5 * 60_000;

/** The first event at or after `t`, by binary search (events are sorted by time). */
function firstAfter(events, t) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Cost in fixed steps from `from` to now: the shape of a window's usage, for the chart. */
function costSteps(events, from, step, now) {
  const costs = new Array(Math.max(1, Math.ceil((now + 1 - from) / step))).fill(0);
  for (let i = firstAfter(events, from); i < events.length && events[i][0] <= now; i++) {
    costs[Math.floor((events[i][0] - from) / step)] += events[i][1];
  }
  return { from, step, costs: costs.map((c) => Math.round(c * 1000) / 1000) };
}

// Windows start on 10-minute marks: a first message at 11:22 resets at 4:20pm.
const WINDOW_STEP_MS = 10 * 60_000;

/**
 * The 5-hour session windows, rebuilt from usage: each one starts with the first
 * message after the previous one ended. A recorded limit hit gives its window's
 * exact end, and `hitAt` when it was hit. Windows that ended before `from` are
 * left out.
 */
export function sessionWindows(events, hits, { from = -Infinity, now = Date.now() } = {}) {
  const sessionHits = hits.filter((h) => h.type === 'five_hour');
  const knownEnds = [...new Set(sessionHits.map((h) => h.resetsAt))];
  const windows = [];
  let w = null;
  for (const [t, cost] of events) {
    if (t > now) break;
    if (!w || t >= w.end) {
      const known = knownEnds.find((end) => t >= end - SESSION_MS && t < end);
      const start = known ? known - SESSION_MS : Math.floor(t / WINDOW_STEP_MS) * WINDOW_STEP_MS;
      w = { start, end: start + SESSION_MS, cost: 0, hitAt: null };
      windows.push(w);
    }
    w.cost += cost;
  }
  for (const h of sessionHits) {
    const hit = windows.find((x) => Math.abs(x.end - h.resetsAt) < 60_000);
    if (hit) hit.hitAt = Math.min(hit.hitAt ?? Infinity, h.t);
  }
  return windows.filter((x) => x.end > from);
}

function currentSessionWindow(events, hits, now) {
  const activeHit = hits.filter((h) => h.type === 'five_hour' && h.resetsAt > now).pop();
  if (activeHit) return { start: activeHit.resetsAt - SESSION_MS, end: activeHit.resetsAt, limited: true };
  const last = sessionWindows(events, hits, { now }).pop();
  if (!last || last.end <= now) return null;
  return { start: last.start, end: last.end, limited: false };
}

function currentWeeklyWindow(hits, now) {
  const weekly = hits.filter((h) => h.type.startsWith('seven_day')).pop();
  if (!weekly) return null;
  let end = weekly.resetsAt;
  while (end <= now) end += WEEK_MS;
  return { start: end - WEEK_MS, end, limited: weekly.resetsAt > now };
}

export function estimateLimits(index, now = Date.now()) {
  if (!index.ready()) return null;
  const events = index.events();
  const hits = index.hits();
  const sessionCal = calibrate(
    events,
    hits.filter((h) => h.type === 'five_hour'),
    SESSION_MS,
  );
  const weeklyCal = calibrate(
    events,
    hits.filter((h) => h.type.startsWith('seven_day')),
    WEEK_MS,
  );

  const sw = currentSessionWindow(events, hits, now);
  const sessionUsed = sw ? costBetween(events, sw.start, now + 1) : 0;
  const session = {
    active: !!sw,
    start: sw?.start || null,
    resetsAt: sw?.end || null,
    limited: !!sw?.limited,
    used: sessionUsed,
    pct: sw?.limited
      ? 100
      : sessionCal
        ? Math.min(100, Math.round((sessionUsed / sessionCal.capacity) * 100))
        : sw
          ? null
          : 0,
    capacity: sessionCal?.capacity || null,
    calibration: sessionCal && { lastHitAt: sessionCal.lastHitAt, samples: sessionCal.samples },
  };

  const ww = currentWeeklyWindow(hits, now);
  const weeklyUsed = costBetween(events, ww ? ww.start : now - WEEK_MS, now + 1);
  const weekly = {
    resetsAt: ww?.end || null,
    rolling: !ww,
    limited: !!ww?.limited,
    used: weeklyUsed,
    pct: ww?.limited
      ? 100
      : weeklyCal && ww
        ? Math.min(100, Math.round((weeklyUsed / weeklyCal.capacity) * 100))
        : null,
    capacity: weeklyCal?.capacity || null,
    calibration: weeklyCal && { lastHitAt: weeklyCal.lastHitAt, samples: weeklyCal.samples },
  };
  // Recent burn rates, for projecting when each limit will run out.
  const rates = {
    cost30m: costBetween(events, now - 30 * 60_000, now + 1),
    cost24h: costBetween(events, now - 24 * HOUR, now + 1),
    cost7d: costBetween(events, now - WEEK_MS, now + 1),
  };
  // Enough of the recent past to draw any current window: 5-minute steps for the
  // session, hourly for the week.
  const usage = {
    fine: costSteps(events, Math.floor((now - SESSION_MS - WINDOW_STEP_MS) / FIVE_MIN) * FIVE_MIN, FIVE_MIN, now),
    hourly: costSteps(events, Math.floor((now - WEEK_MS - HOUR) / HOUR) * HOUR, HOUR, now),
  };
  return { source: 'estimate', session, weekly, rates, usage, spend: spendSummary(index, now), computedAt: now };
}

// ── Exact (from Anthropic) ─────────────────────────────────────────────────

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CACHE_MS = 60_000;

let tokenCache = null; // { token, expiresAt } kept in memory only
let exactCache = null;
let cooldownUntil = 0; // set when Anthropic asks us to slow down

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000 }, (error, stdout) => resolve(error ? null : String(stdout).trim()));
  });
}

async function readLogin() {
  if (tokenCache && (!tokenCache.expiresAt || tokenCache.expiresAt > Date.now() + 60_000)) return tokenCache;
  let raw = null;
  if (process.platform === 'darwin')
    raw = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']);
  if (!raw) {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    try {
      raw = await fsp.readFile(path.join(dir, '.credentials.json'), 'utf8');
    } catch {}
  }
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw);
    const oauth = blob.claudeAiOauth || blob;
    if (!oauth.accessToken) return null;
    tokenCache = { token: oauth.accessToken, expiresAt: Number(oauth.expiresAt) || 0 };
    return tokenCache;
  } catch {
    return null;
  }
}

function toMs(value) {
  if (typeof value === 'number') return value > 1e10 ? value : value * 1000;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n > 1e10 ? n : n * 1000;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function window(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const pct = Number(rec.utilization ?? rec.used_percentage ?? rec.usedPercent);
  if (!Number.isFinite(pct)) return null;
  return { pct: Math.max(0, Math.min(100, Math.round(pct))), resetsAt: toMs(rec.resets_at ?? rec.resetsAt) };
}

const EXTRA_LABELS = {
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_oauth_apps: 'Weekly · apps',
};

const FORCE_MIN_MS = 15_000; // a manual refresh still won't ask Anthropic more often than this

/** Exact numbers were switched off: drop the login from memory until they're back on. */
export function forgetLogin() {
  tokenCache = null;
}

export async function exactLimits({ force = false } = {}) {
  const age = exactCache ? Date.now() - exactCache.fetchedAt : Infinity;
  if (age < (force ? FORCE_MIN_MS : CACHE_MS)) return exactCache;
  if (Date.now() < cooldownUntil) {
    return exactCache ? { ...exactCache, stale: true } : { source: 'exact', status: 'cooling', retryAt: cooldownUntil };
  }
  const login = await readLogin();
  if (!login) {
    return {
      source: 'exact',
      status: 'no-login',
      message: 'No Claude Code login found. Run `claude auth login` in Terminal, then try again.',
    };
  }
  if (login.expiresAt && login.expiresAt < Date.now()) {
    tokenCache = null;
    return {
      source: 'exact',
      status: 'expired',
      message: 'Your Claude Code login has expired. Run any `claude` command to refresh it, then try again.',
    };
  }
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${login.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': `overtime/${VERSION}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      tokenCache = null;
      return {
        source: 'exact',
        status: 'expired',
        message: `Anthropic didn't accept the login (${res.status}). Run \`claude auth login\` again.`,
      };
    }
    if (res.status === 429) {
      // Honour Retry-After; otherwise wait five minutes before asking again.
      const after = Number(res.headers.get('retry-after'));
      cooldownUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : 5 * 60_000);
      return exactCache
        ? { ...exactCache, stale: true }
        : { source: 'exact', status: 'cooling', retryAt: cooldownUntil };
    }
    if (!res.ok) {
      return exactCache
        ? { ...exactCache, stale: true }
        : { source: 'exact', status: 'error', message: `Anthropic answered ${res.status}. Trying again later.` };
    }
    const body = await res.json();
    const extras = Object.entries(EXTRA_LABELS)
      .map(([key, label]) => ({ key, label, ...window(body[key]) }))
      .filter((x) => Number.isFinite(x.pct));
    exactCache = {
      source: 'exact',
      status: 'ok',
      session: window(body.five_hour),
      weekly: window(body.seven_day),
      extras,
      fetchedAt: Date.now(),
    };
    return exactCache;
  } catch (error) {
    return exactCache
      ? { ...exactCache, stale: true }
      : {
          source: 'exact',
          status: 'error',
          message: `Couldn't reach Anthropic (${error.name === 'TimeoutError' ? 'timed out' : 'network error'}).`,
        };
  }
}
