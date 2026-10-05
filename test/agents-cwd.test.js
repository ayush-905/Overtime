// A live session keeps the project and folder it was started in, wherever its
// agent cds to since: the panel, Right now and the office name the same project
// as the history, and its resume command runs where Claude Code can find it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeed, newAgent, noteCwd, view } from '../lib/agents.js';
import { applyClaudeEvent } from '../lib/claude.js';
import { applyCodexEvent } from '../lib/codex.js';

const file = '/Users/me/.claude/projects/-Users-me-code-shop/0f1e2d3c-aaaa-bbbb-cccc-111122223333.jsonl';
const at = (s) => new Date(Date.UTC(2026, 8, 30, 10, 0, s)).toISOString();

test('a Claude Code session stays in its project after its agent cds into a subfolder', () => {
  const feed = createFeed();
  const a = newAgent('0f1e2d3c-aaaa-bbbb-cccc-111122223333', { file });
  applyClaudeEvent(feed, a, {
    type: 'custom-title',
    customTitle: 'Shop',
    cwd: '/Users/me/code/shop',
    timestamp: at(1),
  });
  applyClaudeEvent(feed, a, {
    type: 'custom-title',
    customTitle: 'Shop',
    cwd: '/Users/me/code/shop/ui/src',
    timestamp: at(2),
  });
  const v = view(a, Date.parse(at(3)));
  assert.equal(v.project, 'shop');
  assert.equal(v.cwd, '/Users/me/code/shop');
  assert.equal(a.cwd, '/Users/me/code/shop/ui/src', 'where it is now is still known');
});

test('the folder its transcript is filed under wins over a first cwd elsewhere', () => {
  const feed = createFeed();
  const a = newAgent('0f1e2d3c-aaaa-bbbb-cccc-111122223333', { file });
  applyClaudeEvent(feed, a, {
    type: 'custom-title',
    customTitle: 'Shop',
    cwd: '/Users/me/code/shop/api',
    timestamp: at(1),
  });
  applyClaudeEvent(feed, a, {
    type: 'custom-title',
    customTitle: 'Shop',
    cwd: '/Users/me/code/shop',
    timestamp: at(2),
  });
  applyClaudeEvent(feed, a, {
    type: 'custom-title',
    customTitle: 'Shop',
    cwd: '/Users/me/code/shop/web',
    timestamp: at(3),
  });
  assert.equal(view(a, Date.parse(at(4))).project, 'shop');
});

test('a Codex session keeps the folder it started in', () => {
  const feed = createFeed();
  const a = newAgent('codex-x', { source: 'codex', file: '/Users/me/.codex/sessions/2026/09/30/rollout-x.jsonl' });
  applyCodexEvent(feed, a, { type: 'session_meta', timestamp: at(1), payload: { id: 'x', cwd: '/Users/me/code/app' } });
  applyCodexEvent(feed, a, {
    type: 'turn_context',
    timestamp: at(2),
    payload: { cwd: '/Users/me/code/app/pkg', model: 'gpt-6' },
  });
  const v = view(a, Date.parse(at(3)));
  assert.equal(v.project, 'app');
  assert.equal(v.cwd, '/Users/me/code/app');
});

test('noteCwd ignores an empty cwd', () => {
  const a = newAgent('y', { file });
  noteCwd(a, null);
  noteCwd(a, '');
  assert.equal(a.cwd, null);
  assert.equal(view(a, Date.now()).project, null);
});
