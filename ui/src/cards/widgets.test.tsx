import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LiveAgent } from '@/lib/agents';

const state = vi.hoisted(() => ({ agents: [] as LiveAgent[], insights: {} as Record<string, unknown>, target: undefined as { app?: { name: string; url: string } | null } | undefined, openSession: vi.fn() }));
vi.mock('@/data/scope', () => ({
  useScopedAgents: () => state.agents,
  useLoaded: () => true,
  useInsight: (key: string) => state.insights[key],
  useAlertPrefs: () => ({ stuckMinutes: 10 }),
}));
vi.mock('@/data/hooks', () => ({ useNow: () => Date.now(), useMinute: () => Date.now(), useEachSecond: (work: (now: number) => unknown) => work(Date.now()), useChanged: () => 0 }));
vi.mock('@/data/live', () => ({ useLive: (selector: (s: unknown) => unknown) => selector({ snap: {}, provider: 'all' }) }));
vi.mock('@/app/ui', () => ({ useUi: (selector: (s: unknown) => unknown) => selector({ openSession: state.openSession }) }));
vi.mock('@/data/queries', () => ({ useSessionTarget: () => ({ data: state.target }) }));
import { AttentionInbox } from './Band';
import { TurnDurationCard } from './TurnDuration';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  state.agents = [];
  state.insights = {};
  state.target = undefined;
  state.openSession.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

test('desktop and compact attention actions open the same session without executing an approval', () => {
  const now = Date.now();
  state.agents = [{ id: 'approval-session', title: 'Fix login', project: 'shop', source: 'claude', kind: 'main', status: 'working', needsYou: 'approval', tool: null, lastActivity: now, turnStartedAt: now, endedAt: null }];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const compact of [false, true]) {
    act(() => root?.render(<AttentionInbox compact={compact} />));
    const action = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open approval' || button.getAttribute('aria-label') === 'Open approval: Fix login');
    expect(action).toBeDefined();
    act(() => action?.click());
    expect(state.openSession).toHaveBeenLastCalledWith('approval-session');
  }
  expect(state.openSession).toHaveBeenCalledTimes(2);
});

test('attention app actions link directly to the original session and keep dashboard details available', () => {
  const now = Date.now();
  state.agents = [{ id: 'app-session', title: 'Fix login', project: 'shop', source: 'claude', kind: 'main', status: 'working', needsYou: 'approval', tool: null, lastActivity: now, turnStartedAt: now, endedAt: null }];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const app of [{ name: 'Claude', url: 'claude://code/continue?session=local_123' }, { name: 'Codex', url: 'codex://threads/12345678-1234-1234-1234-123456789012' }]) {
    state.target = { app };
    for (const compact of [false, true]) {
      act(() => root?.render(<AttentionInbox compact={compact} />));
      const link = container.querySelector(`a[href="${app.url}"]`);
      expect(link).not.toBeNull();
      expect(link?.textContent).toContain(compact ? 'Fix login' : `Open in ${app.name}`);
      // Reading the inbox creates a native link; it never launches an app or accepts approval.
      expect(state.openSession).not.toHaveBeenCalled();
      if (!compact) {
        const title = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Fix login');
        act(() => title?.click());
        expect(state.openSession).toHaveBeenLastCalledWith('app-session');
        state.openSession.mockClear();
      }
    }
  }
  // An unavailable app remains a working panel action.
  state.target = { app: null };
  act(() => root?.render(<AttentionInbox />));
  const fallback = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Open approval');
  act(() => fallback?.click());
  expect(state.openSession).toHaveBeenLastCalledWith('app-session');
});

test('working sessions show under the inbox as rows on desktop and as one line in the compact layout', () => {
  const now = Date.now();
  const base = { project: 'shop', source: 'claude' as const, kind: 'main' as const, needsYou: null, lastActivity: now, endedAt: null };
  state.agents = [
    { ...base, id: 'approval-session', title: 'Fix login', status: 'working', needsYou: 'approval', tool: null, turnStartedAt: now },
    { ...base, id: 'refactor', title: 'Refactor inbox', status: 'working', tool: { name: 'Edit', verb: 'Editing', detail: 'inbox.ts', startedAt: now - 120_000 }, turnStartedAt: now - 300_000 },
    { ...base, id: 'standup', title: 'Standup draft', status: 'thinking', tool: null, turnStartedAt: now - 40_000 },
  ];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<AttentionInbox />));
  const group = container.querySelector('[aria-label="Working sessions"]');
  expect(group?.textContent).toContain('Working · 2');
  const rows = [...(group?.querySelectorAll<HTMLButtonElement>('button[data-session]') ?? [])];
  expect(rows.map((row) => row.dataset.session)).toEqual(['refactor', 'standup']); // the session that needs you isn't repeated
  expect(rows[0].textContent).toContain('Editing inbox.ts · shop');
  act(() => rows[0].click());
  expect(state.openSession).toHaveBeenLastCalledWith('refactor');

  act(() => root?.render(<AttentionInbox compact />));
  expect(container.querySelector('[aria-label="Working sessions"]')).toBeNull();
  const summary = container.querySelector('a.working-summary');
  expect(summary?.textContent).toContain('2 working');
  expect(summary?.textContent).toContain('Refactor inbox, Standup draft');
});

test('a week with no settled turns says so instead of failing', () => {
  state.insights = { turnPerformance: { count: 0, pending: 2 } };
  const empty = renderToStaticMarkup(<TurnDurationCard expanded />);
  expect(empty).toContain('No settled turns to measure yet.');
  expect(empty).toContain('2 turns');
  expect(empty).not.toContain('NaN');
});

test('duration metrics show their sample coverage and labelled buckets', () => {
  state.insights = { turnPerformance: { count: 2, pending: 1, interrupted: 1, inferred: 1, medianMs: 60_000, p90Ms: 300_000, maxMs: 300_000, buckets: [{ label: '1–5m', count: 1 }, { label: '5–15m', count: 1 }] } };
  const html = renderToStaticMarkup(<TurnDurationCard expanded />);
  expect(html).toContain('Median');
  expect(html).toContain('P90');
  expect(html).toContain('1 inferred from replies');
  expect(html).toContain('1 pending');
  expect(html).toContain('1 interrupted');
  expect(html).toContain('5–15m');
  expect(html).not.toContain('NaN');
});
