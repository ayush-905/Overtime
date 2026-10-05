// Figures more than one card (or the demo) works out, so they always agree: the
// streak, the middle of a list, how one figure compares with another ("↑ 12%"),
// and when a working day starts.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { median, workDayStart } from '@shared/sums.js';
import { startDemo } from '@shared/demo.js';
import { env } from './env';
import { calendarDay, change, changeText, HOUR, workDay } from './format';
import { change as weekChange } from './digest';
import { streaks } from './streak';

const today = new Date(2026, 9, 4).getTime();
const ago = (n: number) => calendarDay(today, -n);
const day = (n: number, messages: number, cost = 0) => ({ day: ago(n), messages, cost });

describe('the streak', () => {
  test('days in a row with a message or more than a cent, up to today', () => {
    const history = [day(6, 3), day(5, 0, 2), day(4, 0, 0.01), day(3, 1), day(2, 4), day(1, 0, 0.5), day(0, 2)];
    // A cent on its own doesn't count, so the run starts three days ago.
    expect(streaks(history, today)).toEqual({ streak: 4, longest: 4 });
    // Nothing yesterday or today: no streak, and the longest was two days.
    expect(streaks(history.slice(0, 3), today)).toEqual({ streak: 0, longest: 2 });
  });

  test('today with nothing yet keeps yesterday’s streak going, and the live figures count for today', () => {
    const history = [day(3, 1), day(2, 1), day(1, 1)];
    expect(streaks(history, today)).toEqual({ streak: 3, longest: 3 });
    expect(streaks(history, today, { messages: 1 })).toEqual({ streak: 4, longest: 4 });
    expect(streaks([...history, day(0, 0)], today, { cost: 3 })).toEqual({ streak: 4, longest: 4 });
    // The live numbers win over the history's copy of today.
    expect(streaks([...history, day(0, 5)], today, { messages: 0, cost: 0 })).toEqual({ streak: 3, longest: 3 });
  });

  test('a day off ends it, and the longest is kept', () => {
    const history = [day(9, 1), day(8, 1), day(7, 1), day(6, 1), day(5, 0), day(1, 1), day(0, 1)];
    expect(streaks(history, today)).toEqual({ streak: 2, longest: 4 });
    expect(streaks([], today)).toEqual({ streak: 0, longest: 0 });
  });
});

describe('the middle of a list', () => {
  test('the middle, or the higher of the two middles, and null for nothing', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([])).toBeNull();
    // What doesn't count is left out before asking, as the Sessions page does with zeros.
    expect(median([0, 0, 0, 2, 4].filter((v) => v > 0))).toBe(4);
  });
});

describe('how one figure compares with another', () => {
  test('an arrow and a whole percentage, or nothing under the least that counts', () => {
    expect(changeText(112, 100)).toBe('↑ 12%');
    expect(changeText(97, 100)).toBe('');
    expect(changeText(97, 100, 1)).toBe('↓ 3%');
    expect(changeText(100.4, 100, 1)).toBe('');
  });

  test('time needs an hour before it to compare with; a week has words of its own', () => {
    expect(change(3 * HOUR, 2 * HOUR)).toBe('↑ 50%');
    expect(change(HOUR, 0.5 * HOUR)).toBe('');
    expect(weekChange(120, 100)).toBe('↑ 20% on the week before');
    expect(weekChange(102, 100)).toBe('about the same as the week before');
    expect(weekChange(250, 100)).toBe('2.5× the week before');
    expect(weekChange(5, 0)).toBe('none the week before');
  });
});

describe('when a working day starts', () => {
  afterEach(() => {
    env.workdayHour = 4;
    vi.useRealTimers();
  });

  test('the cards and the demo use the same sum, at the hour you chose', () => {
    const t = new Date(2026, 9, 4, 2, 30).getTime();
    for (const hour of [0, 4, 9]) {
      env.workdayHour = hour;
      for (const days of [0, -1, 1, -13]) expect(workDay(t, days)).toBe(workDayStart(t, hour, days));
    }
    expect(new Date(workDayStart(t, 4)).getDate()).toBe(3); // 2:30am is still the day before
    expect(new Date(workDayStart(t, 0)).getDate()).toBe(4);
  });

  test('the demo’s working days start when yours do', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 4, 15, 0) });
    let hours: { days: { start: number }[] } | undefined;
    startDemo(
      (snap: { analytics: { all: { insights: { hours: typeof hours } } } }) =>
        (hours = snap.analytics.all.insights.hours),
      { workdayHour: () => 9 },
    );
    expect(hours!.days).toHaveLength(14);
    expect(hours!.days.every((d) => new Date(d.start).getHours() === 9)).toBe(true);
    expect(hours!.days.at(-1)!.start).toBe(new Date(2026, 9, 4, 9).getTime());
  });
});
