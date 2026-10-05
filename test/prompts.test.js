import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUsageIndex } from '../lib/usage-index.js';
import { commandBody, promptWords, repeatedPrompts, writeCommand } from '../lib/prompts.js';

const HOUR = 3_600_000;

/** Sessions with your prompts in them: [session, hours ago, text] each. */
async function sessions(t, prompts) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-prompts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const now = Date.now();
  const files = new Map();
  prompts.forEach(([session, hoursAgo, text], i) => {
    const line = {
      type: 'user',
      timestamp: new Date(now - hoursAgo * HOUR).toISOString(),
      cwd: '/work/shop',
      uuid: `u${i}`,
      message: { content: text },
    };
    files.set(session, [...(files.get(session) || []), JSON.stringify(line)]);
  });
  for (const [session, lines] of files)
    await writeFile(path.join(claudeDir, 'project', `${session}.jsonl`), `${lines.join('\n')}\n`);
  const idx = createUsageIndex({ claudeDir, codexDir: path.join(root, 'none') });
  await idx.scan();
  return { idx, now, root };
}

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

test('a prompt sent on occasions an hour apart is a repeat; the same moment twice, or a retry, is not', async (t) => {
  const { idx, now } = await sessions(t, [
    [A, 50, 'Review PR 1482 and leave comments on naming, tests and anything risky'],
    [B, 26, 'Review PR 1479 and leave comments on naming, tests and anything risky'],
    // The same message copied into a resumed session's transcript, at the same moment.
    [C, 26, 'Review PR 1479 and leave comments on naming, tests and anything risky'],
    [B, 2, 'Please review PR 1500 and leave comments on naming tests and anything risky'],
    // Sent twice within a few minutes: trying again, not repeating.
    [A, 5, 'Summarize the deploy logs for errors and group them by service'],
    [A, 4.95, 'Summarize the deploy logs for errors and group them by service'],
    // Too short to be worth a command.
    [A, 30, 'try again'],
    [B, 3, 'try again'],
  ]);
  const r = repeatedPrompts(idx, now, idx.youTextAt);
  assert.equal(r.groups.length, 1);
  const g = r.groups[0];
  assert.equal(g.count, 3);
  assert.equal(g.sessions, 2);
  assert.equal(g.name, 'review-pr-leave');
  // Built from the latest, without its "Please", whatever the punctuation.
  assert.equal(g.body, 'Review PR $ARGUMENTS and leave comments on naming tests and anything risky');
  assert.equal(g.argument, true);
});

test('words are made alike: links, paths, numbers and ids', () => {
  assert.deepEqual(promptWords('Fix #42 in ~/src/app.js, see https://x.io/y'), [
    'fix',
    '<n>',
    'in',
    '<path>',
    'see',
    '<link>',
  ]);
  assert.deepEqual(commandBody(['same text here now', 'same text here now']), {
    body: 'same text here now',
    argument: false,
  });
  assert.deepEqual(commandBody(['Fix the comments on https://github.com/a/b/pull/935.']), {
    body: 'Fix the comments on $ARGUMENTS.',
    argument: true,
  });
  assert.deepEqual(commandBody(['summarize the standup for today', 'summarize the standup for yesterday please']), {
    body: 'summarize the standup for $ARGUMENTS',
    argument: true,
  });
});

test('a command is written once, where the agent reads it, and never over a file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-commands-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = [process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME];
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  t.after(() => {
    if (before[0] == null) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before[0];
    if (before[1] == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = before[1];
  });
  const made = await writeCommand({
    target: 'claude',
    name: 'review-pr',
    description: 'Review a PR',
    body: 'Review PR $ARGUMENTS',
  });
  assert.equal(made.ok, true);
  assert.equal(made.use, '/review-pr');
  const text = await readFile(path.join(root, 'claude', 'commands', 'review-pr.md'), 'utf8');
  assert.match(text, /^---\ndescription: "Review a PR"\nargument-hint: .+\n---\n\nReview PR \$ARGUMENTS\n$/);
  const again = await writeCommand({ target: 'claude', name: 'review-pr', body: 'Something else' });
  assert.equal(again.status, 409);
  assert.equal(await readFile(path.join(root, 'claude', 'commands', 'review-pr.md'), 'utf8'), text);
  const codex = await writeCommand({ target: 'codex', name: 'run-tests', body: 'Run the tests' });
  assert.equal(codex.use, '/prompts:run-tests');
  assert.equal(await readFile(path.join(root, 'codex', 'prompts', 'run-tests.md'), 'utf8'), 'Run the tests\n');
  assert.equal((await writeCommand({ target: 'claude', name: '../evil', body: 'x' })).status, 400);
  assert.equal((await writeCommand({ target: 'vim', name: 'x', body: 'x' })).status, 400);
  assert.equal((await writeCommand({ target: 'claude', name: 'empty', body: '  ' })).status, 400);
});

test('a conversation written into its transcript again counts once, and each message keeps its cost', async (t) => {
  const { sessionDetail } = await import('../lib/insights.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-rewrite-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const start = Date.now() - 5 * HOUR;
  const at = (ms) => new Date(start + ms).toISOString();
  const you = (ms, n, text) => ({
    type: 'user',
    uuid: `u${n}`,
    timestamp: at(ms),
    cwd: '/work/shop',
    message: { content: text },
  });
  const reply = (ms, n, cost) => ({
    type: 'assistant',
    uuid: `a${n}`,
    timestamp: at(ms),
    cwd: '/work/shop',
    message: {
      id: `m${n}`,
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: (cost * 1_000_000) / 3, output_tokens: 0 },
      content: [{ type: 'tool_use', id: `t${n}`, name: 'Write', input: { file_path: '/x', content: 'a\nb\n' } }],
    },
  });
  // Each write went through, which is when its lines count.
  const written = (ms, n) => ({
    type: 'user',
    uuid: `r${n}`,
    timestamp: at(ms),
    cwd: '/work/shop',
    message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'File created successfully at: /x' }] },
  });
  const first = [
    you(0, 1, 'First task for the agent'),
    reply(60_000, 1, 1),
    written(61_000, 1),
    you(HOUR, 2, 'Second task for the agent'),
    reply(HOUR + 60_000, 2, 2),
    written(HOUR + 61_000, 2),
  ];
  // The app wrote the whole conversation in again, then it carried on.
  const lines = [
    ...first,
    ...first,
    you(2 * HOUR, 3, 'Third task for the agent'),
    reply(2 * HOUR + 60_000, 3, 3),
    written(2 * HOUR + 61_000, 3),
  ];
  await writeFile(path.join(claudeDir, 'project', `${A}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const idx = createUsageIndex({ claudeDir, codexDir: path.join(root, 'none') });
  await idx.scan();
  const d = sessionDetail(idx, A);
  assert.equal(d.messages.count, 3);
  assert.deepEqual(
    d.messages.list.map((m) => Math.round(m.cost)),
    [3, 2, 1],
  );
  assert.deepEqual(d.lines, { added: 6, removed: 0 });
  assert.equal(idx.prompts().length, 3);
});
