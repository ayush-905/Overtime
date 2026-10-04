import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyPiRecord, piEdit, piFileId, piSessionsDir, piUsage, piWindow, refreshPiWindows } from '../lib/pi-usage.js';
import { applyPiEvent } from '../lib/pi.js';
import { createFeed, newAgent, view } from '../lib/agents.js';
import { createUsageIndex } from '../lib/usage-index.js';
import { sessionDetail, turnDetail } from '../lib/insights.js';
import { resumeOptions } from '../lib/resume.js';
import { isSessionId, nativeIdOf } from '../lib/harnesses/index.js';

const id = '0199b1c2-3d4e-7f60-8a9b-0c1d2e3f4a5b';
const now = Date.now();
const iso = (s = 0) => new Date(now + s * 1000).toISOString();
let n = 0;
const entry = (type, fields, s = 0) => ({ type, id: `e${++n}`, parentId: null, timestamp: iso(s), ...fields });
const usage = (input, output, cacheRead = 0, cacheWrite = 0, total = 0.01) => ({
  input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: input * 3e-6, output: output * 15e-6, cacheRead: cacheRead * 3e-7, cacheWrite: cacheWrite * 3.75e-6, total },
});
const user = (text, s) => entry('message', { message: { role: 'user', content: text, timestamp: now + s * 1000 } }, s);
const reply = (content, stopReason, s, u = usage(100, 20)) => entry('message', { message: { role: 'assistant', content, api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-5', usage: u, stopReason, timestamp: now + s * 1000 } }, s);
const result = (toolCallId, toolName, text, isError, s) => entry('message', { message: { role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text }], isError, timestamp: now + s * 1000 } }, s);
const header = (extra = {}, s = 0) => ({ type: 'session', version: 3, id, timestamp: iso(s), cwd: '/work/shop', ...extra });

const session = () => [
  header(),
  user('Fix the failing test in cart.js', 1),
  reply([{ type: 'thinking', thinking: 'Look first' }, { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'src/cart.js' } }], 'toolUse', 2),
  result('c1', 'read', 'export function total() {}', false, 3),
  reply([{ type: 'toolCall', id: 'c2', name: 'edit', arguments: { path: 'src/cart.js', edits: [{ oldText: 'a\nb', newText: 'a\nb\nc' }] } }, { type: 'toolCall', id: 'c3', name: 'bash', arguments: { command: 'npm test' } }], 'toolUse', 4, usage(50, 30, 1000, 0)),
  result('c2', 'edit', 'Edited src/cart.js', false, 5),
  result('c3', 'bash', 'FAIL cart.test.js\n1 failed\n\nCommand exited with code 1', true, 6),
  reply([{ type: 'toolCall', id: 'c4', name: 'write', arguments: { path: 'notes.md', content: 'one\ntwo\n' } }], 'toolUse', 7),
  result('c4', 'write', 'EACCES: permission denied', true, 8),
  reply([{ type: 'text', text: 'Fixed the total; the test passes now.' }], 'stop', 9),
  entry('session_info', { name: 'Cart fix' }, 10),
];

const record = () => ({ source: 'pi', events: [], prompts: [], edits: [], work: [], calls: [], compactions: [], callById: new Map(), seen: new Set(), keepText: true, texts: [] });
const addText = (f, t, who, text) => f.texts.push([t, who, text]);

test('a pi session: cost as pi priced it, your messages, tool calls and working time', () => {
  const f = record();
  for (const e of session()) applyPiRecord(f, e, addText);
  assert.equal(f.id, `pi-${id}`);
  assert.equal(f.project, 'shop');
  assert.equal(f.dirName, '-work-shop');
  assert.equal(f.title, 'Cart fix');
  assert.equal(f.events.length, 4);
  assert.ok(Math.abs(f.events.reduce((s, e) => s + e[1], 0) - 0.04) < 1e-12);
  assert.equal(f.events[1][2], 1080); // fresh, cached and output tokens
  assert.equal(f.events[1][5].read, 1000);
  assert.ok(f.events[1][5].saved > 0, 'cache reads cost less than fresh input');
  assert.deepEqual(f.prompts.map((p) => p[2]), ['human']);
  assert.equal(f.work.length, 1);
  assert.equal(f.work[0].end - f.work[0].start, 8000);
  assert.deepEqual(f.calls.map((c) => [c.name, c.status]), [['read', 'ok'], ['edit', 'ok'], ['bash', 'error'], ['write', 'error']]);
  assert.equal(f.calls[2].reason, 'Tests failed');
  assert.equal(f.calls[3].reason, 'EACCES: permission denied');
  assert.equal(f.calls[0].file, '/work/shop/src/cart.js');
  // Only the edit that went through changed lines.
  assert.deepEqual(f.edits.map((e) => [e[1], e[2], e[4]]), [[3, 2, '/work/shop/src/cart.js']]);
  assert.deepEqual(f.texts.map((x) => x[1]), ['you', 'agent']);
});

test('grep finding nothing is not a failure, and an aborted reply is an interruption', () => {
  const f = record();
  for (const e of [
    header(),
    user('Find TODOs', 1),
    reply([{ type: 'toolCall', id: 'g', name: 'bash', arguments: { command: 'grep -r TODO src' } }], 'toolUse', 2),
    result('g', 'bash', '\n\nCommand exited with code 1', true, 3),
    reply([], 'aborted', 4),
  ]) applyPiRecord(f, e, addText);
  assert.equal(f.calls[0].status, 'ok');
  assert.deepEqual(f.prompts.map((p) => p[2]), ['human', 'interrupt']);
  assert.equal(f.work[0].completed, true);
});

test('a forked session counts only its own work, and every branch of the tree counts', () => {
  const f = record();
  const parent = session().slice(1);
  applyPiRecord(f, header({ parentSession: '/x/parent.jsonl' }, 20));
  for (const e of parent) applyPiRecord(f, e, addText); // copied with their old times
  applyPiRecord(f, user('Now the tax', 21), addText);
  applyPiRecord(f, reply([{ type: 'text', text: 'Done' }], 'stop', 22), addText);
  // A branch back from an earlier point, in the same file.
  applyPiRecord(f, { ...user('Try it another way', 23), parentId: 'e1' }, addText);
  applyPiRecord(f, reply([{ type: 'text', text: 'Other way' }], 'stop', 24), addText);
  assert.equal(f.events.length, 2);
  assert.equal(f.prompts.length, 2);
  assert.equal(f.title, 'Cart fix'); // its name came along with the copy
});

test('summaries and compactions cost what pi says, entries count once', () => {
  const f = record();
  const compaction = entry('compaction', { summary: 'so far', firstKeptEntryId: 'e1', tokensBefore: 90_000, usage: usage(9000, 800, 0, 0, 0.05) }, 5);
  for (const e of [header(), compaction, compaction, entry('branch_summary', { fromId: 'e2', summary: 'tried A', usage: usage(100, 10, 0, 0, 0.001) }, 6)]) applyPiRecord(f, e);
  assert.equal(f.compactions.length, 1);
  assert.equal(f.compactions[0].before, 90_000);
  assert.equal(f.events.length, 2);
  assert.equal(f.events[0][1], 0.05);
});

test('edits: lines from each replacement, a write\'s content, and the old one-pair form', () => {
  assert.deepEqual(piEdit('edit', { path: 'a.js', edits: [{ oldText: 'x', newText: 'y\nz' }, { oldText: 'p\nq', newText: '' }] }, '/w'), { path: '/w/a.js', added: 2, removed: 3 });
  assert.deepEqual(piEdit('edit', { path: '/abs/a.js', oldText: 'x', newText: 'y' }, '/w'), { path: '/abs/a.js', added: 1, removed: 1 });
  assert.deepEqual(piEdit('write', { path: 'b.md', content: 'one\ntwo\n' }, '/w'), { path: '/w/b.md', added: 2, removed: 0 });
  assert.equal(piEdit('read', { path: 'c' }, '/w'), null);
  assert.equal(piUsage('anything', { input: 10, output: 5, cost: {} }).cost, null);
  assert.equal(piUsage('local-llm', { input: 10, output: 5, cost: { total: 0 } }).cost, 0);
});

test('the live view follows a pi turn from your message to its reply', () => {
  const feed = createFeed();
  const a = newAgent(`pi-${id}`, { source: 'pi' });
  const steps = session();
  for (const e of steps.slice(0, 3)) applyPiEvent(feed, a, e);
  assert.equal(a.status, 'working');
  assert.equal(a.tool.category, 'read');
  assert.equal(a.tool.detail, 'cart.js');
  for (const e of steps.slice(3, 5)) applyPiEvent(feed, a, e);
  assert.equal(a.pending.size, 2);
  for (const e of steps.slice(5)) applyPiEvent(feed, a, e);
  const v = view(a, now + 11_000);
  assert.equal(v.status, 'waiting');
  assert.equal(v.needsYou, 'turn');
  assert.equal(v.title, 'Cart fix');
  assert.equal(v.cwd, '/work/shop');
  assert.ok(Math.abs(v.cost - 0.04) < 1e-12);
  assert.equal(v.costKnown, true);
  assert.equal(v.errors, 2);
  assert.deepEqual(v.lines, { added: 3, removed: 2 });
  assert.equal(v.snippet, 'Fixed the total; the test passes now.');
  // Esc while it works: the reply is cut short.
  applyPiEvent(feed, a, user('Another thing', 12));
  applyPiEvent(feed, a, reply([], 'aborted', 13));
  assert.equal(a.endReason, 'interrupted');
});

test('the index finds pi sessions, by project folder or all in one, and keeps them apart', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-pi-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const piDir = path.join(root, 'pi');
  await mkdir(path.join(piDir, '--work-shop--'), { recursive: true });
  await writeFile(path.join(piDir, '--work-shop--', `2026-10-04T04-50-12-345Z_${id}.jsonl`), session().map((e) => JSON.stringify(e)).join('\n') + '\n');
  const other = { ...header(), id: 'my-named-session' };
  await writeFile(path.join(piDir, '2026-10-04T05-00-00-000Z_my-named-session.jsonl'), [other, user('hello', 1)].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const idx = createUsageIndex({ claudeDir: path.join(root, 'none'), codexDir: null, piDir, piHome: path.join(root, 'pi-home') });
  await idx.scan();
  assert.equal(idx.scope('pi').events().length, 4);
  assert.equal(idx.scope('claude').events().length, 0);
  assert.deepEqual(idx.sessions().map((s) => s.id).sort(), [`pi-${id}`, 'pi-my-named-session']);
  const d = sessionDetail(idx, `pi-${id}`);
  assert.equal(d.source, 'pi');
  assert.equal(d.title, 'Cart fix');
  assert.equal(d.messages.count, 1);
  assert.equal(d.tools.calls, 4);
  assert.equal(d.tools.failed, 2);
  const turn = turnDetail(idx, `pi-${id}`, now + 1000);
  assert.deepEqual(turn.commands.map((c) => c.text), ['npm test']);
  // As for Claude Code, a write that failed still shows as tried.
  assert.deepEqual(turn.files.map((f) => [f.path, f.reads, f.edits, f.added]), [['/work/shop/src/cart.js', 1, 1, 3], ['/work/shop/notes.md', 0, 1, 0]]);
});

test('pi ids, where pi keeps sessions, and resuming one', async () => {
  assert.equal(piFileId(`2026-10-04T04-50-12-345Z_${id}.jsonl`), id);
  assert.equal(piFileId('2026-10-04T04-50-12-345Z_my_named.jsonl'), 'my_named');
  assert.ok(isSessionId(`pi-${id}`) && isSessionId('pi-my-named-session') && !isSessionId('pi-a;b') && !isSessionId('pi-'));
  assert.equal(nativeIdOf(`pi-${id}`), id);
  assert.equal(piSessionsDir({}, '/Users/me'), '/Users/me/.pi/agent/sessions');
  assert.equal(piSessionsDir({ PI_CODING_AGENT_DIR: '~/pi' }, '/Users/me'), '/Users/me/pi/sessions');
  assert.equal(piSessionsDir({ PI_CODING_AGENT_SESSION_DIR: '/s', PI_CODING_AGENT_DIR: '/x' }, '/Users/me'), '/s');
  assert.deepEqual(await resumeOptions({ source: 'pi', nativeId: id }), { terminal: true, command: `pi --session ${id}`, app: null });
  assert.deepEqual(await resumeOptions({ source: 'pi', nativeId: 'x; rm -rf' }), { terminal: false, app: null });
});

test("a model's window is the one pi works with: your models.json over its catalog, else the price list's", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'overtime-pi-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = {
    openai: { checkedAt: 1, models: [{ id: 'gpt-6.1-sol', contextWindow: 272_000 }, { id: 'gpt-6-astra', contextWindow: 1_000_000 }] },
    anthropic: { models: [{ id: 'claude-opus-5-5', contextWindow: 1_000_000 }] },
  };
  await writeFile(path.join(home, 'models-store.json'), JSON.stringify(store));
  assert.equal(await refreshPiWindows(home), true);
  assert.equal(await refreshPiWindows(home), false); // unchanged files aren't read again
  assert.equal(piWindow('openai', 'gpt-6.1-sol', 50_000), 272_000);
  assert.equal(piWindow('openai', 'gpt-6-astra', 50_000), 1_000_000);
  // The same model through another provider isn't assumed to have the same window.
  assert.equal(piWindow('openrouter', 'gpt-6.1-sol', 50_000), 200_000);
  assert.equal(piWindow('anthropic', 'claude-sonnet-4-5', 50_000), 200_000); // not in the catalog: the price list's
  // Your own models and overrides win.
  await writeFile(path.join(home, 'models.json'), JSON.stringify({ providers: {
    openai: { modelOverrides: { 'gpt-6.1-sol': { contextWindow: 1_000_000 } } },
    ollama: { baseUrl: 'http://localhost:11434/v1', models: [{ id: 'qwen2.5-coder:7b', contextWindow: 32_768 }] },
  } }));
  assert.equal(await refreshPiWindows(home), true);
  assert.equal(piWindow('openai', 'gpt-6.1-sol', 50_000), 1_000_000);
  assert.equal(piWindow('ollama', 'qwen2.5-coder:7b', 9_000), 32_768);

  // A session takes its window from its provider and model.
  const f = record();
  applyPiRecord(f, header());
  applyPiRecord(f, user('hi', 1));
  applyPiRecord(f, entry('message', { message: { role: 'assistant', content: [], provider: 'ollama', model: 'qwen2.5-coder:7b', usage: usage(8000, 100, 0, 0, 0), stopReason: 'stop' } }, 2));
  assert.equal(f.contextWindow, 32_768);
  await refreshPiWindows(path.join(home, 'none')); // back to no catalog for the other tests
});
