import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUsageIndex } from '../lib/usage-index.js';
import { notePrompt } from '../lib/titles.js';
import { newAgent, createFeed } from '../lib/agents.js';
import { applyClaudeEvent } from '../lib/claude.js';

const now = Date.now();
const at = (s) => new Date(now - 3_600_000 + s * 1000).toISOString();

test('a session is named by its first message that says something', () => {
  const named = (...texts) => {
    const x = {};
    for (const t of texts) notePrompt(x, t);
    return x.firstPrompt;
  };
  assert.equal(named('hi', 'Fix the login redirect'), 'Fix the login redirect');
  assert.equal(named('hello!', 'ok', 'Add a CSV export'), 'Add a CSV export');
  assert.equal(named('hi'), 'hi');
  assert.equal(named('Fix the login redirect', 'hi', 'Now the tests'), 'Fix the login redirect');
  assert.equal(named('hi there, fix the login'), 'hi there, fix the login');
  // Punctuation alone never names one; quitting does only if nothing else was said.
  assert.equal(named('.', 'hi', 'Review my current changes'), 'Review my current changes');
  assert.equal(named('...', '?'), undefined);
  assert.equal(named('exit', '/exit'), 'exit');
  assert.equal(named('exit', 'Add a CSV export'), 'Add a CSV export');
});

test("Claude Code's own title names a session, and one you gave it wins", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-titles-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const user = (s, text) => ({
    type: 'user',
    uuid: `u${s}`,
    timestamp: at(s),
    message: { content: text },
    origin: { kind: 'human' },
    cwd: '/work/shop',
  });
  const reply = (s) => ({
    type: 'assistant',
    timestamp: at(s),
    message: { id: `a${s}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 20 } },
  });
  const write = (id, lines) =>
    writeFile(path.join(claudeDir, 'project', `${id}.jsonl`), `${lines.map(JSON.stringify).join('\n')}\n`);
  await write('aaaaaaaa-0000-0000-0000-000000000001', [
    user(0, 'claude --resume 581ca1e1 "Continue"'),
    reply(5),
    { type: 'ai-title', aiTitle: 'Resolve district and city problem', sessionId: 'x' },
  ]);
  await write('aaaaaaaa-0000-0000-0000-000000000002', [
    user(0, 'hi'),
    reply(5),
    user(10, 'Why does the city list stay empty?'),
    reply(15),
  ]);
  const renamed = 'aaaaaaaa-0000-0000-0000-000000000003';
  await write(renamed, [
    { type: 'custom-title', customTitle: 'Checkout bug' },
    user(0, 'Look at checkout'),
    reply(5),
    { type: 'ai-title', aiTitle: 'Investigate checkout flow' },
  ]);
  const idx = createUsageIndex({ claudeDir, codexDir: path.join(root, 'none') });
  await idx.scan();
  const titles = Object.fromEntries(idx.sessions().map((s) => [s.id.slice(-1), s.title]));
  assert.deepEqual(titles, {
    1: 'Resolve district and city problem',
    2: 'Why does the city list stay empty?',
    3: 'Checkout bug',
  });

  // A session that's open reads the same lines as they come.
  const a = newAgent(renamed);
  const feed = createFeed();
  applyClaudeEvent(feed, a, { type: 'ai-title', aiTitle: 'Investigate checkout flow' });
  assert.equal(a.title, 'Investigate checkout flow');
  applyClaudeEvent(feed, a, { type: 'custom-title', customTitle: 'Checkout bug' });
  applyClaudeEvent(feed, a, { type: 'ai-title', aiTitle: 'Something newer' });
  assert.equal(a.title, 'Checkout bug');
});

test("a Codex chat is named by Codex's name for it, the latest one", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-codex-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexDir = path.join(root, 'sessions');
  await mkdir(codexDir, { recursive: true });
  const id = '01a0e901-6a6a-7490-bb42-c13bd8077275';
  const ev = (type, payload, s = 0) => ({ type, payload, timestamp: at(s) });
  const usage = { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 };
  const rows = [
    ev('session_meta', { id, cwd: '/work/shop', model_provider: 'openai' }),
    ev('turn_context', { model: 'gpt-6-sol' }),
    ev('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }, 1),
    ev('event_msg', { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } }, 2),
  ];
  await writeFile(path.join(codexDir, `rollout-${id}.jsonl`), `${rows.map(JSON.stringify).join('\n')}\n`);
  const index = path.join(root, 'session_index.jsonl');
  await writeFile(
    index,
    `${JSON.stringify({ id, thread_name: 'Respond to greeting', updated_at: '2026-09-28T10:00:00Z' })}\n`,
  );
  const idx = createUsageIndex({ claudeDir: path.join(root, 'none'), codexDir });
  await idx.scan();
  assert.equal(idx.sessions()[0].title, 'Respond to greeting');
  // Renamed in Codex: a newer line.
  await appendFile(
    index,
    `${JSON.stringify({ id, thread_name: 'Explain vanilla JS frontend choice', updated_at: '2026-09-28T11:00:00Z' })}\n`,
  );
  await idx.scan();
  assert.equal(idx.sessions()[0].title, 'Explain vanilla JS frontend choice');
});
