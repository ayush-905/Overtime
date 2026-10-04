import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUsageIndex } from '../lib/usage-index.js';
import { sessionList } from '../lib/insights.js';
import { newAgent, projectName } from '../lib/agents.js';

const now = Date.now();
const at = (s) => new Date(now - 3_600_000 + s * 1000).toISOString();
const SCRATCHPAD = '/private/tmp/claude-502/-Users-me-work-shop/fdfd40bb-fdaa-46bd-b060-7177dc729675/scratchpad';

test('every agent scratchpad is one project, and the Claude app\'s folderless chats another', () => {
  assert.equal(projectName(SCRATCHPAD), 'Agent test runs');
  assert.equal(projectName(`${SCRATCHPAD}/pv`), 'Agent test runs');
  assert.equal(projectName('/Users/me/Library/Application Support/Claude/scratch-workspaces/a/b'), 'No folder');
  assert.equal(projectName('/Users/me/work/scratchpad'), 'scratchpad');
  assert.equal(projectName('/Users/me/work/shop'), 'shop');
});

test('a session that never got a reply is left out of the list, unless it is still waiting for one', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const user = (s, text, cwd) => ({ type: 'user', uuid: `u${s}`, timestamp: at(s), message: { content: text }, origin: { kind: 'human' }, cwd });
  const write = (id, lines) => writeFile(path.join(claudeDir, 'project', `${id}.jsonl`), lines.map(JSON.stringify).join('\n') + '\n');
  const ids = ['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003'];
  // A test run that couldn't sign in: your message, and a reply Claude Code made up.
  await write(ids[0], [user(0, 'ok', SCRATCHPAD), { type: 'assistant', timestamp: at(1), message: { id: 's', model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate' }] } }]);
  // One that ran, from the same scratchpad.
  await write(ids[1], [user(0, 'Reply with just the word ok.', SCRATCHPAD), { type: 'assistant', timestamp: at(2), cwd: SCRATCHPAD, message: { id: 'a', model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 2 } } }]);
  // One you just started, with no reply yet.
  await write(ids[2], [user(10, 'Fix the checkout bug', '/work/shop')]);
  const idx = createUsageIndex({ claudeDir, codexDir: null });
  await idx.scan();

  assert.deepEqual(sessionList(idx, new Map(), now).map((s) => s.id), [ids[1]]);
  assert.equal(sessionList(idx, new Map(), now)[0].project, 'Agent test runs');
  const live = newAgent(ids[2]);
  live.lastActivity = now - 5000;
  assert.deepEqual(sessionList(idx, new Map([[ids[2], live]]), now).map((s) => s.id).sort(), [ids[1], ids[2]]);
});
