// The live view of Claude Code sessions, from the transcripts in test/fixtures/claude,
// read line by line through the watcher as the server reads them.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFeed, view } from '../lib/agents.js';
import { createWatcher } from '../lib/watcher.js';
import { scratch } from './helpers.js';
import { CLAUDE, CWD, layFixtures } from './fixtures/index.js';
import { follow } from './fixtures/follow.js';

const MINUTE = 60_000;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('a Claude Code turn, line by line: thinking, each tool in its room, a failed test run, and the reply', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.turn);
  let v = f.view('09:00:01');
  assert.equal(v.status, 'thinking');
  assert.equal(v.zone, 'desk');
  assert.equal(v.needsYou, null);
  assert.equal(v.turns, 1);
  assert.ok(v.title.startsWith('The croissant count on the order page is off by one.'), v.title);
  assert.deepEqual([v.project, v.cwd, v.branch, v.entrypoint], ['bakery', CWD, 'main', 'cli']);
  assert.equal(v.context, null);
  assert.equal(v.present, true);

  // The first reply's usage: 10 fresh, 8,000 written to the cache and 120 out, at Sonnet 4.5's prices.
  await f.next();
  v = f.view('09:00:04');
  assert.equal(v.status, 'thinking');
  assert.deepEqual([v.model, v.modelName], ['claude-sonnet-4-5', 'Sonnet 4.5']);
  assert.equal(v.tokens.total, 8130);
  near(v.cost, (10 * 3 + 8000 * 3.75 + 120 * 15) / 1e6);
  assert.deepEqual(v.context, { used: 8130, window: 200_000, pct: 4 });

  // The same message's next line, a Read: its usage isn't counted again.
  await f.next();
  v = f.view('09:00:06');
  assert.equal(v.status, 'working');
  assert.equal(v.zone, 'books');
  assert.deepEqual([v.tool.name, v.tool.category, v.tool.detail], ['Read', 'read', 'order.js']);
  assert.equal(v.tokens.total, 8130);
  assert.deepEqual(v.counts, { read: 1 });
  // A read still pending after a few seconds is almost always waiting for your permission.
  assert.equal(f.view('09:00:08').needsYou, null);
  assert.equal(f.view('09:00:13').needsYou, 'approval');

  await f.next();
  v = f.view('09:00:07');
  assert.equal(v.status, 'thinking');
  assert.equal(v.tool, null);
  assert.equal(v.lastTool.name, 'Read');
  assert.deepEqual(
    v.results.map((r) => r.slice(1)),
    [[1, 'Read']],
  );

  await f.next(2); // the edit, and that it went through
  v = f.view('09:00:12');
  assert.deepEqual(v.lines, { added: 1, removed: 1 });
  assert.deepEqual(
    v.files.map((x) => [x.name, x.edits]),
    [['order.js', 1]],
  );

  // A shell command is never taken for a permission prompt, however long it runs.
  await f.next();
  v = f.view('09:01:15');
  assert.equal(v.zone, 'servers');
  assert.deepEqual([v.tool.name, v.tool.detail], ['Bash', 'Run the test suite']);
  assert.equal(v.needsYou, null);

  await f.next(); // the tests fail
  v = f.view('09:00:22');
  assert.equal(v.errors, 1);
  assert.equal(v.lastErrorAt, f.clock('09:00:21'));
  assert.deepEqual(v.results.at(-1).slice(1), [0, 'Bash']);

  await f.next(); // it says what it's doing next
  assert.equal(f.view('09:00:30').status, 'replying');
  assert.equal(f.view('09:00:30').snippet, 'One test still expects the old count, so I am updating it.');

  await f.rest();
  v = f.view('09:00:52');
  assert.equal(v.status, 'waiting');
  assert.equal(v.zone, 'lounge');
  assert.equal(v.needsYou, 'turn');
  assert.equal(v.endReason, 'done');
  assert.equal(v.endedAt, f.clock('09:00:51')); // once its stop hooks had run
  assert.equal(v.title, 'Fix croissant count on order page');
  assert.deepEqual(v.counts, { read: 1, edit: 2, bash: 2 });
  assert.equal(v.turns, 1);
  assert.equal(v.errors, 1);
  assert.deepEqual(v.lines, { added: 2, removed: 2 });
  assert.deepEqual(
    v.files.map((x) => [x.name, x.edits, x.added, x.removed]),
    [
      ['order.test.js', 1, 1, 1],
      ['order.js', 1, 1, 1],
    ],
  );
  assert.deepEqual(v.tokens, { input: 30, output: 500, cacheRead: 44_500, cacheWrite: 9900, total: 54_930 });
  near(v.cost, 0.058065);
  assert.equal(v.costKnown, true);
  assert.deepEqual(v.context, { used: 9974, window: 200_000, pct: 5 });
  assert.deepEqual([v.lastTool.name, v.lastTool.detail], ['Bash', 'Run the test suite']);
  assert.equal(
    v.snippet,
    'Fixed: countItems no longer drops the last croissant, and the test now expects 12. All 14 tests pass.',
  );
  assert.deepEqual(
    v.results.map((r) => r[1]),
    [1, 1, 0, 1, 1],
  );
  const said = f.recent();
  assert.equal(said[0], 'Got a new task');
  assert.ok(said.includes('Reading order.js') && said.includes('Running Run the test suite'), said.join(' | '));
  assert.equal(said.at(-1), 'Done, waiting for you');
  // Its turn was nearly an hour ago, which is too long ago for the office's news feed.
  assert.ok(!f.feed.items.some((x) => x.agentId === CLAUDE.turn));
});

test('a turn left mid-way goes idle: thinking after 10 minutes, a tool still running after 45, and the agent goes home after half an hour', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.turn, { start: 2 }); // your message, and the start of its reply
  const thought = f.clock('09:00:04');
  assert.equal(f.view(thought + 9 * MINUTE).status, 'thinking');
  let v = f.view(thought + 11 * MINUTE);
  assert.deepEqual([v.status, v.zone], ['idle', 'lounge']);
  assert.equal(v.present, true);

  await f.next(); // a Read, which never finishes
  const started = f.clock('09:00:05');
  v = f.view(started + 20 * MINUTE);
  assert.deepEqual([v.status, v.zone, v.needsYou], ['working', 'books', 'approval']);
  v = f.view(started + 46 * MINUTE);
  assert.deepEqual([v.status, v.zone, v.tool], ['idle', 'lounge', null]);
  assert.equal(v.present, false);
  assert.equal(f.view(started + 29 * MINUTE).present, true);

  // Once it's handed back to you, it waits however long you take.
  await f.rest();
  v = f.view(f.clock('09:00:50') + 3 * 60 * MINUTE);
  assert.deepEqual([v.status, v.needsYou], ['waiting', 'turn']);
  assert.equal(v.present, false);
});

test('a file write waiting for your permission says so after a few seconds, and changes nothing yet', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.approval);
  await f.rest();
  let v = f.view('09:10:07');
  assert.deepEqual([v.status, v.zone, v.needsYou], ['working', 'desk', null]);
  assert.deepEqual(
    [v.tool.name, v.tool.category, v.tool.detail, v.tool.startedAt],
    ['Write', 'edit', 'CHANGELOG.md', f.clock('09:10:05')],
  );
  assert.equal(v.snippet, 'I will add it under Unreleased.');
  v = f.view('09:10:13');
  assert.equal(v.needsYou, 'approval');
  assert.deepEqual(v.lines, { added: 0, removed: 0 });
  assert.deepEqual(v.files, []);
});

test('a question for you, then a plan to approve: each needs you until you answer', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.ask);
  await f.next();
  let v = f.view('09:21:00');
  assert.deepEqual([v.status, v.zone, v.needsYou], ['working', 'desk', 'question']);
  assert.deepEqual([v.tool.category, v.tool.detail], ['ask', 'Should old orders move too, or only new ones?']);

  await f.next(); // you answer
  v = f.view('09:21:31');
  assert.deepEqual([v.status, v.needsYou], ['thinking', null]);

  await f.next(2); // it looks around
  await f.next(); // and has a plan
  v = f.view('09:23:00');
  assert.deepEqual([v.zone, v.needsYou, v.tool.detail], ['board', 'plan', 'plan ready for review']);

  await f.next(); // you approve it
  assert.equal(f.view('09:24:01').needsYou, null);

  await f.rest();
  v = f.view('09:24:06');
  assert.deepEqual([v.status, v.needsYou], ['waiting', 'turn']);
  assert.deepEqual(v.counts, { ask: 1, search: 1, plan: 1 });
  assert.equal(v.errors, 0);
});

test('a compaction is counted and the context shrinks; an edit you turn down is neither a failure nor a change', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.compact, { start: 5 }); // a rename, done
  let v = f.view('09:30:21');
  assert.deepEqual(v.context, { used: 152_434, window: 200_000, pct: 76 });
  assert.equal(v.compactions, 0);

  await f.next(); // you run /compact
  v = f.view('09:31:00');
  assert.equal(v.compactions, 1);
  assert.equal(v.lastCompactAt, f.clock('09:31:00'));
  assert.equal(f.recent().at(-1), 'Compacted its context');

  await f.next(4); // its summary, and the command's own lines
  await f.next(2); // your next message, and an edit
  v = f.view('09:32:09');
  assert.deepEqual([v.status, v.tool.name, v.tool.detail], ['working', 'Edit', 'menu.js']);
  assert.deepEqual(v.context, { used: 10_624, window: 200_000, pct: 5 });

  await f.next(2); // you turn the edit down, and stop it
  v = f.view('09:32:31');
  assert.deepEqual([v.status, v.needsYou, v.endReason], ['waiting', 'turn', 'interrupted']);
  assert.equal(v.errors, 0);
  assert.deepEqual(
    v.results.map((r) => r[2]),
    ['Bash'],
  );
  assert.deepEqual(v.lines, { added: 0, removed: 0 });
  assert.equal(f.recent().at(-1), 'Stopped by you');
  assert.equal(v.snippet, null);

  // The name you gave it beats the one Claude Code wrote, whichever came last.
  await f.rest();
  assert.equal(f.view('09:33:00').title, 'Muffins become pastries');
});

test('after a manual /compact the agent still waits for you, and its summary is not a new message from you', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.compact, { start: 5 });
  await f.next(5); // the compaction, its summary, and the /compact command's own lines
  const v = f.view('09:31:02');
  assert.deepEqual([v.status, v.needsYou], ['waiting', 'turn']);
  assert.equal(v.turns, 1);
});

test('a subagent works at a desk of its own under its session, named by what it was asked to do', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.delegate);
  await f.next(); // the session briefs a subagent
  const v = f.view('09:40:30');
  assert.deepEqual([v.status, v.zone, v.needsYou], ['working', 'meeting', null]);
  assert.deepEqual([v.tool.name, v.tool.category, v.tool.detail], ['Agent', 'delegate', 'Audit allergen notes']);
  await f.rest();
  assert.deepEqual([f.view('09:41:41').status, f.view('09:41:41').needsYou], ['waiting', 'turn']);

  const root = await scratch(t);
  const claudeDir = path.join(root, 'claude');
  await layFixtures({ claude: claudeDir }, { only: [CLAUDE.delegate] });
  const watcher = createWatcher({ claudeDir, feed: createFeed() });
  await watcher.discover();
  const sub = view(watcher.agents.get(CLAUDE.sub), f.clock('09:41:00'));
  assert.deepEqual(
    [sub.kind, sub.parentId, sub.title, sub.agentType],
    ['sub', CLAUDE.delegate, 'Audit allergen notes', 'general-purpose'],
  );
  assert.deepEqual(sub.counts, { search: 1, read: 1, handback: 1 });
  assert.equal(sub.turns, 1);
  assert.equal(sub.zone, 'desk');
  near(sub.cost, ((3 + 3 + 3) * 3 + (70 + 40 + 60) * 15 + (4000 + 4300) * 0.3 + (4000 + 300 + 200) * 3.75) / 1e6);
  // Its own context, not the session's.
  assert.deepEqual(sub.context, { used: 4563, window: 200_000, pct: 2 });
  const main = view(watcher.agents.get(CLAUDE.delegate), f.clock('09:41:41'));
  assert.deepEqual(main.counts, { delegate: 1 });
  assert.equal(main.kind, 'main');
});

test('a subagent that hands in its results is done, and leaves the office soon after', async (t) => {
  const f = await follow(t, 'claude', CLAUDE.sub);
  await f.rest();
  assert.equal(f.view('09:41:31').status, 'done');
  assert.equal(f.view('09:42:00').present, false);
});

test("the Claude app's session: todos, a multi-edit, the web and an MCP tool each in their place, a background task waking the agent, and the app's own totals", async (t) => {
  const f = await follow(t, 'claude', CLAUDE.extras);
  await f.next(); // a todo list
  let v = f.view('09:45:06');
  assert.deepEqual([v.zone, v.tool.category, v.tool.detail], ['board', 'plan', 'Tidying the README']);
  await f.next(2); // a multi-edit
  v = f.view('09:45:15');
  assert.deepEqual([v.zone, v.tool.name, v.tool.detail], ['desk', 'MultiEdit', 'README.md']);
  await f.next(2); // a web page
  v = f.view('09:45:31');
  assert.deepEqual([v.zone, v.tool.detail], ['web', 'flour-supplier.example']);
  await f.next(2); // a tool from an MCP server, which may also be waiting for your permission
  v = f.view('09:45:46');
  assert.deepEqual(
    [v.zone, v.tool.name, v.tool.category, v.tool.detail],
    ['files', 'create event', 'other', 'Collect flour'],
  );
  assert.equal(f.view('09:45:53').needsYou, 'approval');
  assert.equal(f.recent().at(-1), 'Using create event · Collect flour');

  await f.next(4); // a command left running in the background, and the reply
  v = f.view('09:46:11');
  assert.deepEqual([v.status, v.needsYou], ['waiting', 'turn']);
  // A shell command you ran yourself (with !) isn't a new task.
  await f.next(2);
  assert.equal(f.view('09:46:32').turns, 1);
  // The background command finishing wakes the agent, without a message from you.
  await f.next(2);
  assert.ok(f.recent().includes('Picked the work back up'));
  // A quarter of an hour ago, so it's in the office's news feed too.
  assert.ok(f.feed.items.some((x) => x.agentId === CLAUDE.extras && x.who && x.text === 'Picked the work back up'));
  v = f.view('09:48:06');
  assert.deepEqual([v.status, v.turns, v.snippet], ['waiting', 1, 'The docs build finished without warnings.']);

  await f.rest();
  v = f.view('09:48:10');
  // The name you gave it, a branch that isn't one (a detached HEAD), and where it was started from.
  assert.deepEqual([v.title, v.branch, v.entrypoint, v.background], ['Readme tidy', null, 'claude-desktop', false]);
  assert.deepEqual(v.counts, { plan: 1, edit: 1, web: 1, other: 1, bash: 1 });
  assert.deepEqual(
    v.files.map((x) => [x.name, x.added, x.removed]),
    [['README.md', 4, 3]],
  );
  // The app's own running totals win when they're higher than what the transcript adds up to.
  assert.equal(v.cost, 0.5);
  assert.deepEqual(v.lines, { added: 40, removed: 12 });
  assert.equal(v.tokens.total, 40_800);
});
