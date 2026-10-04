#!/usr/bin/env node
// Overtime: follows local Claude Code, Codex and pi transcripts (read-only) and
// streams live state to two pages in the browser: the dashboard at / and the
// pixel office at /office/. The desktop app (desktop/) runs this same server.
// Binds to 127.0.0.1 only. Optional account-limit checks contact Anthropic
// directly and OpenAI through the installed Codex CLI.

import http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createFeed, view } from './lib/agents.js';
import { createWatcher } from './lib/watcher.js';
import { createUsageIndex, estimateLimits, exactLimits, forgetLogin, windowSpend, spendSummary } from './lib/limits.js';
import { computeInsights, sessionDetail, sessionList, activitySummary, weeklyDigest, setWorkdayHour, turnDetail } from './lib/insights.js';
import { exactCodexLimits, recordedCodexLimits } from './lib/codex-limits.js';
import { createSessionMonitor } from './lib/open-sessions.js';
import { createStore, cleanPrefs, mergeHistory, historyDays, applySettings, settingsScript, DEFAULT_PREFS } from './lib/store.js';
import { resumeOptions, resumeInTerminal } from './lib/resume.js';
import { writeCommand } from './lib/prompts.js';
import { harness, isSessionId, nativeIdOf, openHarnesses } from './lib/harnesses/index.js';

// PORT=0 takes any free port, as the desktop app does when 4777 is taken by something else.
const PORT = /^\d{1,5}$/.test(process.env.PORT || '') ? Number(process.env.PORT) : 4777;
const HOST = '127.0.0.1';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(ROOT, 'web');
const VERSION = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8').catch(() => '{}')).version || '';

// Something going wrong is logged and the server carries on, since every page and
// the menu bar depend on it. The same failure over and over is said once a minute.
const said = new Map(); // what was said → when
function report(where, error) {
  const message = `${where}: ${error?.stack || error}`;
  const now = Date.now();
  if (now - (said.get(message) || 0) < 60_000) return;
  if (said.size > 100) said.clear();
  said.set(message, now);
  console.error(message);
}
process.on('unhandledRejection', (error) => report('Something went wrong', error));

const feed = createFeed();
// Every harness, with its transcripts' folder from the environment (CLAUDE_PROJECTS_DIR and so on).
const harnesses = openHarnesses();
const watcher = createWatcher({ harnesses, feed });
const usageIndex = createUsageIndex({ harnesses });
const claudeIndex = usageIndex.scope('claude');
const openSessions = createSessionMonitor({
  sessions: () => usageIndex.sessions(),
  live: (id) => {
    const a = watcher.agents.get(id);
    return a ? view(a, Date.now()) : null;
  },
});
// Your dashboard settings, the ones that change what the server works out, and the
// days it keeps for the heatmap, all in ~/.overtime.
const store = createStore();
const savedSettings = await store.read('settings.json', null);
let settings = { initialized: !!savedSettings, values: applySettings({}, savedSettings?.values).values };
let prefs = cleanPrefs(await store.read('prefs.json', DEFAULT_PREFS));
setWorkdayHour(prefs.workdayHour);
usageIndex.setSearch(prefs.search);
let history = await store.read('history.json', { version: 1, days: {} });
let dailyFresh = null; // the last 30 days from the transcripts, per provider view
let watching = [];
let present = ['claude']; // the sources with a folder on this Mac, each a view of its own
let limitsEstimate = null;
let limitsComputedAt = 0;

function limits(now) {
  if (now - limitsComputedAt > 15_000) {
    limitsEstimate = estimateLimits(claudeIndex, now);
    limitsComputedAt = now;
  }
  return limitsEstimate;
}

let insightsCache = null;
let insightsComputedAt = 0;

/**
 * Insights, spend and today's totals for every provider view the dashboard can
 * filter to: all of them, and each one on this Mac alone.
 */
function insights(now) {
  if (now - insightsComputedAt > 30_000) {
    const daily = {};
    insightsCache = Object.fromEntries(['all', ...present].map((source) => {
      const index = usageIndex.scope(source);
      const computed = computeInsights({ index, agents: watcher.agents, now });
      // The days are served on their own (/api/history), not with every snapshot.
      if (computed) {
        daily[source] = computed.daily;
        delete computed.daily;
      }
      return [source, {
        insights: computed,
        spend: spendSummary(index, now),
        today: usageIndex.ready() ? activitySummary(index, watcher.agents, now) : null,
      }];
    }));
    insightsComputedAt = now;
    if (daily.all) {
      dailyFresh = daily;
      const merged = mergeHistory(history, daily, now);
      history = merged.history;
      if (merged.changed) store.write('history.json', history);
    }
  }
  return insightsCache;
}

let sessionsCache = null;

/** The Sessions page's list: rebuilt when the transcripts change, and at most every 15 seconds. */
function sessions(now) {
  const version = usageIndex.version();
  if (!sessionsCache || (sessionsCache.version !== version && now - sessionsCache.computedAt > 15_000) || now - sessionsCache.computedAt > 60_000) {
    sessionsCache = { version, computedAt: now, sessions: usageIndex.ready() ? sessionList(usageIndex, watcher.agents, now) : null };
  }
  return sessionsCache;
}

/** Re-read the transcripts and recompute limits and insights on the next snapshot. */
async function refreshLocal() {
  await usageIndex.scan();
  limitsComputedAt = 0;
  insightsComputedAt = 0;
  sessionsCache = null;
}

function snapshot() {
  const now = Date.now();
  const internCost = new Map();
  for (const a of watcher.agents.values()) {
    if (a.parentId) internCost.set(a.parentId, (internCost.get(a.parentId) || 0) + a.cost);
  }
  const list = [];
  for (const a of watcher.agents.values()) {
    const v = view(a, now);
    if (!v.present) continue;
    v.internCost = internCost.get(a.id) || 0;
    // What picks it back up, from the start (the history has it a few seconds later).
    const h = harness(a.source);
    v.resumeCommand = a.kind === 'main' && h.nativeId.test(v.nativeId || '') ? h.resume.command(v.nativeId) : null;
    list.push(v);
  }
  feed.trim();
  return {
    now,
    watching: watching.map((dir) => dir.replace(os.homedir(), '~')),
    openSessions: openSessions.latest(),
    limits: limits(now),
    // Per provider view: { all, claude, codex?, pi? }, each with insights, spend and today's totals.
    analytics: insights(now),
    codexLimits: recordedCodexLimits(usageIndex, now),
    prefs,
    agents: list,
    feed: feed.items,
  };
}

// ── HTTP ───────────────────────────────────────────────────────────────────

// Each page is a folder under web/, and all use web/shared. Only plain file
// names are served, so nothing outside those folders can be reached. The
// dashboard (web/app, built from ui/) keeps its files in assets/, with the hash
// of what's in them in their names, so they can be kept a year.
const MOUNTS = [['/office/', 'office'], ['/shared/', 'shared'], ['/', 'app']];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };

function staticFile(pathname) {
  const [prefix, dir] = MOUNTS.find(([p]) => pathname.startsWith(p)) || [];
  if (!dir) return null;
  let name = pathname.slice(prefix.length) || 'index.html';
  // The compact view for a menu bar: the dashboard's page, in its mini layout.
  if (dir === 'app' && /^mini\/?$/.test(name)) name = 'index.html';
  const type = TYPES[path.extname(name)];
  const plain = dir === 'app' ? /^(assets\/)?[\w-]+(\.[\w-]+)*$/ : /^[\w-]+(\.[\w-]+)*$/;
  return plain.test(name) && type ? [path.join(WEB_DIR, dir, name), type, dir === 'app' && name.startsWith('assets/')] : null;
}
// Set once the server is listening, for the port it got.
let ALLOWED_HOSTS = new Set();

// ── Live updates: only what changed ─────────────────────────────────────────
//
// A page gets everything when it connects, then only the parts that changed
// since the last update it had, as [path, value] pairs; web/shared/live.js puts
// them back together. The analytics are split down to each card's data, so a
// new reading of one doesn't resend the rest. Each page keeps its own record of
// what it has, so one connecting later never misses a change.

const clients = new Map(); // each open page → what it has: path → the JSON it was sent

// Costs and ratios need no more than four decimals, which trims the analytics by a good share.
const round = (key, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);
const partsCache = new WeakMap(); // an analytics object → its parts, worked out once

function analyticsParts(analytics) {
  if (!analytics) return [[['analytics'], 'null']];
  let parts = partsCache.get(analytics);
  if (!parts) {
    parts = [];
    for (const [scope, view] of Object.entries(analytics)) {
      for (const [section, value] of Object.entries(view || {})) {
        if (section === 'insights' && value) for (const [key, x] of Object.entries(value)) parts.push([['analytics', scope, 'insights', key], JSON.stringify(x, round) ?? 'null']);
        else parts.push([['analytics', scope, section], JSON.stringify(value, round) ?? 'null']);
      }
    }
    partsCache.set(analytics, parts);
  }
  return parts;
}

/** Send a page what changed since its last update. */
function sendTo(res, snap) {
  const has = clients.get(res);
  if (!has) return;
  const parts = [...Object.entries(snap).filter(([k]) => k !== 'now' && k !== 'analytics').map(([k, v]) => [[k], JSON.stringify(v) ?? 'null']), ...analyticsParts(snap.analytics)];
  const changes = [];
  for (const [path, json] of parts) {
    const key = path.join('.');
    if (has.get(key) === json) continue;
    // This replaces whatever the page had at, under or above this path.
    for (const k of has.keys()) if (k.startsWith(`${key}.`) || key.startsWith(`${k}.`)) has.delete(k);
    has.set(key, json);
    changes.push(`[${JSON.stringify(path)},${json}]`);
  }
  res.write(`data: {"now":${snap.now},"patch":1,"changes":[${changes.join(',')}]}\n\n`);
}

/** A page, with your saved settings put in before anything else runs. */
const withSettings = (html) => html.toString().replace('<!-- settings -->', settingsScript(settings));

/** A small JSON body, or null. */
async function readJson(req, limit = 4096) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

// A request that fails is answered with an error, and the server goes on.
const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    report(`${req.method} ${req.url.split('?')[0]}`, error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Overtime ran into a problem with that request');
    else res.end();
  });
});

async function handle(req, res) {
  // Refuse DNS-rebinding requests from web pages that point a domain at 127.0.0.1.
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    openSessions.tick();
    clients.set(res, new Map());
    sendTo(res, snapshot());
    req.on('close', () => clients.delete(res));
    return;
  }
  // Where the attention inbox opens a session (its Claude or Codex app link), without
  // loading its history. Read-only.
  if (url.pathname === '/api/session-target') {
    const id = url.searchParams.get('id') || '';
    const known = isSessionId(id)
      ? watcher.agents.get(id) || usageIndex.sessionRecord(id) : null;
    const target = known ? await resumeOptions({ source: known.source, nativeId: known.nativeId || nativeIdOf(id) }) : null;
    res.writeHead(target ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(target));
    return;
  }
  // One session in full, for the dashboard's session panel. Read-only.
  if (url.pathname === '/api/session') {
    const id = url.searchParams.get('id') || '';
    const detail = isSessionId(id) ? sessionDetail(usageIndex, id) : null;
    // Where it can be picked up again: Terminal, and the app it belongs to.
    if (detail) detail.resume = await resumeOptions({ source: detail.source, nativeId: detail.nativeId });
    res.writeHead(detail ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(detail));
    return;
  }
  // One of your messages in a session and what it led to: ?id=<session>&t=<any moment in it>.
  if (url.pathname === '/api/turn') {
    const id = url.searchParams.get('id') || '';
    const at = Number(url.searchParams.get('t'));
    const body = isSessionId(id) && Number.isFinite(at) ? turnDetail(usageIndex, id, at) : null;
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    return;
  }
  // Every session of the last 30 days, for the Sessions page. Read-only too.
  if (url.pathname === '/api/sessions') {
    const { computedAt, sessions: list } = sessions(Date.now());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ computedAt, sessions: list }));
    return;
  }
  // A week in review: ?week=1 for last week (the default), 0 for this one so far.
  if (url.pathname === '/api/digest') {
    const weeksAgo = url.searchParams.get('week') === '0' ? 0 : 1;
    const body = usageIndex.ready() ? weeklyDigest(usageIndex, watcher.agents, Date.now(), weeksAgo) : null;
    res.writeHead(body ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    return;
  }
  // Every day on record for one provider view, for the activity heatmap: the
  // days kept in ~/.overtime, with the last 30 from the transcripts over them.
  if (url.pathname === '/api/history') {
    const scope = present.includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all';
    if (!dailyFresh) insights(Date.now());
    const body = dailyFresh ? { scope, days: historyDays(history, dailyFresh, scope) } : null;
    res.writeHead(body ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    return;
  }
  // Search inside the conversations of the last 30 days: ?q=words or "a phrase",
  // &scope=claude|codex|pi. Read-only; off when you've turned search off.
  if (url.pathname === '/api/search') {
    const scope = present.includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all';
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
    const stats = usageIndex.searchStats();
    const found = stats.on && usageIndex.ready() ? usageIndex.search(q, { source: scope, limit }) : { terms: [], results: [], total: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ q, scope, on: stats.on, ready: usageIndex.ready(), stats, ...found }));
    return;
  }
  // Who's answering on this port: how the desktop app finds an Overtime that's already running.
  if (url.pathname === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ app: 'overtime', version: VERSION, desktop: !!process.parentPort }));
    return;
  }
  // Actions the page can take. Only this page may trigger them: a POST with a
  // custom header forces a CORS preflight that other websites can't pass.
  // Your saved settings, as the pages keep them. Read-only here; they change with a POST below.
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(settings));
    return;
  }
  const ACTIONS = ['/api/refresh', '/api/limits/exact', '/api/limits/forget', '/api/limits/codex', '/api/prefs', '/api/settings', '/api/resume', '/api/reset', '/api/commands'];
  if (ACTIONS.includes(url.pathname) && (req.method !== 'POST' || req.headers['x-overtime'] !== '1')) {
    res.writeHead(405).end('Use POST from the Overtime page');
    return;
  }
  // Re-read the transcripts now. Local only: this never contacts Anthropic.
  if (url.pathname === '/api/refresh') {
    await refreshLocal();
    res.writeHead(204).end();
    return;
  }
  // Settings the server works with, like the hour your working day starts. Saved
  // in ~/.overtime, and every open page gets them with the next snapshot.
  if (url.pathname === '/api/prefs') {
    const body = await readJson(req);
    if (!body) {
      res.writeHead(400).end('Send the settings as JSON');
      return;
    }
    const next = cleanPrefs(body, prefs);
    if (next.workdayHour !== prefs.workdayHour) {
      setWorkdayHour(next.workdayHour);
      insightsComputedAt = 0;
    }
    // Search on again reads the transcripts once more, for their text, in the background.
    if (next.search !== prefs.search) {
      usageIndex.setSearch(next.search);
      if (next.search) usageIndex.scan();
    }
    prefs = next;
    store.write('prefs.json', prefs);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(prefs));
    return;
  }
  // A page's settings changed: { set: { name: text, or null to forget it } }, or
  // { replace: { … } } to put back a saved copy. Saved in ~/.overtime/settings.json,
  // so they outlast the browser's storage.
  if (url.pathname === '/api/settings') {
    const body = await readJson(req, 2_500_000);
    const change = body?.replace ?? body?.set;
    if (!change || typeof change !== 'object') {
      res.writeHead(400).end('Send { set: { … } } or { replace: { … } } as JSON');
      return;
    }
    const next = applySettings(body.replace ? {} : settings.values, change);
    if (body.replace) next.changed = true;
    if (next.tooBig) {
      res.writeHead(413).end('Too many settings to save');
      return;
    }
    if (next.changed || !settings.initialized) {
      settings = { initialized: true, values: next.values };
      store.write('settings.json', { version: 1, values: settings.values });
    }
    res.writeHead(204).end();
    return;
  }
  // Resume a session in a new Terminal window. Only its id comes from the page:
  // the command and the folder are the session's own, from its transcript.
  if (url.pathname === '/api/resume') {
    const id = url.searchParams.get('id') || '';
    const d = isSessionId(id) ? sessionDetail(usageIndex, id) : null;
    const live = watcher.agents.get(id);
    const session = d ? { source: d.source, nativeId: d.nativeId, cwd: d.cwd } : live ? { source: live.source, nativeId: live.nativeId || nativeIdOf(id), cwd: live.cwd } : null;
    try {
      if (!session) throw new Error("Overtime doesn't know this session");
      const result = await resumeInTerminal(session, store.dir);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(422, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, message: error.message }));
    }
    return;
  }
  // Make a prompt you keep typing into a slash command: { target: 'claude' | 'codex' | 'pi',
  // name, description, body }. A new file in ~/.claude/commands, ~/.codex/prompts or
  // ~/.pi/agent/prompts, never over one that's there. The only place outside
  // ~/.overtime it writes, and only when you press Create.
  if (url.pathname === '/api/commands') {
    const body = await readJson(req, 40_000);
    const result = body ? await writeCommand(body) : { ok: false, status: 400, message: 'Send the command as JSON' };
    if (result.ok) insightsComputedAt = 0;
    res.writeHead(result.ok ? 201 : result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    return;
  }
  // Reset everything: your settings and the server's back to how they started,
  // and with { history: true } the days kept for the heatmap too. Can't be undone.
  if (url.pathname === '/api/reset') {
    const body = (await readJson(req)) || {};
    settings = { initialized: true, values: {} };
    store.write('settings.json', { version: 1, values: {} });
    const searchWasOff = !prefs.search;
    prefs = { ...DEFAULT_PREFS };
    setWorkdayHour(prefs.workdayHour);
    usageIndex.setSearch(prefs.search);
    if (searchWasOff) usageIndex.scan();
    store.write('prefs.json', prefs);
    if (body.history === true) {
      history = { version: 1, days: {} };
      store.write('history.json', history);
    }
    insightsComputedAt = 0;
    res.writeHead(204).end();
    return;
  }
  // Exact numbers were switched off: drop the login from memory.
  if (url.pathname === '/api/limits/forget') {
    forgetLogin();
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/api/limits/codex') {
    const result = await exactCodexLimits({ force: url.searchParams.get('fresh') === '1' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    return;
  }
  if (url.pathname === '/api/limits/exact') {
    // ?fresh=1 is the dashboard's Refresh button: ask Anthropic now and recompute
    // the local estimate and insights too.
    const force = url.searchParams.get('fresh') === '1';
    if (force) await refreshLocal();
    const result = await exactLimits({ force });
    // Add what each window has cost so far, from the local usage index.
    const withSpend = (w, length) => (w?.resetsAt ? { ...w, spend: windowSpend(claudeIndex, w.resetsAt - length) } : w);
    const body = result.status === 'ok'
      ? { ...result, session: withSpend(result.session, 5 * 3_600_000), weekly: withSpend(result.weekly, 7 * 86_400_000) }
      : result;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    return;
  }
  if (url.pathname === '/office') {
    res.writeHead(301, { Location: `/office/${url.search}` }).end();
    return;
  }
  const entry = staticFile(url.pathname);
  let body;
  try { body = entry && (await fsp.readFile(entry[0])); } catch {}
  if (!body) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': entry[2] ? 'public, max-age=31536000, immutable' : 'no-store' }).end(entry[0].endsWith('index.html') ? withSettings(body) : body);
}

let lastSent = 0;
setInterval(() => {
  // With no page open there's nobody to send to; a page gets everything when it connects.
  if (!clients.size) return;
  const now = Date.now();
  if (!watcher.takeDirty() && now - lastSent < 2000) return;
  lastSent = now;
  try {
    const snap = snapshot();
    for (const res of clients.keys()) sendTo(res, snap);
    openSessions.tick();
  } catch (error) {
    report('Making the live update', error);
  }
}, 250);

const started = Date.now();
({ folders: watching, sources: present } = await watcher.onThisMac());
await watcher.discover().catch((error) => report('Finding the transcripts', error));
setInterval(() => watcher.tick(), 1000);
setInterval(() => watcher.discover().catch((error) => report('Finding the transcripts', error)), 4000);
// The usage index behind the limits, spend and insights builds in the background,
// then only reads what's new, which takes a few milliseconds.
usageIndex.scan().then(() => { limitsComputedAt = 0; insightsComputedAt = 0; }, (error) => report('Reading the history', error));
setInterval(async () => {
  try {
    await usageIndex.scan();
    // A tool installed since: its folder appears, and with it its own view.
    ({ folders: watching, sources: present } = await watcher.onThisMac());
  } catch (error) {
    report('Reading the history', error);
  }
}, 15_000);

// Asked to stop (the app quitting, or Ctrl+C in a terminal): save the settings and
// days still waiting to be written first, but don't wait on that for long.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    setTimeout(() => process.exit(0), 2000).unref();
    store.flush().finally(() => process.exit(0));
  });
}

// Started by the desktop app, the server tells it how it went; from a terminal, it says so.
const tellApp = (message) => process.parentPort?.postMessage(message);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    tellApp({ type: 'in-use', port: PORT });
    console.error(`Port ${PORT} is taken. If that's Overtime already (the desktop app, or another terminal), it's at http://localhost:${PORT}. Or start this one elsewhere with PORT=4778 npm start.`);
  } else {
    tellApp({ type: 'error', message: error.message });
    console.error(`Overtime couldn't start: ${error.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const port = server.address().port;
  ALLOWED_HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  tellApp({ type: 'listening', port });
  console.log(`Overtime is open at http://localhost:${port} (the pixel office is at /office/)`);
  console.log(`Watching ${watching.length > 1 ? `${watching.slice(0, -1).join(', ')} and ${watching.at(-1)}` : watching[0]} (read-only). Loaded ${watcher.agents.size} sessions in ${Date.now() - started} ms.`);
  try {
    const { agents } = snapshot();
    console.log(`${agents.length} agent${agents.length === 1 ? '' : 's'} in the office right now.`);
  } catch (error) {
    report('Making the first update', error);
  }
});
