// The sidebar's order and hidden sections, ⌘K's ranking, and sessions in a range.

import { beforeEach, describe, expect, test } from 'vitest';
import { ORDERABLE, moveSection, placeSection, readNavState, toggleHidden, writeNavState } from './nav';
import { score } from './search';
import { sessionsIn, type Session } from './sessions';

beforeEach(() => localStorage.clear());

describe('the sidebar', () => {
  test('a saved order keeps its groups, and new sections come in where they usually are', () => {
    const s = readNavState({ order: ['you', 'agents', 'projects', 'sessions', 'overview'], hidden: ['cost', 'nope'] });
    // Overview stays on its own at the top; within Work and Activity, your order.
    expect(s.order).toEqual(['overview', 'projects', 'sessions', 'usage', 'cost', 'you', 'agents']);
    expect([...s.hidden]).toEqual(['cost']);
  });

  test('a section moves only within its group, among the shown ones', () => {
    const s = readNavState();
    expect(moveSection(s, 'projects', -1)?.order.slice(1, 3)).toEqual(['projects', 'sessions']);
    expect(moveSection(s, 'sessions', -1)).toBeNull(); // past Overview, into no group
    expect(moveSection(s, 'cost', 1)).toBeNull(); // into Activity
    expect(placeSection(s, 'you', 'agents')?.order.slice(-2)).toEqual(['you', 'agents']);
    expect(placeSection(s, 'you', 'sessions')).toBeNull();
  });

  test('hiding keeps at least one section, and the usual order saves as nothing', () => {
    let s = readNavState();
    for (const id of ORDERABLE.slice(1)) s = toggleHidden(s, id)!;
    expect(toggleHidden(s, 'overview')).toBeNull();
    writeNavState(readNavState());
    expect(localStorage.getItem('overtime-nav')).toBeNull();
    writeNavState(moveSection(readNavState(), 'projects', -1)!);
    expect(JSON.parse(localStorage.getItem('overtime-nav')!).order[1]).toBe('projects');
    expect(readNavState().order).not.toEqual(ORDERABLE);
  });
});

describe('⌘K', () => {
  test('a start beats a word’s start beats anywhere, and letters in order count once there are three', () => {
    expect(score('Sessions', 'ses')).toBe(4);
    expect(score('Recipe search ranking', 'sea')).toBe(3);
    expect(score('Checkout-flow', 'flow')).toBe(3);
    expect(score('Dashboards', 'board')).toBe(2);
    expect(score('recipe search', 'rsh')).toBe(1);
    expect(score('recipe search', 'rs')).toBe(0);
    expect(score('anything', '')).toBe(1);
  });
});

describe('sessions in a range', () => {
  const day = (d: number) => new Date(2026, 8, d).getTime();
  const list: Session[] = [
    {
      id: 'a',
      source: 'claude',
      title: 'A',
      project: 'p',
      model: null,
      startedAt: day(20),
      lastAt: day(28),
      days: [
        { day: day(20), cost: 1, tokens: 10 },
        { day: day(28), cost: 2, tokens: 20, partial: true },
      ],
    },
    {
      id: 'b',
      source: 'codex',
      title: 'B',
      project: 'p',
      model: null,
      startedAt: day(27),
      lastAt: day(27),
      days: [{ day: day(27), cost: 4, tokens: 40 }],
    },
  ];
  test('only the days in range count, for the provider in view', () => {
    const all = sessionsIn(list, 'all', day(25));
    expect(all.map((s) => [s.id, s.cost, s.tokens, s.partial, s.lastDay])).toEqual([
      ['a', 2, 20, true, day(28)],
      ['b', 4, 40, false, day(27)],
    ]);
    expect(sessionsIn(list, 'codex', day(1)).map((s) => s.id)).toEqual(['b']);
    expect(sessionsIn(list, 'all', day(21), day(27))).toEqual([]);
  });
});

describe('project names and colours', () => {
  test('undoing a colour picked on Auto takes it off again', async () => {
    const { setProjectPref, projectPref } = await import('./prefs');
    const { projectHue, hashString } = await import('./format');
    localStorage.clear();
    const before = projectPref('shop');
    setProjectPref('shop', { alias: '', hue: 140 });
    expect(projectHue('shop')).toBe(140);
    // What the dialog's Undo does: put back what it was, a hue it didn't have included.
    setProjectPref('shop', { alias: before.alias || '', hue: before.hue });
    expect(projectPref('shop')).toEqual({});
    expect(projectHue('shop')).toBe(hashString('shop') % 360);
  });
  test('what a change leaves out stays as it is', async () => {
    const { setProjectPref, projectPref } = await import('./prefs');
    setProjectPref('shop', { alias: 'Shop', hue: 200 });
    setProjectPref('shop', { alias: 'The shop' });
    expect(projectPref('shop')).toEqual({ alias: 'The shop', hue: 200 });
    setProjectPref('shop', { hue: null });
    expect(projectPref('shop')).toEqual({ alias: 'The shop' });
    setProjectPref('shop', { alias: '' });
    expect(projectPref('shop')).toEqual({});
  });
});
