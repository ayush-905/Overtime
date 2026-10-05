#!/usr/bin/env node
// @ts-check
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
import {
  computeInsights,
  sessionDetail,
  sessionList,
  activitySummary,
  weeklyDigest,
  setWorkdayHour,
  turnDetail,
} from './lib/insights.js';
import { exactCodexLimits, recordedCodexLimits } from './lib/codex-limits.js';
import { createSessionMonitor } from './lib/open-sessions.js';
import {
  createStore,
  cleanPrefs,
  mergeHistory,
  historyDays,
  applySettings,
  settingsScript,
  DEFAULT_PREFS,
} from './lib/store.js';
import { resumeOptions, resumeInTerminal } from './lib/resume.js';
import { writeCommand } from './lib/prompts.js';
import { harness, isSessionId, nativeIdOf, openHarnesses } from './lib/harnesses/index.js';
import { watchFolders } from './lib/folder-watch.js';
import { createLiveFeed } from './lib/live-feed.js';
import { serveFile } from './lib/static-files.js';

// Set when the desktop app started this server in a utility process of its own (Electron adds it).
const parentPort = /** @type {{ parentPort?: { postMessage(message: unknown): void } }} */ (
  /** @type {unknown} */ (process)
).parentPort;

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
/** @type {Record<string, import('./types/api.js').DailyTotal[]> | null} */
let dailyFresh = null; // the last 30 days from the transcripts, per provider view
/** @type {string[]} */
let watching = [];
/** @type {string[]} */
let present = ['claude']; // the sources with a folder on this Mac, each a view of its own
/** @type {import('./types/api.js').LimitsEstimate | null} */
let limitsEstimate = null;
let limitsComputedAt = 0;

function limits(now) {
  if (now - limitsComputedAt > 15_000) {
    limitsEstimate = estimateLimits(claudeIndex, now);
    limitsComputedAt = now;
  }
  return limitsEstimate;
}

/** @type {import('./types/api.js').Analytics | null} */
let insightsCache = null;
let insightsComputedAt = 0;
let insightsFrom = ''; // what the last pass was worked out from: the transcripts' version and the views

/**
 * Insights, spend and today's totals for every provider view the dashboard can
 * filter to: all of them, and each one on this Mac alone. Worked out again every
 * 30 seconds at most, and only when a transcript has moved since, or every two
 * minutes for what changes with the time alone (today's start, the last 7 days).
 */
function insights(now) {
  const from = `${usageIndex.version()} ${present.join(' ')}`;
  const age = now - insightsComputedAt;
  if (age > 120_000 || (age > 30_000 && from !== insightsFrom)) {
    insightsFrom = from;
    /** @type {Record<string, import('./types/api.js').DailyTotal[]>} */
    const daily = {};
    insightsCache = /** @type {import('./types/api.js').Analytics} */ (
      Object.fromEntries(
        ['all', ...present].map((source) => {
          const index = usageIndex.scope(source);
          const computed = computeInsights({ index, agents: watcher.agents, now });
          // The days are served on their own (/api/history), not with every snapshot.
          /** @type {import('./types/api.js').Insights | null} */
          let sent = null;
          if (computed) {
            const { daily: days, ...rest } = computed;
            daily[source] = days;
            sent = rest;
          }
          return [
            source,
            {
              insights: sent,
              spend: spendSummary(index, now),
              today: usageIndex.ready() ? activitySummary(index, watcher.agents, now) : null,
            },
          ];
        }),
      )
    );
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

/** @type {{ version: number, computedAt: number, sessions: import('./types/api.js').SessionListItem[] | null } | null} */
let sessionsCache = null;

/**
 * The Sessions page's list: rebuilt when the transcripts change, at most every 15
 * seconds, and as soon as the history has been read if it was asked for before.
 */
/** @returns {{ version: number, computedAt: number, sessions: import('./types/api.js').SessionListItem[] | null }} */
function sessions(now) {
  const version = usageIndex.version();
  if (
    !sessionsCache ||
    (!sessionsCache.sessions && usageIndex.ready()) ||
    (sessionsCache.version !== version && now - sessionsCache.computedAt > 15_000) ||
    now - sessionsCache.computedAt > 60_000
  ) {
    sessionsCache = {
      version,
      computedAt: now,
      sessions: usageIndex.ready() ? sessionList(usageIndex, watcher.agents, now) : null,
    };
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
  /** @type {import('./types/api.js').Agent[]} */
  const list = [];
  for (const a of watcher.agents.values()) {
    const v = view(a, now);
    if (!v.present) continue;
    // What picks it back up, from the start (the history has it a few seconds later).
    const h = harness(a.source);
    const resumeCommand = a.kind === 'main' && h.nativeId.test(v.nativeId || '') ? h.resume.command(v.nativeId) : null;
    list.push({ ...v, internCost: internCost.get(a.id) || 0, resumeCommand });
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

// The pages following the live feed (/events), each sent only what changed (lib/live-feed.js).
const live = createLiveFeed();

// Set once the server is listening, for the port it got.
let ALLOWED_HOSTS = new Set();

/** A page, with your saved settings put in before anything else runs. */
const withSettings = (html) => html.toString().replace('<!-- settings -->', settingsScript(settings));

/** A small JSON body, or null. */
async function readJson(req, limit = 4096) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Answer with JSON, never kept, so the page reads it fresh each time. */
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

/** The provider view a request asks for (&scope=claude|codex|pi), if it's on this Mac, else all of them. */
const scopeOf = (url) => (present.includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'all');

/**
 * Every address besides the pages' files, and what answers it, given the
 * request, the response and the parsed address ({ req, res, url }). A `read`
 * changes nothing and answers whatever the method (the pages GET them). An
 * `action` changes something, so only the Overtime page may trigger one: it
 * answers only a POST with the X-Overtime header, which forces a CORS preflight
 * that other websites can't pass. An address with both is read with a GET.
 */
const ROUTES = {
  // The live feed: everything when a page connects, then only what changes.
  '/events': {
    read({ req, res }) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      openSessions.tick();
      live.open(res);
      live.send(res, snapshot());
      req.on('close', () => live.close(res));
    },
  },
  // Where the attention inbox opens a session (its Claude or Codex app link), without
  // loading its history.
  '/api/session-target': {
    async read({ res, url }) {
      const id = url.searchParams.get('id') || '';
      const known = isSessionId(id) ? watcher.agents.get(id) || usageIndex.sessionRecord(id) : null;
      const target = known
        ? await resumeOptions({ source: known.source, nativeId: known.nativeId || nativeIdOf(id) })
        : null;
      json(res, target ? 200 : 404, target);
    },
  },
  // One session in full, for the dashboard's session panel.
  '/api/session': {
    async read({ res, url }) {
      const id = url.searchParams.get('id') || '';
      const detail = isSessionId(id) ? sessionDetail(usageIndex, id) : null;
      // Where it can be picked up again: Terminal, and the app it belongs to.
      /** @type {import('./types/api.js').SessionResponse | null} */
      const body = detail && {
        ...detail,
        resume: await resumeOptions({ source: detail.source, nativeId: detail.nativeId }),
      };
      json(res, body ? 200 : 404, body);
    },
  },
  // One of your messages in a session and what it led to: ?id=<session>&t=<any moment in it>.
  '/api/turn': {
    read({ res, url }) {
      const id = url.searchParams.get('id') || '';
      // Without a time there's no turn to find (Number(null) would be the first).
      const at = url.searchParams.get('t') ? Number(url.searchParams.get('t')) : NaN;
      const body = isSessionId(id) && Number.isFinite(at) ? turnDetail(usageIndex, id, at) : null;
      json(res, body ? 200 : 404, body);
    },
  },
  // Every session of the last 30 days, for the Sessions page.
  '/api/sessions': {
    read({ res }) {
      const { computedAt, sessions: list } = sessions(Date.now());
      json(res, 200, { computedAt, sessions: list });
    },
  },
  // A week in review: ?week=1 for last week (the default), 0 for this one so far.
  '/api/digest': {
    read({ res, url }) {
      const weeksAgo = url.searchParams.get('week') === '0' ? 0 : 1;
      const body = usageIndex.ready() ? weeklyDigest(usageIndex, watcher.agents, Date.now(), weeksAgo) : null;
      json(res, body ? 200 : 503, body);
    },
  },
  // Every day on record for one provider view, for the activity heatmap: the
  // days kept in ~/.overtime, with the last 30 from the transcripts over them.
  '/api/history': {
    read({ res, url }) {
      const scope = scopeOf(url);
      if (!dailyFresh) insights(Date.now());
      const body = dailyFresh ? { scope, days: historyDays(history, dailyFresh, scope) } : null;
      json(res, body ? 200 : 503, body);
    },
  },
  // Search inside the conversations of the last 30 days: ?q=words or "a phrase",
  // &scope=claude|codex|pi. Off when you've turned search off.
  '/api/search': {
    read({ res, url }) {
      const scope = scopeOf(url);
      const q = (url.searchParams.get('q') || '').slice(0, 200);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
      const stats = usageIndex.searchStats();
      const found =
        stats.on && usageIndex.ready()
          ? usageIndex.search(q, { source: scope, limit })
          : { terms: [], results: [], total: 0 };
      json(res, 200, { q, scope, on: stats.on, ready: usageIndex.ready(), stats, ...found });
    },
  },
  // Who's answering on this port: how the desktop app finds an Overtime that's already running.
  '/api/hello': {
    read({ res }) {
      json(res, 200, { app: 'overtime', version: VERSION, desktop: !!parentPort });
    },
  },
  '/api/settings': {
    // Your saved settings, as the pages keep them.
    read({ res }) {
      json(res, 200, settings);
    },
    // A page's settings changed: { set: { name: text, or null to forget it } }, or
    // { replace: { … } } to put back a saved copy. Saved in ~/.overtime/settings.json,
    // so they outlast the browser's storage.
    async action({ req, res }) {
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
    },
  },
  // Re-read the transcripts now. Local only: this never contacts Anthropic.
  '/api/refresh': {
    async action({ res }) {
      await refreshLocal();
      res.writeHead(204).end();
    },
  },
  // Settings the server works with, like the hour your working day starts. Saved
  // in ~/.overtime, and every open page gets them with the next snapshot.
  '/api/prefs': {
    async action({ req, res }) {
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
      json(res, 200, prefs);
    },
  },
  // Resume a session in a new Terminal window. Only its id comes from the page:
  // the command and the folder are the session's own, from its transcript.
  '/api/resume': {
    async action({ res, url }) {
      const id = url.searchParams.get('id') || '';
      const d = isSessionId(id) ? sessionDetail(usageIndex, id) : null;
      const known = watcher.agents.get(id);
      const session = d
        ? { source: d.source, nativeId: d.nativeId, cwd: d.cwd }
        : known
          ? { source: known.source, nativeId: known.nativeId || nativeIdOf(id), cwd: known.cwd }
          : null;
      try {
        if (!session) throw new Error("Overtime doesn't know this session");
        const result = await resumeInTerminal(session, store.dir);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        res
          .writeHead(422, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ok: false, message: error.message }));
      }
    },
  },
  // Make a prompt you keep typing into a slash command: { target: 'claude' | 'codex' | 'pi',
  // name, description, body }. A new file in ~/.claude/commands, ~/.codex/prompts or
  // ~/.pi/agent/prompts, never over one that's there. The only place outside
  // ~/.overtime it writes, and only when you press Create.
  '/api/commands': {
    async action({ req, res }) {
      const body = await readJson(req, 40_000);
      const result = body ? await writeCommand(body) : { ok: false, status: 400, message: 'Send the command as JSON' };
      if (result.ok) insightsComputedAt = 0;
      res
        .writeHead(result.ok ? 201 : result.status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(result));
    },
  },
  // Reset everything: your settings and the server's back to how they started,
  // and with { history: true } the days kept for the heatmap too. Can't be undone.
  '/api/reset': {
    async action({ req, res }) {
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
    },
  },
  // Exact numbers were switched off: drop the login from memory.
  '/api/limits/forget': {
    action({ res }) {
      forgetLogin();
      res.writeHead(204).end();
    },
  },
  '/api/limits/codex': {
    async action({ res, url }) {
      const result = await exactCodexLimits({ force: url.searchParams.get('fresh') === '1' });
      json(res, 200, result);
    },
  },
  '/api/limits/exact': {
    async action({ res, url }) {
      // ?fresh=1 is the dashboard's Refresh button: ask Anthropic now and recompute
      // the local estimate and insights too.
      const force = url.searchParams.get('fresh') === '1';
      if (force) await refreshLocal();
      const result = await exactLimits({ force });
      // Add what each window has cost so far, from the local usage index.
      const withSpend = (w, length) =>
        w?.resetsAt ? { ...w, spend: windowSpend(claudeIndex, w.resetsAt - length) } : w;
      const body =
        result.status === 'ok'
          ? {
              ...result,
              session: withSpend(result.session, 5 * 3_600_000),
              weekly: withSpend(result.weekly, 7 * 86_400_000),
            }
          : result;
      json(res, 200, body);
    },
  },
  '/office': {
    read({ res, url }) {
      res.writeHead(301, { Location: `/office/${url.search}` }).end();
    },
  },
};

// A request that fails is answered with an error, and the server goes on.
const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    report(`${req.method} ${String(req.url).split('?')[0]}`, error);
    if (!res.headersSent)
      res
        .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Overtime ran into a problem with that request');
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
  const route = ROUTES[url.pathname];
  // Anything else is one of the pages' files.
  if (!route) return serveFile(res, WEB_DIR, url.pathname, withSettings);
  if (route.action && req.method === 'POST' && req.headers['x-overtime'] === '1')
    return route.action({ req, res, url });
  if (route.read && (!route.action || req.method === 'GET')) return route.read({ req, res, url });
  res.writeHead(405).end('Use POST from the Overtime page');
}

let lastSent = 0;
setInterval(() => {
  // With no page open there's nobody to send to; a page gets everything when it connects.
  if (!live.size) return;
  const now = Date.now();
  if (!watcher.takeDirty() && now - lastSent < 2000) return;
  lastSent = now;
  try {
    live.sendAll(snapshot());
    openSessions.tick();
  } catch (error) {
    report('Making the live update', error);
  }
}, 250);

// Looking for new transcripts (every 4 seconds) and reading the history (every 15)
// only happen when something under the transcripts' folders changed since, which
// the system's file events say, or after a minute or five anyway, for anything they
// missed. Without file events, every time, as the folders can't say.
const due = { discover: true, scan: true };
const folderWatch = watchFolders(() => {
  due.discover = true;
  due.scan = true;
});

function whenChanged(name, slowMs, job) {
  let last = Date.now();
  return async () => {
    const now = Date.now();
    if (folderWatch.ok && !due[name] && now - last < slowMs) return;
    due[name] = false;
    last = now;
    await job();
  };
}

const started = Date.now();
({ folders: watching, sources: present } = await watcher.onThisMac());
folderWatch.set(watching);
await watcher.discover().catch((error) => report('Finding the transcripts', error));
setInterval(() => watcher.tick(), 1000);
const discover = whenChanged('discover', 60_000, () => watcher.discover());
setInterval(() => discover().catch((error) => report('Finding the transcripts', error)), 4000);
// The usage index behind the limits, spend and insights builds in the background,
// then only reads what's new, which takes a few milliseconds.
usageIndex.scan().then(
  () => {
    limitsComputedAt = 0;
    insightsComputedAt = 0;
  },
  (error) => report('Reading the history', error),
);
const scan = whenChanged('scan', 5 * 60_000, () => usageIndex.scan());
setInterval(async () => {
  try {
    await scan();
    // A tool installed since: its folder appears, and with it its own view.
    ({ folders: watching, sources: present } = await watcher.onThisMac());
    folderWatch.set(watching);
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
const tellApp = (message) => parentPort?.postMessage(message);

server.on('error', (/** @type {NodeJS.ErrnoException} */ error) => {
  if (error.code === 'EADDRINUSE') {
    tellApp({ type: 'in-use', port: PORT });
    console.error(
      `Port ${PORT} is taken. If that's Overtime already (the desktop app, or another terminal), it's at http://localhost:${PORT}. Or start this one elsewhere with PORT=4778 npm start.`,
    );
  } else {
    tellApp({ type: 'error', message: error.message });
    console.error(`Overtime couldn't start: ${error.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  ALLOWED_HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  tellApp({ type: 'listening', port });
  console.log(`Overtime is open at http://localhost:${port} (the pixel office is at /office/)`);
  console.log(
    `Watching ${watching.length > 1 ? `${watching.slice(0, -1).join(', ')} and ${watching.at(-1)}` : watching[0]} (read-only). Loaded ${watcher.agents.size} sessions in ${Date.now() - started} ms.`,
  );
  try {
    const { agents } = snapshot();
    console.log(`${agents.length} agent${agents.length === 1 ? '' : 's'} in the office right now.`);
  } catch (error) {
    report('Making the first update', error);
  }
});
