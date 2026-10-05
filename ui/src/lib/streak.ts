// Your streak: calendar days in a row with a message or some cost (over a cent),
// up to today, or up to yesterday while today has nothing yet; and the longest
// run on record. From every day on record (/api/history), with today's figures
// from the live numbers, which move faster than the history does. The activity
// heatmap and Your working hours both show it, so they always agree.

import { calendarDay } from './format';

export type StreakDay = { day: number; messages: number; cost: number };

/** Whether a day counts toward a streak. */
export const workedOn = (d: StreakDay | undefined) => !!d && (d.messages > 0 || d.cost > 0.01);

export function streaks(history: StreakDay[], today: number, live: { messages?: number; cost?: number } = {}) {
  const byDay = new Map(history.map((d) => [calendarDay(d.day), d]));
  const now: StreakDay = { day: today, messages: 0, cost: 0, ...byDay.get(today) };
  if (live.messages != null) now.messages = live.messages;
  if (live.cost != null) now.cost = live.cost;
  byDay.set(today, now);
  const worked = (t: number) => workedOn(byDay.get(t));
  let streak = 0;
  for (let t = worked(today) ? today : calendarDay(today, -1); worked(t); t = calendarDay(t, -1)) streak++;
  let longest = 0;
  for (let t = Math.min(...byDay.keys()), run = 0; t <= today; t = calendarDay(t, 1)) {
    run = worked(t) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { streak, longest };
}
