// Open agent sessions: the processes `ps` lists, matched to their sessions, with
// what they and the tools they started use. `ps` and `lsof` here are made up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionMonitor } from '../lib/open-sessions.js';

const BAKERY = '/Users/sam/work/bakery';
const DIR = '-Users-sam-work-bakery';
const START = Date.parse('2026-03-02T10:00:00.000Z');
const at = (clock) => Date.parse(`2026-03-02T${clock}.000Z`);
const ID = {
  resumed: 'a1000000-0000-4000-8000-000000000001',
  older: 'a1000000-0000-4000-8000-000000000002',
  stale: 'a1000000-0000-4000-8000-000000000003',
  younger: 'a1000000-0000-4000-8000-000000000004',
  script: 'a1000000-0000-4000-8000-000000000005',
  codexApp: 'codex-c0de0000-0000-4000-8000-000000000001',
  codexCli: 'codex-c0de0000-0000-4000-8000-000000000002',
  pi: 'pi-019c0000-0000-7000-8000-000000000001',
  piOld: 'pi-019c0000-0000-7000-8000-000000000002',
};

/**
 * A machine's processes: [pid, ppid, rss in KB, cpu seconds, seconds running,
 * executable, arguments, folder]. `run` answers `ps` and `lsof` as macOS does.
 */
function machine(procs) {
  const calls = [];
  const time = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  const elapsed = (s) => {
    const h = Math.floor(s / 3600);
    const rest = `${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return h ? `${String(h).padStart(2, '0')}:${rest}` : rest;
  };
  const lines = (list) => `${list.join('\n')}\n`;
  async function run(cmd, args) {
    calls.push([cmd, ...args]);
    if (cmd === 'ps' && args.includes('pid=,ppid=,rss=,time=,etime=,args=')) {
      const row = ([pid, ppid, rss, cpu, running, , line]) =>
        `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(rss).padStart(7)} ${time(cpu).padStart(9)} ${elapsed(running).padStart(11)} ${line}`;
      return lines(procs.map(row));
    }
    if (cmd === 'ps') return lines(procs.map(([pid, , , , , exe]) => `${String(pid).padStart(5)} ${exe}`));
    if (cmd === 'lsof') {
      const asked = args[args.indexOf('-p') + 1].split(',').map(Number);
      const here = procs.filter(([pid, , , , , , , cwd]) => asked.includes(pid) && cwd);
      return lines(here.map(([pid, , , , , , , cwd]) => `p${pid}\nfcwd\nn${cwd}`));
    }
    return null;
  }
  return { run, calls };
}

const SESSIONS = [
  {
    id: ID.resumed,
    source: 'claude',
    dir: DIR,
    firstAt: at('08:00:00'),
    lastAt: at('09:59:00'),
    title: 'Fix croissant count',
    project: 'bakery',
  },
  {
    id: ID.older,
    source: 'claude',
    dir: DIR,
    firstAt: at('09:41:00'),
    lastAt: at('09:50:00'),
    title: 'Sourdough changelog',
    project: 'bakery',
  },
  {
    id: ID.stale,
    source: 'claude',
    dir: DIR,
    firstAt: at('08:00:00'),
    lastAt: at('08:30:00'),
    title: 'From this morning',
    project: 'bakery',
  },
  {
    id: ID.younger,
    source: 'claude',
    dir: DIR,
    firstAt: at('09:56:00'),
    lastAt: at('09:57:00'),
    title: 'Allergen notes',
    project: 'bakery',
  },
  {
    id: ID.script,
    source: 'claude',
    dir: DIR,
    firstAt: at('09:20:00'),
    lastAt: at('09:30:00'),
    title: 'Order migration',
    project: 'bakery',
  },
  {
    id: ID.codexApp,
    source: 'codex',
    dir: DIR,
    firstAt: at('09:05:00'),
    lastAt: at('09:06:00'),
    title: 'Grams on loaf labels',
    project: 'bakery',
  },
  {
    id: ID.codexCli,
    source: 'codex',
    dir: DIR,
    firstAt: at('09:20:00'),
    lastAt: at('09:22:00'),
    title: 'Oven schedule',
    project: 'bakery',
  },
  // Started before Pi was (it was resumed), and active since.
  {
    id: ID.pi,
    source: 'pi',
    dir: DIR,
    firstAt: at('08:10:00'),
    lastAt: at('09:58:00'),
    title: 'Gluten-free badge',
    project: 'bakery',
  },
  {
    id: ID.piOld,
    source: 'pi',
    dir: DIR,
    firstAt: at('07:00:00'),
    lastAt: at('07:30:00'),
    title: 'Old Pi session',
    project: 'bakery',
  },
];
const LIVE = {
  [ID.resumed]: {
    status: 'working',
    needsYou: null,
    title: 'Fix the croissant count',
    project: 'bakery',
    lastActivity: at('09:59:30'),
    present: true,
  },
  [ID.older]: {
    status: 'waiting',
    needsYou: 'turn',
    title: 'Sourdough changelog',
    project: 'bakery',
    lastActivity: at('09:50:00'),
    present: true,
  },
  [ID.codexApp]: {
    status: 'thinking',
    needsYou: null,
    title: 'Grams on loaf labels',
    project: 'bakery',
    lastActivity: at('09:58:00'),
    present: true,
  },
};

const PROCS = [
  // Claude Code resuming a session, and what it started: an MCP server, which runs the tests.
  [101, 1, 204_800, 12.5, 3600, '/Users/sam/.local/bin/claude', `claude --resume ${ID.resumed}`, BAKERY],
  [
    102,
    101,
    51_200,
    1,
    3590,
    '/opt/homebrew/bin/node',
    'node /opt/homebrew/lib/node_modules/@acme/mcp-recipes/dist/index.js',
  ],
  [103, 102, 10_240, 0.2, 5, '/bin/zsh', '/bin/zsh -c npm test'],
  // Two new Claude Code sessions in the same folder, the younger one started at 09:55.
  [201, 1, 307_200, 30, 20 * 60, '/Users/sam/.local/bin/claude', 'claude', BAKERY],
  [202, 1, 102_400, 2, 5 * 60, '/Users/sam/.local/bin/claude', 'claude --model sonnet', BAKERY],
  // Codex resuming a chat, with its sandbox helper under it, and an MCP server of its own that isn't a session.
  [301, 1, 153_600, 5, 30 * 60, '/opt/homebrew/bin/codex', `codex resume ${ID.codexCli.slice(6)}`, BAKERY],
  [
    302,
    301,
    20_480,
    0.1,
    60,
    '/opt/homebrew/bin/codex',
    '/opt/homebrew/bin/codex sandbox --policy workspace-write -- /bin/zsh -lc ls',
  ],
  [303, 1, 40_960, 0.5, 2 * 3600, '/opt/homebrew/bin/codex', '/opt/homebrew/bin/codex mcp-server'],
  // The Codex app, which runs all its chats in one process.
  [
    401,
    1,
    512_000,
    60,
    26 * 3600,
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex app-server --analytics-default-enabled',
    '/',
  ],
  // Pi names its process `pi`, which hides its arguments too.
  [501, 1, 102_400, 2, 30 * 60, 'pi', 'pi', BAKERY],
  // Pi run as a script, in a folder with no sessions yet.
  [
    502,
    1,
    81_920,
    1,
    60,
    '/opt/homebrew/bin/node',
    'node /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
    '/Users/sam/work/cafe',
  ],
  // Claude Code run as a script by node, resuming a session.
  [
    601,
    1,
    81_920,
    1,
    10 * 60,
    '/usr/local/bin/node',
    `node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js --resume ${ID.script}`,
    BAKERY,
  ],
  // Not agent sessions: one Overtime started itself, the Claude app, and an editor.
  [
    701,
    process.pid,
    61_440,
    0.5,
    30,
    '/Users/sam/.local/bin/claude',
    'claude -p "Reply with just the word ok."',
    BAKERY,
  ],
  [
    801,
    1,
    409_600,
    40,
    5 * 3600,
    '/Applications/Claude.app/Contents/MacOS/Claude',
    '/Applications/Claude.app/Contents/MacOS/Claude',
  ],
  [901, 1, 20_480, 0.3, 600, '/usr/bin/vim', 'vim CLAUDE.md'],
];

/** Tick, and wait for the sample it starts. */
async function sample(monitor) {
  const before = monitor.latest();
  monitor.tick();
  for (let i = 0; i < 200 && monitor.latest() === before; i++) await new Promise((resolve) => setImmediate(resolve));
  return monitor.latest();
}

function monitorOn(t, procs) {
  let now = START;
  t.mock.method(Date, 'now', () => now);
  const m = machine(procs);
  const monitor = createSessionMonitor({ sessions: () => SESSIONS, live: (id) => LIVE[id] || null, run: m.run });
  return {
    monitor,
    calls: m.calls,
    later: (ms) => {
      now += ms;
    },
  };
}

test('every agent process is matched to its session: by the id it resumed, else the next new session in its folder', async (t) => {
  const { monitor, calls } = monitorOn(t, PROCS);
  const s = await sample(monitor);
  const byPid = Object.fromEntries(s.sessions.filter((r) => r.pid).map((r) => [r.pid, r]));
  assert.deepEqual(Object.keys(byPid).map(Number).sort(), [101, 201, 202, 301, 501, 502, 601]);
  // Resumed, by the id in its arguments, whether run as its own executable or as a script under node.
  assert.equal(byPid[101].id, ID.resumed);
  assert.equal(byPid[601].id, ID.script);
  assert.equal(byPid[301].id, ID.codexCli);
  // New ones: the younger process gets the session started after it, and the older one the next.
  assert.equal(byPid[202].id, ID.younger);
  assert.equal(byPid[201].id, ID.older);
  // Pi's process shows nothing of the session it resumed: it's the one in its folder active since it started.
  assert.equal(byPid[501].id, ID.pi);
  assert.deepEqual(
    [byPid[502].id, byPid[502].status, byPid[502].project, byPid[502].source],
    [null, 'new', 'cafe', 'pi'],
  );
  assert.deepEqual(
    Object.values(byPid)
      .map((r) => r.source)
      .sort(),
    ['claude', 'claude', 'claude', 'claude', 'codex', 'pi', 'pi'],
  );
  // Its folder comes from one lsof call, asking only about the agents.
  const lsof = calls.filter(([cmd]) => cmd === 'lsof');
  assert.equal(lsof.length, 1);
  assert.deepEqual(
    lsof[0][lsof[0].indexOf('-p') + 1]
      .split(',')
      .map(Number)
      .sort((a, b) => a - b),
    [101, 201, 202, 301, 401, 501, 502, 601],
  );
});

test("Codex's helpers, Overtime's own test runs, the Claude app and other programs aren't sessions", async (t) => {
  const { monitor } = monitorOn(t, PROCS);
  const s = await sample(monitor);
  const pids = [...s.sessions, ...s.sharedRuntimes].map((r) => r.pid).filter(Boolean);
  for (const pid of [102, 103, 302, 303, 701, 801, 901]) assert.ok(!pids.includes(pid), `${pid} is listed`);
});

test("the Codex app's one process for every chat is listed apart, with its chats in the office as sessions of their own", async (t) => {
  const { monitor } = monitorOn(t, PROCS);
  const s = await sample(monitor);
  assert.deepEqual(
    s.sharedRuntimes.map((r) => [r.pid, r.source, r.shared, r.id]),
    [[401, 'codex', true, null]],
  );
  assert.equal(s.sharedRuntimes[0].memBytes, 512_000 * 1024);
  const shared = s.sessions.filter((r) => r.runtimeShared);
  // The chat the CLI has open isn't counted again.
  assert.deepEqual(
    shared.map((r) => [r.id, r.status, r.title, r.memBytes]),
    [[ID.codexApp, 'working', 'Grams on loaf labels', null]],
  );
});

test('each session says whether it needs you, what it and its tools use, and the list puts the ones that need you first', async (t) => {
  const { monitor } = monitorOn(t, PROCS);
  const s = await sample(monitor);
  const row = (pid) => s.sessions.find((r) => r.pid === pid);
  const claude = row(101);
  assert.deepEqual(
    [claude.status, claude.title, claude.inOffice, claude.shared],
    ['working', 'Fix the croissant count', true, false],
  );
  assert.equal(claude.memBytes, 204_800 * 1024);
  // The MCP server it started, and the test run that server started.
  assert.deepEqual([claude.tools, claude.toolsMemBytes], [2, (51_200 + 10_240) * 1024]);
  assert.equal(claude.openedAt, START - 3600_000);
  assert.equal(claude.lastActive, at('09:59:30'));
  assert.equal(claude.cpuPct, null); // it takes two samples to know
  assert.equal(row(301).tools, 1); // Codex's sandbox helper, running a command for it
  assert.deepEqual([row(201).status, row(202).status], ['needs', 'idle']);
  assert.equal(row(202).title, 'Allergen notes');
  // Needs you, then working, then idle, then new; the most recently active first within each.
  assert.deepEqual(
    s.sessions.map((r) => r.status),
    ['needs', 'working', 'working', 'idle', 'idle', 'idle', 'idle', 'new'],
  );
  assert.deepEqual(
    s.sessions.slice(0, 3).map((r) => r.id),
    [ID.older, ID.resumed, ID.codexApp],
  );
});

test('a session whose turn ended long ago, and has left the office, is idle rather than needing you', async (t) => {
  const was = LIVE[ID.older];
  LIVE[ID.older] = { ...was, present: false };
  t.after(() => {
    LIVE[ID.older] = was;
  });
  const { monitor } = monitorOn(t, PROCS);
  const s = await sample(monitor);
  assert.equal(s.sessions.find((r) => r.id === ID.older).status, 'idle');
});

test('CPU is the share of one core over the time between two samples, and sampling waits between ticks', async (t) => {
  const procs = PROCS.map((p) => [...p]);
  const { monitor, calls, later } = monitorOn(t, procs);
  await sample(monitor);
  const psCalls = () => calls.filter(([cmd]) => cmd === 'ps').length;
  assert.equal(psCalls(), 2);

  // A second tick straight away doesn't sample again.
  monitor.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(psCalls(), 2);

  // Five seconds on, Claude Code used 2.5 s of CPU and its MCP server 0.5 s; the second sample comes after two.
  later(5000);
  for (const p of procs) {
    p[4] += 5;
    if (p[0] === 101) p[3] += 2.5;
    if (p[0] === 102) p[3] += 0.5;
  }
  procs.push([203, 1, 10_240, 0.4, 3, '/Users/sam/.local/bin/claude', 'claude', '/Users/sam/work/cafe']);
  const s = await sample(monitor);
  assert.equal(psCalls(), 4);
  const row = (pid) => s.sessions.find((r) => r.pid === pid);
  assert.ok(Math.abs(row(101).cpuPct - 60) < 1e-9, `${row(101).cpuPct}`);
  assert.equal(row(201).cpuPct, 0);
  assert.equal(row(203).cpuPct, null); // new since the last sample
  assert.equal(s.everyMs, 10_000);

  // After that, every ten seconds.
  later(5000);
  monitor.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(psCalls(), 4);
});

test("when ps can't run, the list is empty rather than broken", async (t) => {
  t.mock.method(Date, 'now', () => START);
  const monitor = createSessionMonitor({ sessions: () => SESSIONS, live: () => null, run: async () => null });
  const s = await sample(monitor);
  assert.deepEqual([s.sessions, s.sharedRuntimes, s.sampledAt], [[], [], START]);
});
