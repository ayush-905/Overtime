import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFeed } from '../lib/agents.js';
import { createWatcher } from '../lib/watcher.js';

const SESSION = '12345678-1234-1234-1234-123456789012';

/** A Claude Code projects folder with one session in it; returns the folder and the transcript's path. */
async function claudeFolder(t, lines) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'overtime-watcher-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'shop'));
  const file = path.join(dir, 'shop', `${SESSION}.jsonl`);
  await writeFile(file, lines.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');
  return { dir, file };
}

/** `n` turns: you ask, and the agent reads a file (with some padding, to make the transcript as big as needed). */
function turns(n, { from = 0, pad = 0 } = {}) {
  const start = Date.now() - 60_000;
  const at = (i) => new Date(start + i).toISOString();
  const lines = [];
  for (let i = from; i < from + n; i++) {
    lines.push({ type: 'user', timestamp: at(i), cwd: '/work/shop', message: { role: 'user', content: `Look at file ${i}` } });
    lines.push({ type: 'assistant', timestamp: at(i), cwd: '/work/shop', message: { id: `m${i}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `/work/shop/f${i}.js`, note: 'x'.repeat(pad) } }] } });
  }
  return lines;
}

const read = async (dir) => {
  const watcher = createWatcher({ claudeDir: dir, feed: createFeed() });
  await watcher.discover();
  return watcher;
};

test('a transcript is counted once even when a tick comes while discovery is still reading it', async (t) => {
  // Over 4 MB, so it's read in pieces and the tick has time to arrive in between.
  const { dir } = await claudeFolder(t, turns(12_000, { pad: 400 }));
  const expected = (await read(dir)).agents.get(SESSION);

  const watcher = createWatcher({ claudeDir: dir, feed: createFeed() });
  let done = false;
  const discovering = watcher.discover().finally(() => { done = true; });
  // A second discovery while the first is under way joins it.
  const again = watcher.discover();
  while (!done) {
    await watcher.tick();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all([discovering, again]);
  await watcher.tick();
  const a = watcher.agents.get(SESSION);
  assert.equal(a.turns, expected.turns);
  assert.equal(a.turns, 12_000);
  assert.deepEqual(a.counts, expected.counts);
});

test('a transcript that gets shorter is read again from the start, not on top of what it had', async (t) => {
  const { dir, file } = await claudeFolder(t, turns(50));
  const watcher = await read(dir);
  assert.equal(watcher.agents.get(SESSION).turns, 50);
  await writeFile(file, turns(3, { from: 100 }).map((x) => JSON.stringify(x)).join('\n') + '\n');
  await watcher.tick();
  const a = watcher.agents.get(SESSION);
  assert.equal(a.turns, 3);
  assert.equal(a.firstPrompt, 'Look at file 100');
});

test("a line the reader can't make sense of is passed over, and the lines after it still count", async (t) => {
  const broken = { type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'bad', content: [{ type: 'tool_use', id: 'tx', input: {} }] } };
  const { dir } = await claudeFolder(t, [...turns(2), broken, 'not json', ...turns(2, { from: 2 })]);
  const errors = [];
  const error = console.error;
  console.error = (...parts) => errors.push(parts.join(' '));
  t.after(() => { console.error = error; });
  const watcher = await read(dir);
  assert.equal(watcher.agents.get(SESSION).turns, 4);
  // Said once, for the file it was in.
  assert.equal(errors.length, 1);
  assert.match(errors[0], new RegExp(`${SESSION}\\.jsonl`));
});
