import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMerger } from '../web/shared/live.js';
import { scratch, startServer } from './helpers.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const line = (x) => `${JSON.stringify(x)}\n`;
const ask = (text) =>
  line({
    type: 'user',
    timestamp: new Date().toISOString(),
    cwd: '/work/shop',
    message: { role: 'user', content: text },
  });

/** The live feed's messages, as they come. */
async function follow(t, port) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async function next() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.startsWith('data: ')) return { bytes: block.length, msg: JSON.parse(block.slice(6)) };
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('the feed ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

test('the live feed sends an agent again only when it changed, and the page puts the whole picture back together', async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, 'claude', 'shop'), { recursive: true });
  const fileA = path.join(dir, 'claude', 'shop', `${A}.jsonl`);
  await writeFile(fileA, ask('Count the till'));
  await writeFile(path.join(dir, 'claude', 'shop', `${B}.jsonl`), ask('Sweep the floor'));
  const { port } = await startServer(t, dir, 0);
  const next = await follow(t, port);
  const merge = createMerger();

  // Everything comes first.
  const first = await next();
  let snap = merge(first.msg);
  assert.deepEqual(snap.agents.map((a) => a.id).sort(), [A, B]);
  const b = snap.agents.find((a) => a.id === B);

  // A works on: the next update with agents in it has A alone.
  await appendFile(
    fileA,
    line({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      cwd: '/work/shop',
      message: {
        id: 'm1',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/work/shop/till.txt' } }],
      },
    }),
  );
  let update;
  for (let i = 0; i < 40 && !update; i++) {
    const { msg } = await next();
    snap = merge(msg);
    update = msg.items?.find(([p]) => p[0] === 'agents');
  }
  assert.ok(update, 'an update with agents in it came');
  const [, order, items] = update;
  assert.equal(order, null);
  assert.deepEqual(
    items.map((a) => a.id),
    [A],
  );
  assert.equal(snap.agents.find((a) => a.id === A).tool.name, 'Read');
  assert.equal(
    snap.agents.find((a) => a.id === B),
    b,
  );
  // Nothing new: the heartbeat after it changes nothing.
  for (let i = 0; i < 20; i++) {
    const { msg } = await next();
    if (!msg.changes.length && !msg.items) {
      assert.equal(merge(msg), snap);
      return;
    }
    snap = merge(msg);
  }
  assert.fail('no quiet heartbeat came');
});

test('a new transcript shows up within a few seconds', async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, 'claude', 'shop'), { recursive: true });
  const { port } = await startServer(t, dir, 0);
  const next = await follow(t, port);
  const merge = createMerger();
  let snap = merge((await next()).msg);
  assert.deepEqual(snap.agents, []);
  await writeFile(path.join(dir, 'claude', 'shop', `${A}.jsonl`), ask('Open the shop'));
  const start = Date.now();
  while (!snap.agents.some((a) => a.id === A)) {
    assert.ok(Date.now() - start < 8000, 'it showed up in time');
    snap = merge((await next()).msg);
  }
});
