// The live view of Codex sessions, from the transcripts in test/fixtures/codex,
// read line by line through the watcher as the server reads them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CODEX, CWD } from './fixtures/index.js';
import { follow } from './fixtures/follow.js';

test('a Codex turn, line by line: its search, patches and test runs each in their room, and task_complete hands it back to you', async (t) => {
  const f = await follow(t, 'codex', CODEX.main);
  let v = f.view('09:05:00');
  // From session_meta, with its git branch; the name is the one Codex keeps beside its sessions.
  assert.deepEqual(
    [v.nativeId, v.branch, v.entrypoint, v.cwd, v.project],
    [CODEX.main, 'feature/loaves', 'codex', CWD, 'bakery'],
  );
  assert.equal(v.title, 'Grams on loaf labels');
  assert.deepEqual([v.status, v.turns], ['idle', 0]);
  // Codex doesn't price its requests as it goes; the history does.
  assert.deepEqual([v.cost, v.costKnown], [null, false]);

  await f.next(2); // the turn's settings, and task_started
  v = f.view('09:05:01');
  assert.deepEqual([v.status, v.zone, v.turns], ['thinking', 'desk', 1]);
  assert.deepEqual([v.model, v.modelName], ['gpt-6-sol', 'GPT-6 Sol']);

  await f.next(4); // its instructions, the environment, and your message (twice, as Codex writes it)
  assert.equal(f.view('09:05:02').title, 'Grams on loaf labels');
  await f.next(); // reasoning
  assert.equal(f.view('09:05:04').status, 'thinking');

  await f.next(); // a search, run from a script
  v = f.view('09:05:05');
  assert.deepEqual([v.status, v.zone], ['working', 'books']);
  assert.deepEqual([v.tool.name, v.tool.category, v.tool.detail], ['exec', 'search', 'rg -n "weightOz" src/labels']);
  await f.next();
  assert.equal(f.view('09:05:06').status, 'thinking');

  // token_count gives running totals: 18,000 in (12,000 of them cached) and 400 out.
  await f.next(2);
  v = f.view('09:05:07');
  assert.deepEqual(v.tokens, { input: 6000, output: 400, cacheRead: 12_000, cacheWrite: 0, total: 18_400 });
  assert.deepEqual(v.context, { used: 18_400, window: 258_400, pct: 7 });

  await f.next(); // a patch, applied from a script
  v = f.view('09:05:20');
  assert.deepEqual([v.zone, v.tool.category, v.tool.detail], ['desk', 'edit', 'print.js']);
  await f.next();
  v = f.view('09:05:22');
  assert.deepEqual(v.lines, { added: 2, removed: 1 });
  assert.deepEqual(
    v.files.map((x) => [x.path, x.edits, x.added, x.removed]),
    [['src/labels/print.js', 1, 2, 1]],
  );

  await f.next(); // the tests, which are slow but never a permission prompt
  v = f.view('09:06:30');
  assert.deepEqual([v.zone, v.tool.category, v.tool.detail, v.needsYou], ['servers', 'bash', 'npm test', null]);
  await f.next(); // and fail
  v = f.view('09:05:34');
  assert.equal(v.errors, 1);
  assert.equal(v.lastErrorAt, f.clock('09:05:33'));

  await f.rest();
  v = f.view('09:06:02');
  assert.deepEqual([v.status, v.zone, v.needsYou, v.endReason], ['waiting', 'lounge', 'turn', 'done']);
  assert.deepEqual(v.counts, { search: 1, edit: 2, bash: 2 });
  assert.deepEqual(v.lines, { added: 3, removed: 2 });
  assert.deepEqual(
    v.results.map((r) => r[1]),
    [1, 1, 0, 1, 1],
  );
  assert.deepEqual(v.tokens, { input: 11_000, output: 1200, cacheRead: 30_000, cacheWrite: 0, total: 42_200 });
  // How full it is now: the last request's input and output, against the window Codex reported.
  assert.deepEqual(v.context, { used: 23_800, window: 258_400, pct: 9 });
  assert.equal(v.snippet, 'Shelf labels now print loaf weights in grams, and the tests pass.');
  assert.deepEqual([v.lastTool.name, v.lastTool.detail], ['exec', 'npm test']);
  assert.equal(v.turns, 1);
});

test('a Codex turn you stop ends as interrupted, and the next one shows its patch waiting for you', async (t) => {
  const f = await follow(t, 'codex', CODEX.second);
  await f.next(4); // the turn starts with your message
  await f.next(); // a script runs a command
  let v = f.view('09:20:06');
  assert.deepEqual([v.zone, v.tool.category, v.tool.detail], ['servers', 'bash', 'node scripts/profile-oven.js']);
  await f.next(3); // it fails; the token count

  await f.next(); // a patch, waiting for you to allow it
  v = f.view('09:20:18');
  assert.deepEqual([v.zone, v.tool.name, v.tool.detail, v.needsYou], ['desk', 'apply_patch', 'schedule.js', null]);
  assert.equal(f.view('09:20:23').needsYou, 'approval');

  await f.next(2); // you turn it down, and stop the turn
  v = f.view('09:20:42');
  assert.deepEqual([v.status, v.needsYou, v.endReason], ['waiting', 'turn', 'interrupted']);
  assert.equal(f.recent().at(-1), 'Stopped by you');

  await f.rest(); // a new turn: a compaction, and a patch waiting for you
  v = f.view('09:22:13');
  assert.equal(v.turns, 2);
  assert.deepEqual([v.status, v.zone, v.needsYou], ['working', 'desk', null]);
  assert.deepEqual(
    [v.tool.name, v.tool.category, v.tool.detail],
    ['apply_patch', 'edit', '0042_tray_bake_at_index.sql'],
  );
  assert.equal(f.view('09:22:18').needsYou, 'approval');
  // After the compaction the conversation is much smaller.
  assert.deepEqual(v.context, { used: 3200, window: 258_400, pct: 1 });
  assert.equal(v.title, 'Profile the oven schedule page and make it faster.');
});

test('a Codex subagent works under the session that started it, and is done when its task completes', async (t) => {
  const f = await follow(t, 'codex', CODEX.sub);
  let v = f.view('09:05:35');
  assert.deepEqual([v.kind, v.parentId], ['sub', `codex-${CODEX.main}`]);

  await f.next(4); // its settings, task_started and its assignment
  await f.next(); // it updates its plan
  v = f.view('09:05:36');
  assert.deepEqual([v.zone, v.tool.category, v.tool.detail], ['board', 'plan', 'updating the plan']);
  await f.next(2); // and searches the web, which is done as soon as it's written
  v = f.view('09:05:37');
  assert.equal(v.counts.web, 1);
  assert.equal(v.tool, null);

  await f.rest();
  v = f.view('09:05:47');
  assert.deepEqual([v.status, v.zone, v.needsYou], ['done', 'desk', null]);
  assert.deepEqual(v.counts, { plan: 1, web: 1, search: 1 });
  assert.equal(v.model, 'gpt-6-luna');
  assert.equal(v.title, 'Check the label templates for any other ounce values.');
  // A finished subagent stays a little while to hand in its work, then leaves.
  assert.equal(f.view('09:05:50').present, true);
  assert.equal(f.view('09:06:10').present, false);
});

test('a Codex compaction is counted in the live view, as it is in the history', async (t) => {
  const f = await follow(t, 'codex', CODEX.second);
  await f.rest();
  assert.equal(f.view('09:22:13').compactions, 1);
});

test('a Codex script that failed counts as a failed tool call', async (t) => {
  const f = await follow(t, 'codex', CODEX.second, { start: 7 }); // up to the script's "Script failed" output
  const v = f.view('09:20:10');
  assert.equal(v.errors, 1);
  assert.deepEqual(
    v.results.map((r) => r[1]),
    [0],
  );
});

test('a patch you turn down in Codex is neither a failure nor a change, as for Claude Code', async (t) => {
  const f = await follow(t, 'codex', CODEX.second, { start: 11 }); // up to the turned-down patch's output
  const v = f.view('09:20:41');
  assert.deepEqual(v.lines, { added: 0, removed: 0 });
  assert.deepEqual(v.files, []);
  assert.ok(!v.results.some((r) => r[2] === 'apply_patch'), 'a call you turned down is not a result either way');
});
