import { beforeEach, expect, test, vi } from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
import { CATALOG, readLayout, saveLayout, shownCards, usualLayout } from './layout';
import { OVERVIEW_WIDGETS } from './registry';

beforeEach(() => localStorage.clear());

test('every customizable widget has a renderer, and the default Overview stays focused', () => {
  expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
  expect(Object.keys(OVERVIEW_WIDGETS).sort()).toEqual(CATALOG.map((c) => c.id).sort());
  expect(shownCards(usualLayout()).map((c) => c.id)).toEqual([
    'today',
    'turn-duration',
    'timeline',
    'top-sessions',
    'where-today',
  ]);
  expect(CATALOG.filter((c) => c.section === 'Cost')).toHaveLength(7);
  expect(CATALOG.filter((c) => c.section === 'Agents')).toHaveLength(6);
  expect(CATALOG.filter((c) => c.section === 'You')).toHaveLength(9);
});

test('adding widgets preserves an existing order and hidden cards without enabling new ones', () => {
  localStorage.setItem(
    'overtime-overview-cards',
    JSON.stringify({
      order: ['timeline', 'today', 'where-today', 'top-sessions', 'open-sessions'],
      hidden: ['today'],
    }),
  );
  const layout = readLayout();
  const existing = ['timeline', 'today', 'where-today', 'top-sessions', 'open-sessions'];
  expect(layout.order.filter((id) => existing.includes(id))).toEqual(existing);
  expect(shownCards(layout).map((c) => c.id)).toEqual(['timeline', 'where-today', 'top-sessions', 'open-sessions']);
  expect(layout.hidden).toContain('tools');
  expect(layout.hidden).toContain('cache');
  expect(layout.hidden).toContain('heatmap');
  expect(layout.hidden).toContain('turn-duration');
});

test('optional widgets can be enabled and reordered, and reset restores the default', () => {
  const layout = usualLayout();
  saveLayout({
    order: ['tools', ...layout.order.filter((id) => id !== 'tools')],
    hidden: layout.hidden.filter((id) => id !== 'tools'),
  });
  expect(shownCards(readLayout())[0].id).toBe('tools');
  saveLayout(usualLayout());
  expect(localStorage.getItem('overtime-overview-cards')).toBeNull();
  expect(readLayout()).toEqual(usualLayout());
});
