import { expect, test } from 'vitest';
import { attentionItems, workingItems } from './attention';
import type { LiveAgent } from './agents';

const now = 1_000_000;
const agent = (id: string, patch: Partial<LiveAgent> = {}): LiveAgent => ({ id, title: id, source: 'claude', project: 'shop', kind: 'main', status: 'thinking', needsYou: null, tool: null, turnStartedAt: now - 10_000, endedAt: null, lastActivity: now, ...patch });

test('approval and question actions come before suspected failures and finished turns', () => {
  const items = attentionItems([
    agent('finished', { status: 'done', needsYou: 'turn', endedAt: now - 40_000 }),
    agent('working'),
    agent('approval', { needsYou: 'approval' }),
    agent('question', { needsYou: 'question', endedAt: now - 20_000, tool: { name: 'AskUserQuestion', startedAt: now - 20_000 } }),
    agent('failures', { results: [0, 1, 2, 3].map((i) => [now - 4000 + i * 1000, 0, 'Bash']) }),
  ], now, 10);
  expect(items.map((item) => item.agent.id)).toEqual(['question', 'approval', 'failures', 'finished']);
  expect(items[0].action).toBe('Open question');
  expect(items[1].action).toBe('Open approval');
  expect(items[2].detail).toContain('4 Bash calls failed in a row');
  expect(items[3].label).toBe('Turn finished');
});

test('a stuck subagent appears once under its parent; missing wait timestamps still appear', () => {
  const parent = agent('parent');
  const sub = agent('sub', { kind: 'sub', parentId: 'parent', lastActivity: now - 700_000 });
  const items = attentionItems([parent, sub, agent('plan', { needsYou: 'plan', turnStartedAt: null })], now, 10);
  expect(items.map((item) => item.agent.id)).toEqual(['plan', 'parent']);
  expect(items[1].detail).toContain('Subagent: No progress');
  expect(items[0].action).toBe('Review plan');
  expect(items[0].since).toBe(now);
});

test('interrupted turns are labelled accurately and healthy sessions never create attention', () => {
  expect(attentionItems([agent('healthy')], now, 10)).toEqual([]);
  const [item] = attentionItems([agent('stopped', { status: 'done', needsYou: 'turn', endReason: 'interrupted' })], now, 10);
  expect(item.label).toBe('Turn interrupted');
  expect(item.action).toBe('Open session');
});

test('working sessions leave out ones the inbox lists, count working subagents, and keep turn order', () => {
  const agents = [
    agent('newer', { status: 'working', turnStartedAt: now - 5_000, tool: { name: 'Edit', verb: 'Editing', detail: 'inbox.ts', startedAt: now - 2_000 } }),
    agent('older', { turnStartedAt: now - 60_000 }),
    agent('waiting', { needsYou: 'approval' }),
    agent('stuck', { results: [0, 1, 2, 3].map((i) => [now - 4000 + i * 1000, 0, 'Bash']) }),
    agent('finished', { status: 'done' }),
    agent('helper', { kind: 'sub', parentId: 'newer', status: 'working' }),
    agent('helper-done', { kind: 'sub', parentId: 'newer', status: 'done' }),
  ];
  const items = workingItems(agents, attentionItems(agents, now, 10));
  expect(items.map((item) => item.agent.id)).toEqual(['older', 'newer']);
  expect(items[0]).toMatchObject({ doing: 'Thinking', since: now - 60_000, subagents: 0 });
  expect(items[1]).toMatchObject({ doing: 'Editing inbox.ts', since: now - 2_000, subagents: 1 });
});
