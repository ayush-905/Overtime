// The Sessions page's view: what an address opens, what's written back into it,
// the day groups and the page's budget, sorting, and names for saved views.

import { beforeEach, describe, expect, test } from 'vitest';
import { addressOf, groupKeys, groupRows, isPlain, paramsOf, PINNED, sortRows, spanOf, suggestName, viewFromParams, viewLink } from './sessionsView';
import { loadLabels, togglePin } from './labels';
import { calendarDay } from './format';
import type { SessionInRange } from './sessions';

const DAY = 86_400_000;
const today = calendarDay(Date.now());
const row = (id: string, lastDay: number, extra: Partial<SessionInRange> = {}): SessionInRange =>
  ({ id, source: 'claude', title: id, project: 'p', model: null, startedAt: lastDay, lastAt: lastDay + 1000, days: [], lastDay, cost: 1, subCost: 0, tokens: 10, messages: 1, agentMs: 1, waitMs: 0, waits: 0, added: 0, removed: 0, tools: 0, failed: 0, partial: false, ...extra }) as SessionInRange;

beforeEach(() => {
  localStorage.clear();
  loadLabels();
});

describe('the address', () => {
  test('opens with the remembered range and sort where it says nothing', () => {
    expect(viewFromParams({}, { range: '7', sort: 'cost', dir: 'asc' })).toEqual({ day: null, range: '7', sort: 'cost', dir: 'asc', project: '', tag: '', query: '' });
  });
  test('says a sort without a direction means newest or most first', () => {
    expect(viewFromParams({ sort: 'lines' }, { range: '30', sort: 'latest', dir: 'asc' }).dir).toBe('desc');
  });
  test('ignores what it doesn’t know', () => {
    const v = viewFromParams({ range: '90', sort: 'nope', day: 'yesterday' }, { range: '30', sort: 'latest', dir: 'desc' });
    expect([v.range, v.sort, v.day]).toEqual(['30', 'latest', null]);
  });
  test('writes back only what differs from the defaults, and a day instead of a range', () => {
    const v = viewFromParams({ day: '2026-09-24', project: 'shop', q: ' bug ' }, { range: '7', sort: 'latest', dir: 'desc' });
    expect(addressOf(v, () => '2026-09-24')).toEqual({ day: '2026-09-24', range: null, project: 'shop', tag: '', q: 'bug', sort: null, dir: null });
  });
  test('a day spans that day; a range ends today', () => {
    const d = today - 3 * DAY;
    expect(spanOf({ day: d, range: '30' }, Date.now())).toEqual([d, calendarDay(d, 1)]);
    expect(spanOf({ day: null, range: 'today' }, Date.now())).toEqual([today, Infinity]);
    expect(spanOf({ day: null, range: '7' }, Date.now())[0]).toBe(calendarDay(today, -6));
  });
});

describe('the list', () => {
  test('sorts by the column, newest first among equals', () => {
    const rows = [row('a', today, { messages: 2 }), row('b', today - DAY, { messages: 5 }), row('c', today, { messages: 2, lastAt: today + 5000 })];
    expect(sortRows(rows, { sort: 'messages', dir: 'desc' }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, { sort: 'messages', dir: 'asc' }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
  test('groups by day with pinned first, and a folded day costs nothing from the page', () => {
    const rows = [row('a', today), row('b', today), row('c', today - DAY), row('d', today - 2 * DAY)];
    togglePin('d');
    const { groups, left } = groupRows(rows, new Set([today]), 1);
    expect(groups.map((g) => [g.key, g.open, g.shown.map((s) => s.id)])).toEqual([
      [PINNED, true, ['d']],
      [today, false, []],
    ]);
    expect(left).toBe(1);
    expect(groupKeys(rows)).toEqual([today, today - DAY, PINNED]);
  });
  test('a single group never folds away', () => {
    const rows = [row('a', today), row('b', today)];
    const { groups } = groupRows(rows, new Set([today]), 50);
    expect(groups[0].open).toBe(true);
  });
});

describe('saved views', () => {
  test('are named from what they show', () => {
    expect(suggestName({ q: 'timezone', project: 'shop', tag: 'bug', range: '7', sort: 'cost' })).toBe('“timezone” · shop · bug · 7 days · priciest');
    expect(suggestName({ range: '30', sort: 'latest' })).toBe('My view');
  });
  test('the plain view isn’t worth saving', () => {
    expect(isPlain(paramsOf(viewFromParams({}, { range: '30', sort: 'latest', dir: 'desc' })))).toBe(true);
    expect(isPlain(paramsOf(viewFromParams({ tag: 'x' }, { range: '30', sort: 'latest', dir: 'desc' })))).toBe(false);
  });
  test('open the address the rest of the dashboard links to', () => {
    const v = { params: { range: '7' as const, project: 'shop', tag: '', q: 'x', sort: 'cost' as const, dir: 'asc' as const } };
    expect(viewLink(v)).toBe('#sessions?range=7&project=shop&q=x&sort=cost&dir=asc');
  });
});
