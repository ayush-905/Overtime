// The server's HTTP API, end to end, on the fixture transcripts. Everything it
// could read or write outside its scratch folder points into it too: HOME, the
// Claude Code, Codex and Pi folders, and Codex itself (a stand-in that answers
// the app server's handshake). /api/limits/exact is never asked for real, since
// that reads the Keychain and contacts Anthropic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMerger } from '../web/shared/live.js';
import { scratch, startServer } from './helpers.js';
import { CLAUDE, CODEX, PI, layFixtures } from './fixtures/index.js';

const ACTIONS = [
  '/api/refresh',
  '/api/limits/exact',
  '/api/limits/forget',
  '/api/limits/codex',
  '/api/prefs',
  '/api/settings',
  '/api/resume',
  '/api/reset',
  '/api/commands',
];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stand-in for Codex's app server: answers the handshake, the account and its plan windows, and notes each start. */
async function fakeCodex(dir, log) {
  const script = path.join(dir, 'fake-codex.mjs');
  const resets = Math.floor(Date.now() / 1000) + 3600;
  await writeFile(
    script,
    `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 0) send({ id: 0, result: {} });
  else if (m.id === 1) send({ id: 1, result: { account: { type: 'chatgpt', email: 'baker@example.com', planType: 'plus' } } });
  else if (m.id === 2) send({ id: 2, result: { rateLimits: { primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: ${resets} }, secondary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: ${resets + 86_400} } } } });
});
`,
  );
  await mkdir(path.join(dir, 'bin'));
  const bin = path.join(dir, 'bin', 'codex');
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return bin;
}

/**
 * The server on the fixtures, with its own HOME and agent folders in scratch,
 * once its history is read. `history` is put in its data folder first.
 */
async function start(t, { history } = {}) {
  const dir = await scratch(t, 'overtime-api-');
  const { clock } = await layFixtures({
    claude: path.join(dir, 'claude'),
    codex: path.join(dir, 'codex'),
    pi: path.join(dir, 'pi'),
  });
  const home = path.join(dir, 'home');
  await mkdir(home);
  if (history) {
    await mkdir(path.join(dir, 'data'));
    await writeFile(path.join(dir, 'data', 'history.json'), JSON.stringify(history));
  }
  const codexLog = path.join(dir, 'codex-starts.log');
  const env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CODEX_HOME: path.join(home, '.codex'),
    PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent'),
    CODEX_BIN: await fakeCodex(dir, codexLog),
  };
  // startServer gives the server this process's environment, with its own folders over it.
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  let server;
  try {
    server = await startServer(t, dir, 0);
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.ok(server.port, `the server started: ${server.out || ''}`);
  const base = `http://127.0.0.1:${server.port}`;
  const get = (route) => fetch(base + route);
  const post = (route, body, headers = { 'X-Overtime': '1' }) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const json = async (res) => [res.status, res.status === 204 ? null : await res.json()];
  // Its history reads in the background after it starts.
  for (let i = 0; ; i++) {
    const { ready } = await (await get('/api/search?q=x')).json();
    if (ready) break;
    assert.ok(i < 100, 'the history was read in time');
    await wait(100);
  }
  return { dir, env, base, clock, get, post, json, codexLog };
}

/** The first message on the live feed, put together as the page does. */
async function firstSnapshot(t, base) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(`${base}/events`, { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!buffer.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('the feed ended');
    buffer += decoder.decode(value, { stream: true });
  }
  controller.abort();
  const block = buffer.slice(0, buffer.indexOf('\n\n'));
  assert.ok(block.startsWith('data: '));
  const msg = JSON.parse(block.slice(6));
  return { msg, snap: createMerger()(msg) };
}

test('the read-only routes: sessions, one session, one turn, the digest, the history, search, settings and hello', async (t) => {
  const { get, json, clock } = await start(t);

  let [status, body] = await json(await get('/api/sessions'));
  assert.equal(status, 200);
  assert.equal(typeof body.computedAt, 'number');
  assert.deepEqual(
    body.sessions.map((s) => s.id).sort(),
    [
      ...Object.values(CLAUDE).filter((id) => id !== CLAUDE.sub),
      `codex-${CODEX.main}`,
      `codex-${CODEX.second}`,
      `pi-${PI.main}`,
      `pi-${PI.fork}`,
    ].sort(),
  );
  const row = body.sessions.find((s) => s.id === CLAUDE.turn);
  assert.deepEqual(
    [row.source, row.title, row.project, row.model],
    ['claude', 'Fix croissant count on order page', 'bakery', 'Sonnet 4.5'],
  );
  assert.ok(Array.isArray(row.days) && row.days.length >= 1);

  [status, body] = await json(await get(`/api/session?id=${CLAUDE.delegate}`));
  assert.equal(status, 200);
  assert.deepEqual(
    [body.id, body.source, body.subagents.count, body.messages.count],
    [CLAUDE.delegate, 'claude', 1, 1],
  );
  assert.deepEqual([body.resume.terminal, body.resume.command], [true, `claude --resume ${CLAUDE.delegate}`]);
  [status, body] = await json(await get(`/api/session?id=codex-${CODEX.main}`));
  assert.deepEqual(
    [status, body.title, body.resume.command],
    [200, 'Grams on loaf labels', `codex resume ${CODEX.main}`],
  );
  [status, body] = await json(await get(`/api/session?id=pi-${PI.main}`));
  assert.deepEqual([status, body.title, body.resume.command], [200, 'Gluten-free badge', `pi --session ${PI.main}`]);
  for (const id of ['', 'nope', 'a1000000-0000-4000-8000-0000000000ff', `codex-${CLAUDE.turn}`]) {
    assert.equal((await get(`/api/session?id=${id}`)).status, 404, id);
  }

  [status, body] = await json(await get(`/api/session-target?id=${CLAUDE.turn}`));
  assert.deepEqual([status, body.terminal, body.command], [200, true, `claude --resume ${CLAUDE.turn}`]);
  assert.equal((await get('/api/session-target?id=nope')).status, 404);

  [status, body] = await json(await get(`/api/turn?id=${CLAUDE.turn}&t=${clock('09:00:30')}`));
  assert.equal(status, 200);
  assert.equal(body.text, 'The croissant count on the order page is off by one. Can you fix it and run the tests?');
  assert.deepEqual(
    body.commands.map((c) => c.status),
    ['error', 'ok'],
  );
  assert.equal((await get(`/api/turn?id=${CLAUDE.turn}&t=soon`)).status, 404);
  assert.equal((await get(`/api/turn?id=nope&t=${clock('09:00:30')}`)).status, 404);

  [status, body] = await json(await get('/api/digest'));
  assert.deepEqual([status, body.weeksAgo, body.days], [200, 1, 7]);
  [status, body] = await json(await get('/api/digest?week=0'));
  assert.equal(status, 200);
  assert.equal(body.weeksAgo, 0);
  assert.ok(body.sessions > 0 && body.cost > 0);
  assert.deepEqual(Object.keys(body.bySource).sort(), ['claude', 'codex', 'pi']);

  [status, body] = await json(await get('/api/history'));
  assert.equal(status, 200);
  assert.equal(body.scope, 'all');
  assert.ok(body.days.length >= 30);
  assert.ok(body.days.at(-1).cost > 0, 'today has the fixtures in it');
  assert.equal((await (await get('/api/history?scope=pi')).json()).scope, 'pi');
  assert.equal((await (await get('/api/history?scope=elsewhere')).json()).scope, 'all');

  [status, body] = await json(await get('/api/search?q=croissant'));
  assert.equal(status, 200);
  assert.deepEqual([body.q, body.scope, body.on, body.ready], ['croissant', 'all', true, true]);
  assert.deepEqual(
    body.results.map((r) => r.session),
    [CLAUDE.turn],
  );
  assert.ok(body.stats.messages > 0);
  assert.deepEqual((await (await get('/api/search?q=croissant&scope=codex')).json()).results, []);
  assert.deepEqual((await (await get('/api/search?q=')).json()).results, []);

  [status, body] = await json(await get('/api/settings'));
  assert.deepEqual([status, body], [200, { initialized: false, values: {} }]);
  [status, body] = await json(await get('/api/hello'));
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual([status, body], [200, { app: 'overtime', version, desktop: false }]);
});

test('a turn asked for without a time is not found', async (t) => {
  const { get } = await start(t);
  assert.equal((await get(`/api/turn?id=${CLAUDE.turn}`)).status, 404);
});

test('every action needs a POST with the X-Overtime header from the page, and anything else gets 405', async (t) => {
  const { get, post } = await start(t);
  for (const route of ACTIONS) {
    if (route !== '/api/settings') assert.equal((await get(route)).status, 405, `GET ${route}`);
    assert.equal((await post(route, {}, {})).status, 405, `POST ${route} without the header`);
    assert.equal((await post(route, {}, { 'X-Overtime': '0' })).status, 405, `POST ${route} with the wrong header`);
  }
  // The ones that are safe to do here, done properly.
  assert.equal((await post('/api/refresh')).status, 204);
  assert.equal((await post('/api/limits/forget')).status, 204);
  // Resuming opens Terminal, so only a session it doesn't know is tried: that's refused.
  const res = await post('/api/resume?id=a1000000-0000-4000-8000-0000000000ff');
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { ok: false, message: "Overtime doesn't know this session" });
});

test('/api/prefs moves the start of the working day, a bad value keeps the one before, and search can be turned off and on', async (t) => {
  const { dir, post, get, json, base } = await start(t);
  assert.deepEqual(await json(await post('/api/prefs', { workdayHour: 6 })), [200, { workdayHour: 6, search: true }]);
  for (const bad of [{ workdayHour: 99 }, { workdayHour: 2.5 }, { workdayHour: null }, { workdayHour: 'dawn' }]) {
    assert.deepEqual(
      await json(await post('/api/prefs', bad)),
      [200, { workdayHour: 6, search: true }],
      JSON.stringify(bad),
    );
  }
  assert.equal((await post('/api/prefs', 'not json')).status, 400);
  // The next update has it, and the hours are worked out from it.
  const { snap } = await firstSnapshot(t, base);
  assert.deepEqual(snap.prefs, { workdayHour: 6, search: true });
  assert.equal(new Date(snap.analytics.all.insights.hours.days.at(-1).start).getHours(), 6);
  // And it's saved, a moment later.
  for (let i = 0; i < 40 && !(await stat(path.join(dir, 'data', 'prefs.json')).catch(() => null)); i++) await wait(100);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'data', 'prefs.json'), 'utf8')), {
    workdayHour: 6,
    search: true,
  });

  // Search off forgets the conversations' text; on again reads it back.
  assert.deepEqual(await json(await post('/api/prefs', { search: false })), [200, { workdayHour: 6, search: false }]);
  let found = await (await get('/api/search?q=croissant')).json();
  assert.deepEqual([found.on, found.results, found.stats.messages], [false, [], 0]);
  await post('/api/prefs', { search: true });
  for (let i = 0; i < 50; i++) {
    found = await (await get('/api/search?q=croissant')).json();
    if (found.results.length) break;
    await wait(100);
  }
  assert.deepEqual([found.on, found.results.map((r) => r.session)], [true, [CLAUDE.turn]]);
});

test("/api/settings keeps the dashboard's own settings: set, forget, replace, and 413 when there are too many", async (t) => {
  const { post, get, json } = await start(t);
  const saved = async () => (await get('/api/settings')).json();
  assert.equal(
    (await post('/api/settings', { set: { 'overtime-theme': 'dark', 'overtime-page': 'cost', 'not-ours': 'x' } }))
      .status,
    204,
  );
  // Where you were last stays with each browser, and anything not the dashboard's is left out.
  assert.deepEqual(await saved(), { initialized: true, values: { 'overtime-theme': 'dark' } });
  await post('/api/settings', { set: { 'overtime-clock': '24h' } });
  await post('/api/settings', { set: { 'overtime-theme': null } });
  assert.deepEqual((await saved()).values, { 'overtime-clock': '24h' });
  await post('/api/settings', { replace: { 'overtime-theme': 'light', 'overtime-density': 'compact' } });
  assert.deepEqual((await saved()).values, { 'overtime-theme': 'light', 'overtime-density': 'compact' });

  // Over 2 MB in all, though each one is small enough: refused, and nothing changes.
  const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`overtime-big-${i}`, 'x'.repeat(190_000)]));
  const res = await post('/api/settings', { set: many });
  assert.equal(res.status, 413);
  assert.deepEqual((await saved()).values, { 'overtime-theme': 'light', 'overtime-density': 'compact' });
  assert.equal((await post('/api/settings', {})).status, 400);
  assert.equal((await post('/api/settings', 'nope')).status, 400);
  // The page gets them before anything else runs.
  const page = await (await get('/')).text();
  assert.ok(page.includes('"overtime-density":"compact"'));
  assert.deepEqual(await json(await post('/api/prefs', {})), [200, { workdayHour: 4, search: true }]);
});

test('/api/reset puts settings and prefs back, and with history: true forgets the days kept for the heatmap too', async (t) => {
  const kept = new Date();
  kept.setHours(0, 0, 0, 0);
  kept.setDate(kept.getDate() - 40);
  const key = `${kept.getFullYear()}-${String(kept.getMonth() + 1).padStart(2, '0')}-${String(kept.getDate()).padStart(2, '0')}`;
  const { post, get, json } = await start(t, {
    history: {
      version: 1,
      days: { [key]: { all: { cost: 9, tokens: 1000, messages: 3, activeMs: 0, agentMs: 0, sessions: 1 } } },
    },
  });
  const keptDay = async () => (await (await get('/api/history')).json()).days.find((d) => d.day === kept.getTime());
  assert.deepEqual([(await keptDay())?.cost, (await keptDay())?.kept], [9, true]);

  await post('/api/settings', { set: { 'overtime-theme': 'dark' } });
  await post('/api/prefs', { workdayHour: 8, search: false });
  assert.equal((await post('/api/reset', {})).status, 204);
  assert.deepEqual(await (await get('/api/settings')).json(), { initialized: true, values: {} });
  assert.deepEqual(await json(await post('/api/prefs', {})), [200, { workdayHour: 4, search: true }]);
  assert.equal((await keptDay())?.cost, 9, 'the kept days stay without history: true');
  // Search came back on, and reads the conversations again.
  let found;
  for (let i = 0; i < 50; i++) {
    found = await (await get('/api/search?q=croissant')).json();
    if (found.results.length) break;
    await wait(100);
  }
  assert.deepEqual(
    found.results.map((r) => r.session),
    [CLAUDE.turn],
  );

  assert.equal((await post('/api/reset', { history: true })).status, 204);
  assert.equal(await keptDay(), undefined);
});

test('/api/commands writes a new command file where each agent looks for them, and never over one that is there', async (t) => {
  const { post, env } = await start(t);
  const command = {
    target: 'claude',
    name: 'proof-the-dough',
    description: 'Check the dough has risen',
    body: 'Check whether the dough in $ARGUMENTS has doubled.',
  };
  let res = await post('/api/commands', command);
  assert.equal(res.status, 201);
  let body = await res.json();
  assert.deepEqual(
    [body.ok, body.file, body.use],
    [true, path.join(env.CLAUDE_CONFIG_DIR, 'commands', 'proof-the-dough.md'), '/proof-the-dough'],
  );
  const text = await readFile(body.file, 'utf8');
  assert.equal(
    text,
    '---\ndescription: "Check the dough has risen"\nargument-hint: "[what changes each time]"\n---\n\nCheck whether the dough in $ARGUMENTS has doubled.\n',
  );

  res = await post('/api/commands', { ...command, body: 'Something else entirely.' });
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /already a command called proof-the-dough/);
  assert.equal(await readFile(path.join(env.CLAUDE_CONFIG_DIR, 'commands', 'proof-the-dough.md'), 'utf8'), text);

  body = await (await post('/api/commands', { ...command, target: 'codex' })).json();
  assert.deepEqual(
    [body.file, body.use],
    [path.join(env.CODEX_HOME, 'prompts', 'proof-the-dough.md'), '/prompts:proof-the-dough'],
  );
  body = await (await post('/api/commands', { ...command, target: 'pi' })).json();
  assert.deepEqual(
    [body.file, body.use],
    [path.join(env.PI_CODING_AGENT_DIR, 'prompts', 'proof-the-dough.md'), '/proof-the-dough'],
  );

  for (const bad of [
    { ...command, target: 'emacs' },
    { ...command, name: 'Proof The Dough!' },
    { ...command, body: '  ' },
  ]) {
    assert.equal((await post('/api/commands', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await post('/api/commands', 'not json')).status, 400);
});

test("/api/limits/codex asks the installed Codex for the plan's windows, once a minute at most, and never says who you are", async (t) => {
  const { post, codexLog } = await start(t);
  const res = await post('/api/limits/codex');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.deepEqual(
    body.windows.map((w) => [w.kind, w.usedPercent, w.durationMs]),
    [
      ['primary', 30, 5 * 3_600_000],
      ['secondary', 8, 7 * 86_400_000],
    ],
  );
  assert.match(body.accountId, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(body).includes('baker@example.com'));
  await post('/api/limits/codex');
  await post('/api/limits/codex?fresh=1');
  assert.deepEqual((await readFile(codexLog, 'utf8')).trim().split('\n'), [
    'app-server --listen stdio:// -c analytics.enabled=false',
  ]);
});

test('the first message on /events has the agents in the office, the analytics, the limits and the rest', async (t) => {
  const { base } = await start(t);
  const { msg, snap } = await firstSnapshot(t, base);
  assert.equal(msg.patch, 1);
  assert.equal(typeof msg.now, 'number');
  for (const key of ['watching', 'openSessions', 'limits', 'analytics', 'codexLimits', 'prefs', 'agents', 'feed'])
    assert.ok(key in snap, key);
  assert.equal(snap.watching.length, 3);
  assert.deepEqual(snap.prefs, { workdayHour: 4, search: true });
  assert.equal(snap.limits.source, 'estimate');

  // In the office: the agents active in the last half hour; the ones from an hour ago have gone home.
  const ids = snap.agents.map((a) => a.id);
  for (const id of [CLAUDE.delegate, CLAUDE.extras, `pi-${PI.main}`, `pi-${PI.fork}`])
    assert.ok(ids.includes(id), `${id} is in the office`);
  for (const id of [CLAUDE.turn, `codex-${CODEX.main}`]) assert.ok(!ids.includes(id), `${id} has gone home`);
  const pi = snap.agents.find((a) => a.id === `pi-${PI.fork}`);
  assert.deepEqual([pi.status, pi.tool.name, pi.resumeCommand], ['working', 'read', `pi --session ${PI.fork}`]);
  assert.ok(snap.feed.some((x) => x.agentId === `pi-${PI.fork}`));

  // A view for every source with a folder here, each with its insights, spend and today's totals.
  assert.deepEqual(Object.keys(snap.analytics).sort(), ['all', 'claude', 'codex', 'pi']);
  const all = snap.analytics.all;
  assert.ok(all.insights?.timeline && all.insights?.breakdown, 'insights');
  assert.ok(all.spend.today.cost > 0, 'spend');
  assert.ok(all.today.sessions > 0, "today's totals");
  assert.equal(all.insights.daily, undefined, 'the days come from /api/history instead');
  // The Codex plan windows as last reported, by whichever session reported last.
  assert.equal(snap.codexLimits.status, 'ok');
  assert.deepEqual(
    snap.codexLimits.windows.map((w) => [w.kind, w.usedPercent]),
    [
      ['primary', 17],
      ['secondary', 5],
    ],
  );
});
