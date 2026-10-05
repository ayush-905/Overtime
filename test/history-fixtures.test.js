// The 31-day history (the usage index, and the session list, details and turns
// built on it) from the same fixture transcripts as the live view, and the two
// agreeing about each session.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFeed, view } from '../lib/agents.js';
import { createWatcher } from '../lib/watcher.js';
import { createUsageIndex } from '../lib/limits.js';
import { activitySummary, sessionDetail, sessionList, turnDetail, weeklyDigest } from '../lib/insights.js';
import { scratch } from './helpers.js';
import { CLAUDE, CODEX, CWD, PI, layFixtures } from './fixtures/index.js';

const near = (actual, expected, what = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what} ${actual} is not ${expected}`);

/** Every fixture, read by the history and by the live view, as of 10:00. */
async function fixtures(t) {
  const root = await scratch(t);
  const dirs = {
    claude: path.join(root, 'claude'),
    codex: path.join(root, 'codex', 'sessions'),
    pi: path.join(root, 'pi', 'sessions'),
  };
  const { clock } = await layFixtures(dirs);
  const folders = { claudeDir: dirs.claude, codexDir: dirs.codex, piDir: dirs.pi, piHome: path.join(root, 'pi-home') };
  const index = createUsageIndex(folders);
  await index.scan();
  const watcher = createWatcher({ ...folders, feed: createFeed() });
  await watcher.discover();
  const now = clock('10:00:00');
  const views = () => [...watcher.agents.values()].map((a) => view(a, now));
  return {
    index,
    watcher,
    clock,
    now,
    live: (id) => views().find((v) => v.id === id),
    subsOf: (id) => views().filter((v) => v.parentId === id),
  };
}

/** A session's detail against its live view and its subagents': the fields named. */
function agree(d, v, subs, fields) {
  const all = [v, ...subs];
  const sum = (of) => all.reduce((n, x) => n + of(x), 0);
  const what = `${v.id}:`;
  if (fields.includes('cost'))
    near(
      d.cost,
      sum((x) => x.cost),
      `${what} cost`,
    );
  if (fields.includes('tokens'))
    assert.equal(
      d.tokens.total,
      sum((x) => x.tokens.total),
      `${what} tokens`,
    );
  if (fields.includes('turns')) assert.equal(d.messages.count, v.turns, `${what} turns`);
  if (fields.includes('lines'))
    assert.deepEqual(
      d.lines,
      { added: sum((x) => x.lines.added), removed: sum((x) => x.lines.removed) },
      `${what} lines`,
    );
  if (fields.includes('failed'))
    assert.equal(
      d.tools.failed,
      sum((x) => x.errors),
      `${what} failed`,
    );
  if (fields.includes('compactions'))
    assert.equal(
      d.compactions,
      sum((x) => x.compactions),
      `${what} compactions`,
    );
  if (fields.includes('context'))
    assert.deepEqual({ ...d.context, at: undefined }, { ...v.context, at: undefined }, `${what} context`);
}

const ALL = ['cost', 'tokens', 'turns', 'lines', 'failed', 'compactions', 'context'];

test('Claude Code: the history agrees with the live view on cost, tokens, turns, lines, failures and context', async (t) => {
  const { index, live, subsOf } = await fixtures(t);
  for (const id of [CLAUDE.turn, CLAUDE.ask, CLAUDE.delegate])
    agree(sessionDetail(index, id), live(id), subsOf(id), ALL);
  // Turned down, waiting and compacted: the rest has tests of its own, here and in live-claude.
  agree(
    sessionDetail(index, CLAUDE.compact),
    live(CLAUDE.compact),
    [],
    ['cost', 'tokens', 'failed', 'compactions', 'context'],
  );
  agree(
    sessionDetail(index, CLAUDE.approval),
    live(CLAUDE.approval),
    [],
    ['cost', 'tokens', 'turns', 'failed', 'context'],
  );
  // The Claude app's own running totals are only for the live view; the history adds up the transcript.
  const extras = sessionDetail(index, CLAUDE.extras);
  agree(extras, live(CLAUDE.extras), [], ['tokens', 'turns', 'failed', 'context']);
  near(extras.cost, 0.040965);
  assert.deepEqual(extras.lines, { added: 4, removed: 3 });
  assert.deepEqual([live(CLAUDE.extras).cost, live(CLAUDE.extras).lines], [0.5, { added: 40, removed: 12 }]);

  const d = sessionDetail(index, CLAUDE.turn);
  assert.deepEqual([d.source, d.nativeId, d.project, d.cwd], ['claude', CLAUDE.turn, 'bakery', CWD]);
  assert.deepEqual([d.tools.calls, d.tools.failed, d.tools.denied], [5, 1, 0]);
  assert.deepEqual(
    d.models.map((m) => m.name),
    ['Sonnet 4.5'],
  );
  assert.deepEqual(d.tokens, { fresh: 30, output: 500, cacheRead: 44_500, cacheWrite: 9900, total: 54_930 });
  // A call you turned down is denied, not failed; stopping it is an interruption.
  const c = sessionDetail(index, CLAUDE.compact);
  assert.deepEqual([c.tools.denied, c.tools.failed, c.messages.interrupts, c.compactions], [1, 0, 1, 1]);
});

test('Codex: the history prices what the live view only counts, and agrees on the rest', async (t) => {
  const { index, live, subsOf } = await fixtures(t);
  const d = sessionDetail(index, `codex-${CODEX.main}`);
  agree(d, live(`codex-${CODEX.main}`), subsOf(`codex-${CODEX.main}`), [
    'tokens',
    'turns',
    'lines',
    'failed',
    'compactions',
  ]);
  // At GPT-6 Sol's prices ($2 in, $0.20 cached, $10 out per million): 6,000 + 5,000 fresh, 12,000 + 18,000 cached, 400 + 800 out;
  // and its subagent on GPT-6 Luna ($0.10, $0.01, $0.50): 4,000 fresh, 2,000 cached, 250 out.
  near(d.cost, (11_000 * 2 + 30_000 * 0.2 + 1200 * 10) / 1e6 + (4000 * 0.1 + 2000 * 0.01 + 250 * 0.5) / 1e6);
  assert.deepEqual(
    d.models.map((m) => m.name),
    ['GPT-6 Sol', 'GPT-6 Luna'],
  );
  assert.equal(d.partial, false);
  assert.equal(live(`codex-${CODEX.main}`).cost, null);
  assert.equal(d.context.pct, live(`codex-${CODEX.main}`).context.pct);

  const second = sessionDetail(index, `codex-${CODEX.second}`);
  agree(second, live(`codex-${CODEX.second}`), [], ['tokens', 'turns']);
  near(second.cost, (5000 * 2 + 4000 * 0.2 + 300 * 10 + 1000 * 2 + 2000 * 0.2 + 200 * 10) / 1e6);
  assert.deepEqual([second.messages.interrupts, second.compactions], [1, 1]);
});

test("Pi: the history agrees with the live view, counting every branch and only a fork's own work", async (t) => {
  const { index, live } = await fixtures(t);
  for (const id of [`pi-${PI.main}`, `pi-${PI.fork}`]) agree(sessionDetail(index, id), live(id), [], ALL);
  const fork = sessionDetail(index, `pi-${PI.fork}`);
  assert.deepEqual([fork.messages.count, fork.messages.interrupts, fork.tools.calls], [2, 1, 2]);
  assert.equal(fork.firstAt, live(`pi-${PI.fork}`).startedAt);
});

test("a subagent rolls up into its session: one row in the session list, its cost inside the session's", async (t) => {
  const { index, watcher, now, live } = await fixtures(t);
  const list = sessionList(index, watcher.agents, now);
  assert.ok(!list.some((s) => s.id === CLAUDE.sub || s.id === `codex-${CODEX.sub}`));
  for (const [id, title] of [
    [CLAUDE.delegate, 'Look through recipes/ and list every recipe without an allergen note.'],
    [`codex-${CODEX.main}`, 'Check the label templates for any other ounce values.'],
  ]) {
    const row = list.find((s) => s.id === id);
    const d = sessionDetail(index, id);
    assert.equal(row.subagents, 1, id);
    assert.equal(d.subagents.count, 1, id);
    assert.equal(d.subagents.list[0].title, title);
    near(d.subCost, d.subagents.list[0].cost);
    near(
      row.days.reduce((n, x) => n + x.subCost, 0),
      d.subCost,
    );
    near(
      row.days.reduce((n, x) => n + x.cost, 0),
      d.cost,
    );
    assert.ok(d.subCost > 0 && d.subCost < d.cost);
  }
  // Claude Code prices its subagents live too: the session's history is it and its subagent.
  near(sessionDetail(index, CLAUDE.delegate).subCost, live(CLAUDE.sub).cost);
  near(
    sessionDetail(index, CLAUDE.delegate).cost - sessionDetail(index, CLAUDE.delegate).subCost,
    live(CLAUDE.delegate).cost,
  );
});

test("the session list's days add up to each session's detail, and every fixture session is in it with its title", async (t) => {
  const { index, watcher, now } = await fixtures(t);
  const list = sessionList(index, watcher.agents, now);
  const sum = (s, key) => s.days.reduce((n, x) => n + x[key], 0);
  for (const s of list) {
    const d = sessionDetail(index, s.id);
    near(sum(s, 'cost'), d.cost, s.id);
    assert.equal(sum(s, 'tokens'), d.tokens.total, s.id);
    assert.equal(sum(s, 'messages'), d.messages.count, s.id);
    assert.deepEqual({ added: sum(s, 'added'), removed: sum(s, 'removed') }, d.lines, s.id);
    assert.equal(sum(s, 'tools'), d.tools.calls, s.id);
    assert.equal(sum(s, 'failed'), d.tools.failed, s.id);
    assert.equal(s.project, 'bakery');
  }
  // The name you gave it, else the one the app wrote for it, else your first message.
  const titles = Object.fromEntries(list.map((s) => [s.id, s.title]));
  assert.deepEqual(titles, {
    [CLAUDE.turn]: 'Fix croissant count on order page',
    [CLAUDE.approval]: 'Add a CHANGELOG entry for the new sourdough recipe.',
    [CLAUDE.ask]: 'Plan how we should move the bakery orders to the new database.',
    [CLAUDE.compact]: 'Muffins become pastries',
    [CLAUDE.delegate]: 'Check every recipe file for missing allergen notes.',
    [CLAUDE.extras]: 'Readme tidy',
    [`codex-${CODEX.main}`]: 'Grams on loaf labels',
    [`codex-${CODEX.second}`]: 'Profile the oven schedule page and make it faster.',
    [`pi-${PI.main}`]: 'Gluten-free badge',
    [`pi-${PI.fork}`]: 'Make the badge green.',
  });
  assert.deepEqual(list.map((s) => s.source).sort(), [
    'claude',
    'claude',
    'claude',
    'claude',
    'claude',
    'claude',
    'codex',
    'codex',
    'pi',
    'pi',
  ]);
});

test('one of your messages and what it led to: what the agent said, the files it touched, the commands it ran and what it cost', async (t) => {
  const { index, clock } = await fixtures(t);
  // Any moment in the turn finds it.
  const claude = turnDetail(index, CLAUDE.turn, clock('09:00:30'));
  assert.equal(claude.t, clock('09:00:00'));
  assert.equal(claude.text, 'The croissant count on the order page is off by one. Can you fix it and run the tests?');
  assert.equal(claude.whole, true);
  assert.deepEqual(
    claude.replies.map((r) => r.text),
    [
      'One test still expects the old count, so I am updating it.',
      'Fixed: countItems no longer drops the last croissant, and the test now expects 12. All 14 tests pass.',
    ],
  );
  assert.deepEqual(
    claude.files.map((f) => [f.path, f.reads, f.edits, f.added, f.removed]),
    [
      [`${CWD}/src/order.js`, 1, 1, 1, 1],
      [`${CWD}/test/order.test.js`, 0, 1, 1, 1],
    ],
  );
  assert.deepEqual(
    claude.commands.map((c) => [c.text, c.status, c.reason]),
    [
      ['npm test', 'error', 'Tests failed'],
      ['npm test', 'ok', null],
    ],
  );
  assert.deepEqual([claude.failed, claude.denied, claude.subagents, claude.ms], [1, 0, 0, 50_000]);
  near(claude.cost, 0.058065);

  // A Codex turn includes what its subagent ran.
  const codex = turnDetail(index, `codex-${CODEX.main}`, clock('09:05:30'));
  assert.equal(codex.text, 'Make the loaf weights print in grams on the shelf labels.');
  assert.deepEqual(
    codex.commands.map((c) => [c.text, c.status, c.sub]),
    [
      ['rg -n "weightOz" src/labels', 'ok', false],
      ['npm test', 'error', false],
      ['npm test', 'ok', false],
      ['rg -n "oz" templates', 'ok', true],
    ],
  );
  assert.deepEqual(
    codex.files.map((f) => [f.path, f.added, f.removed]),
    [
      ['src/labels/print.js', 2, 1],
      ['test/labels.test.js', 1, 1],
    ],
  );
  near(codex.cost, sessionDetail(index, `codex-${CODEX.main}`).cost);

  // In Pi, the message sent from an earlier point (a branch) is a turn of its own.
  const pi = turnDetail(index, `pi-${PI.main}`, clock('09:56:15'));
  assert.equal(pi.text, 'Put the flag on its own line under the title instead.');
  near(pi.cost, 0.003975);
  const first = turnDetail(index, `pi-${PI.main}`, clock('09:50:20'));
  assert.equal(first.next, clock('09:56:10'));
  assert.deepEqual(
    first.commands.map((c) => [c.text, c.status, c.reason]),
    [['npm test', 'error', 'Tests failed']],
  );
});

test("search finds your words and the agents' in main sessions, and leaves subagents out", async (t) => {
  const { index } = await fixtures(t);
  const found = (q, opts) => index.search(q, opts).results.map((r) => r.session);
  assert.deepEqual(found('croissant'), [CLAUDE.turn]);
  assert.deepEqual(found('"rye.md and focaccia.md"'), [CLAUDE.delegate]);
  assert.deepEqual(found('grams labels'), [`codex-${CODEX.main}`]);
  assert.deepEqual(found('badge', { source: 'pi' }).sort(), [`pi-${PI.main}`, `pi-${PI.fork}`].sort());
  assert.deepEqual(found('badge', { source: 'codex' }), []);
  assert.deepEqual(found('ounce values'), []); // only the Codex subagent was asked that
  const hit = index.search('croissant').results[0];
  assert.deepEqual([hit.title, hit.project, hit.source], ['Fix croissant count on order page', 'bakery', 'claude']);
});

test("the weekly digest and today's activity come from the same numbers as the session list", async (t) => {
  const { index, watcher, now } = await fixtures(t);
  const list = sessionList(index, watcher.agents, now);
  const digest = weeklyDigest(index, watcher.agents, now, 0);
  const inWeek = list
    .map((s) => s.days.filter((x) => x.day >= digest.from && x.day < digest.to))
    .filter((days) => days.length);
  assert.equal(digest.sessions, inWeek.length);
  near(
    digest.cost,
    inWeek.flat().reduce((n, x) => n + x.cost, 0),
  );
  near(digest.bySource.claude + digest.bySource.codex + digest.bySource.pi, digest.cost);

  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const today = list.flatMap((s) => s.days.filter((x) => x.day === midnight));
  const summary = activitySummary(index, watcher.agents, now);
  near(
    summary.cost,
    today.reduce((n, x) => n + x.cost, 0),
  );
  assert.equal(
    summary.tools,
    today.reduce((n, x) => n + x.tools, 0),
  );
  assert.equal(
    summary.tokens,
    today.reduce((n, x) => n + x.tokens, 0),
  );
});

test('an edit you turned down, or one still waiting for you, changes no lines in the history, as in the live view', async (t) => {
  const { index, live } = await fixtures(t);
  agree(sessionDetail(index, CLAUDE.compact), live(CLAUDE.compact), [], ['lines']);
  agree(sessionDetail(index, CLAUDE.approval), live(CLAUDE.approval), [], ['lines']);
});

test('a Codex script that failed is failed in the history, and a patch you turned down is denied and changes nothing', async (t) => {
  const { index } = await fixtures(t);
  const d = sessionDetail(index, `codex-${CODEX.second}`);
  assert.deepEqual([d.tools.failed, d.tools.denied], [1, 1]);
  assert.deepEqual(d.lines, { added: 0, removed: 0 });
});
