// The live view of Pi sessions, from the transcripts in test/fixtures/pi, read
// line by line through the watcher as the server reads them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CWD, PI } from './fixtures/index.js';
import { follow } from './fixtures/follow.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('a Pi session, line by line: each reply lands whole with its tool calls, results close them, and every branch counts', async (t) => {
  // Its header, the model and thinking level, and the system prompt.
  const f = await follow(t, 'pi', PI.main, { start: 4 });
  let v = f.view('09:50:01');
  assert.deepEqual([v.nativeId, v.entrypoint, v.cwd, v.model], [PI.main, 'pi', CWD, 'claude-sonnet-4-5']);
  assert.deepEqual([v.status, v.turns], ['idle', 0]);

  await f.next(); // your message
  v = f.view('09:50:02');
  assert.deepEqual([v.status, v.turns, v.title], ['thinking', 1, 'Add a gluten-free flag to the recipe cards.']);

  // A reply comes whole, priced by Pi itself: here $0.0273.
  await f.next();
  v = f.view('09:50:06');
  assert.deepEqual(
    [v.status, v.zone, v.tool.name, v.tool.category, v.tool.detail],
    ['working', 'books', 'read', 'read', 'recipe-card.js'],
  );
  near(v.cost, 0.0273);
  assert.equal(v.costKnown, true);
  assert.equal(v.tokens.total, 7280);
  assert.deepEqual(v.context, { used: 7280, window: 200_000, pct: 4 });
  await f.next();
  assert.equal(f.view('09:50:08').status, 'thinking');

  // Two tool calls in one reply: the latest is the one on show until both are done.
  await f.next();
  v = f.view('09:50:15');
  assert.deepEqual([v.zone, v.tool.name, v.tool.detail], ['servers', 'bash', 'npm test']);
  await f.next(); // the edit went through
  v = f.view('09:50:16');
  assert.deepEqual(v.lines, { added: 2, removed: 1 });
  assert.equal(v.tool.name, 'bash');
  await f.next(); // the tests failed
  v = f.view('09:50:21');
  assert.deepEqual([v.status, v.errors, v.lastErrorAt], ['thinking', 1, f.clock('09:50:20')]);

  await f.next(2); // a write
  assert.deepEqual(f.view('09:50:32').lines, { added: 4, removed: 1 });
  await f.next(); // the reply that ends the turn
  v = f.view('09:50:41');
  assert.deepEqual([v.status, v.zone, v.needsYou, v.endReason], ['waiting', 'lounge', 'turn', 'done']);
  assert.equal(v.snippet, 'Recipe cards now show a GF badge for gluten-free recipes.');

  await f.next(); // named with /name
  assert.equal(f.view('09:51:00').title, 'Gluten-free badge');
  await f.next(); // compacted, which Pi prices too
  v = f.view('09:55:01');
  assert.deepEqual([v.compactions, v.lastCompactAt], [1, f.clock('09:55:00')]);
  near(v.cost, 0.0273 + 0.00675 + 0.005745 + 0.00396 + 0.0285);

  // Back to an earlier point with /tree: the summary of the branch left, and a new message from there.
  await f.rest();
  v = f.view('09:56:21');
  assert.deepEqual([v.status, v.turns], ['waiting', 2]);
  near(v.cost, 0.07983);
  assert.equal(v.tokens.total, 47_480);
  assert.deepEqual(v.context, { used: 7030, window: 200_000, pct: 4 });
  assert.deepEqual(v.counts, { read: 1, edit: 2, bash: 1 });
  assert.deepEqual(
    v.results.map((r) => [r[1], r[2]]),
    [
      [1, 'read'],
      [1, 'edit'],
      [0, 'bash'],
      [1, 'write'],
    ],
  );
  assert.deepEqual(
    v.files.map((x) => [x.path, x.added, x.removed]),
    [
      [`${CWD}/test/__snapshots__/recipe-card.txt`, 2, 0],
      [`${CWD}/src/cards/recipe-card.js`, 2, 1],
    ],
  );
});

test('a /fork counts only its own work, not the conversation it copied, and Esc mid-reply is an interruption', async (t) => {
  // Its header, the start of the first session copied with the old times, and its own first message.
  const f = await follow(t, 'pi', PI.fork, { start: 8 });
  let v = f.view('09:58:31');
  assert.deepEqual([v.status, v.turns, v.title], ['thinking', 1, 'Make the badge green.']);
  assert.deepEqual([v.tokens.total, v.cost, v.counts, v.startedAt], [0, 0, {}, f.clock('09:58:30')]);
  await f.next(2); // an edit
  assert.deepEqual(f.view('09:58:42').lines, { added: 1, removed: 1 });

  await f.next(); // you press Esc while it replies
  v = f.view('09:58:51');
  assert.deepEqual([v.status, v.needsYou, v.endReason], ['waiting', 'turn', 'interrupted']);
  assert.equal(f.recent().at(-1), 'Stopped by you');

  await f.rest(); // a new message, and a read under way
  v = f.view('09:59:16');
  assert.deepEqual(
    [v.status, v.zone, v.tool.name, v.tool.detail, v.turns],
    ['working', 'books', 'read', 'theme.js', 2],
  );
  near(v.cost, 0.01011);
  assert.equal(v.tokens.total, 19_700);
  // A minute or two ago, so it's in the office's news feed.
  assert.ok(f.feed.items.some((x) => x.agentId === `pi-${PI.fork}` && x.text === 'Stopped by you'));
});
