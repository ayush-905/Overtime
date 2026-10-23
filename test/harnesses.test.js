import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HARNESSES, SOURCES, isSessionId, nativeIdOf, openHarnesses } from '../lib/harnesses/index.js';
import { createUsageIndex } from '../lib/usage-index.js';
import { createWatcher } from '../lib/watcher.js';
import { createFeed, touch, startTurn, endTurn } from '../lib/agents.js';
import { sessionList } from '../lib/insights.js';
import { notePrompt } from '../lib/titles.js';

test('every harness gives the core what it needs, and the dashboard lists the same ones', async () => {
  const prefixes = new Set();
  for (const h of HARNESSES) {
    assert.match(h.id, /^[a-z]+$/, h.id);
    assert.ok(h.name && typeof h.folder === 'function', h.id);
    assert.ok(h.nativeId instanceof RegExp, h.id);
    assert.ok(!prefixes.has(h.prefix), `${h.id}'s prefix`);
    prefixes.add(h.prefix);
    assert.equal(typeof h.resume.command('x'), 'string', h.id);
    assert.ok(h.process.exe && h.process.script instanceof RegExp, h.id);
    assert.ok(
      h.tools.reads instanceof Set &&
        h.tools.writes instanceof Set &&
        typeof h.tools.command === 'function' &&
        typeof h.tools.delegate === 'function',
      h.id,
    );
    if (h.commands)
      assert.ok(typeof h.commands.dir() === 'string' && h.commands.use('x').endsWith('x') && h.commands.noun, h.id);
    if (h.resume.app) assert.equal(typeof h.resume.app, 'function', h.id);
    if (h.skills) {
      assert.equal(typeof h.skills.kind, 'function', h.id);
      const where = { at: '', cwds: [], exists: () => false, folders: () => [] };
      assert.ok(['personal', 'project', 'plugin', 'app', 'builtin'].includes(h.skills.kind('x', where).kind), h.id);
      if (h.skills.alias) assert.ok(h.skills.alias('x') === null || typeof h.skills.alias('x') === 'string', h.id);
    }
    const open = h.open({ dir: os.tmpdir(), piHome: os.tmpdir() });
    assert.ok(
      typeof open.transcripts === 'function' && typeof open.live === 'function' && typeof open.indexLine === 'function',
      h.id,
    );
  }
  // Only one harness, Claude Code, goes without a prefix, and ids never collide.
  assert.deepEqual(
    HARNESSES.filter((h) => !h.prefix).map((h) => h.id),
    ['claude'],
  );
  const ui = await readFile(new URL('../ui/src/lib/sources.ts', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(ui.match(/export const SOURCES = (\[[^\]]*\])/)[1].replace(/'/g, '"')), SOURCES);
  assert.ok(isSessionId('codex-12345678-1234-1234-1234-123456789012') && !isSessionId('codex-nope'));
  assert.equal(nativeIdOf('codex-12345678-1234-1234-1234-123456789012'), '12345678-1234-1234-1234-123456789012');
});

test('a new harness is one module: the index and the live view take it through the interface alone', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-toy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = Date.now();
  // A made-up agent that writes one line per event: { t, prompt } or { t, tokens, cost }.
  const toy = {
    id: 'toy',
    name: 'Toy',
    prefix: 'toy-',
    nativeId: /^\w+$/,
    open: ({ dir }) => ({
      dir,
      async *transcripts(since) {
        const { readdir, stat } = await import('node:fs/promises');
        for (const name of await readdir(dir)) {
          const file = path.join(dir, name);
          const st = await stat(file);
          const native = path.basename(name, '.jsonl');
          if (st.mtimeMs >= since)
            yield {
              file,
              st,
              id: `toy-${native}`,
              nativeId: native,
              session: `toy-${native}`,
              sub: false,
              parentId: null,
            };
        }
      },
      live(feed, a, ev) {
        if (ev.prompt) startTurn(feed, a, ev.t, ev.prompt);
        else endTurn(feed, a, ev.t);
        touch(a, ev.t);
      },
      indexLine(f, line) {
        const ev = JSON.parse(line);
        f.cwd = '/work/toyshop';
        f.project = 'toyshop';
        if (ev.prompt) {
          f.prompts.push([ev.t, f, 'human', ev.prompt]);
          notePrompt(f, ev.prompt);
        } else f.events.push([ev.t, ev.cost, ev.tokens, 'toy-1', f, { costKnown: true }]);
      },
    }),
  };
  const dir = path.join(root, 'toy');
  await mkdir(dir);
  await writeFile(
    path.join(dir, 'abc.jsonl'),
    `${[
      { t: now - 5000, prompt: 'Sort the blocks' },
      { t: now - 2000, tokens: 1200, cost: 0.03 },
    ]
      .map(JSON.stringify)
      .join('\n')}\n`,
  );
  const harnesses = [{ ...toy, ...toy.open({ dir }) }];

  const index = createUsageIndex({ harnesses });
  await index.scan();
  const [s] = sessionList(index, new Map(), now);
  assert.deepEqual([s.id, s.source, s.title, s.project], ['toy-abc', 'toy', 'Sort the blocks', 'toyshop']);
  assert.equal(index.scope('toy').events()[0][1], 0.03);

  const watcher = createWatcher({ harnesses, feed: createFeed() });
  await watcher.discover();
  const a = watcher.agents.get('toy-abc');
  assert.equal(a.source, 'toy');
  assert.equal(a.firstPrompt, 'Sort the blocks');
  assert.equal(a.status, 'waiting');
  assert.deepEqual(await watcher.onThisMac(), { folders: [dir], sources: ['toy'] }); // its folder is there, so it's a view of its own
  assert.equal(openHarnesses({ dirs: { claude: root } }).length, 1);
});

test("Claude Code's workflow subagents count toward their session, like its other subagents", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = '11111111-2222-4333-8444-555555555555';
  const folder = path.join(root, '-work-kettle');
  const subs = path.join(folder, session, 'subagents');
  const run = path.join(subs, 'workflows', 'wf_1a2b3c4d-567');
  await mkdir(run, { recursive: true });
  const at = new Date(Date.now() - 60_000).toISOString();
  const reply = (id, output) =>
    `${JSON.stringify({
      type: 'assistant',
      timestamp: at,
      cwd: '/work/kettle',
      message: {
        id,
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Done.' }],
        usage: {
          input_tokens: 1000,
          output_tokens: output,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    })}\n`;
  await writeFile(path.join(folder, `${session}.jsonl`), reply('msg_main', 100));
  await writeFile(path.join(subs, 'agent-a1.jsonl'), reply('msg_sub', 200));
  await writeFile(path.join(run, 'agent-b2.jsonl'), reply('msg_workflow', 300));

  const index = createUsageIndex({ claudeDir: root, keepText: false });
  await index.scan();
  const records = index.recordsOf(session);
  assert.deepEqual(records.map((r) => [r.id, r.sub]).sort(), [
    [session, false],
    ['a1', true],
    ['b2', true],
  ]);
  assert.equal(index.events().length, 3);
  assert.equal(
    index.events().reduce((n, e) => n + e[2], 0),
    3600,
  );
});
