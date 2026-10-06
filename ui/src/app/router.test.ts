// The open session in the address: a floating panel is a step Back closes, a
// docked one goes along as you move between sections, an older #session=<id>
// link opens over the section you're on, and a page's filters keep it.

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

// Wide enough to dock, or not: ui.ts asks once, as it loads.
const screen = vi.hoisted(() => {
  const wide = { matches: false };
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('min-width') ? wide.matches : !wide.matches;
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  return wide;
});

import { useUi } from './ui';
import { startRouter, useRoute } from './router';
import { replaceParams } from '@/lib/route';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const go = async (hash: string) => {
  location.hash = hash;
  await settle();
};
const back = async () => {
  history.back();
  await settle();
};

beforeAll(async () => {
  await go('#sessions');
  startRouter();
});

afterEach(async () => {
  useUi.getState().closeSession();
  useUi.getState().setDocked(false);
  screen.matches = false;
  await settle();
});

describe('the open session in the address', () => {
  test('opening it floating is a step: Back closes it, and closing it steps back', async () => {
    await go('#sessions?range=7');
    const steps = history.length;
    useUi.getState().openSession('abc');
    expect(location.hash).toBe('#sessions?range=7&session=abc');
    expect(history.length).toBe(steps + 1);
    await back();
    expect(useUi.getState().session).toBeNull();
    expect(location.hash).toBe('#sessions?range=7');

    history.forward();
    await settle();
    expect(useUi.getState().session?.id).toBe('abc');
    useUi.getState().closeSession();
    await settle();
    expect(location.hash).toBe('#sessions?range=7');
  });

  test('another session over the same page takes its place, without another step', async () => {
    await go('#cost');
    useUi.getState().openSession('one');
    const steps = history.length;
    useUi.getState().openSession('two');
    expect(location.hash).toBe('#cost?session=two');
    expect(history.length).toBe(steps);
  });

  test('a refresh, or a link, opens the session in the address', async () => {
    await go('#usage?session=from-a-link');
    expect(useRoute.getState().page).toBe('usage');
    expect(useUi.getState().session?.id).toBe('from-a-link');
  });

  test('#session=<id> on its own opens over the section you were on, with its filters', async () => {
    await go('#sessions?range=30');
    await go('#session=older-link');
    expect(location.hash).toBe('#sessions?range=30&session=older-link');
    expect(useUi.getState().session?.id).toBe('older-link');
  });

  test('docked, it stays open from section to section, and Back moves only the page', async () => {
    screen.matches = true;
    useUi.getState().setDocked(true);
    await go('#overview');
    const steps = history.length;
    useUi.getState().openSession('docked');
    expect(history.length).toBe(steps);
    expect(location.hash).toBe('#overview?session=docked');
    await go('#cost');
    expect(location.hash).toBe('#cost?session=docked');
    await back();
    expect(useRoute.getState().page).toBe('overview');
    expect(useUi.getState().session?.id).toBe('docked');
    expect(location.hash).toBe('#overview?session=docked');
  });

  test("a page's filters change around it", async () => {
    await go('#sessions');
    useUi.getState().openSession('kept');
    replaceParams('sessions', { range: '7', q: 'login' });
    expect(location.hash).toBe('#sessions?range=7&q=login&session=kept');
  });

  test('a link that closes the panel on its way somewhere is left to go there', async () => {
    await go('#sessions');
    useUi.getState().openSession('tagged');
    useUi.getState().closeSession();
    location.hash = '#sessions?tag=bug';
    await settle();
    await settle();
    expect(location.hash).toBe('#sessions?tag=bug');
    expect(useUi.getState().session).toBeNull();
  });
});
