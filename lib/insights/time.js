// Days and stretches of time, for the insights: calendar days (midnight to
// midnight), working days (4am to 4am, or from the hour you choose), weeks from
// Monday, and [start, end] intervals joined, clipped and measured.
// @ts-check
/** @import { Span } from '../../types/api.js' */

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

// A working day runs from this hour to the same hour the next day (4am unless you
// choose otherwise), so a late night counts toward the day it started.
let WORKDAY_HOUR = 4;

/** The hour working days start at, from your settings (0 to 12). */
export function setWorkdayHour(hour) {
  WORKDAY_HOUR = hour;
}

export function dayStart(now, daysAgo = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/** The start (4am) of the working day that `t` belongs to, or of the one `daysAgo` before it. */
export function workDay(t, daysAgo = 0) {
  const d = new Date(t);
  if (d.getHours() < WORKDAY_HOUR) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(WORKDAY_HOUR, 0, 0, 0);
  return d.getTime();
}

/** Midnight on the Monday of the week `t` falls in, moved by `weeks`. */
export function weekStart(t, weeks = 0) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
  return d.getTime();
}

/** Midnight `days` after `t`'s midnight, safe across daylight-saving changes. */
export function daysAfter(t, days) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** A sorted, merged copy of [start, end] intervals, joining any closer together than `gap`. @param {Span[]} intervals @returns {Span[]} */
export function union(intervals, gap = 0) {
  /** @type {Span[]} */
  const out = [];
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    const prev = out[out.length - 1];
    if (prev && a - prev[1] <= gap) prev[1] = Math.max(prev[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const totalMs = (intervals) => intervals.reduce((n, [a, b]) => n + b - a, 0);

/** The parts of the intervals that fall between `from` and `to`. @type {(intervals: Span[], from: number, to: number) => Span[]} */
export const clip = (intervals, from, to) =>
  intervals.map(([a, b]) => /** @type {Span} */ ([Math.max(a, from), Math.min(b, to)])).filter(([a, b]) => b > a);

/** How much of the merged intervals `a` the merged intervals `b` leave uncovered. */
export function uncovered(a, b) {
  let ms = 0;
  for (const [s, e] of a) {
    let cur = s;
    for (const [bs, be] of b) {
      if (be <= cur) continue;
      if (bs >= e) break;
      if (bs > cur) ms += bs - cur;
      cur = Math.max(cur, be);
    }
    if (cur < e) ms += e - cur;
  }
  return ms;
}
