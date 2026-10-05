// Small sums the dashboard and the demo both do, so they come out the same:
// when a working day starts, and the middle of a list.

/**
 * The start of the working day `t` belongs to, moved by `days`. A working day
 * starts at `hour` (4am unless you changed it), so 1am still counts as the day before.
 * @param {number} t
 * @param {number} hour
 * @param {number} [days]
 * @returns {number}
 */
export function workDayStart(t, hour, days = 0) {
  const d = new Date(t);
  if (d.getHours() < hour) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * The middle of a list of numbers (the higher of the two middle ones when there's
 * an even number of them), or null when it's empty. Leave out what shouldn't
 * count, like zeros, before asking.
 * @param {number[]} values
 * @returns {number | null}
 */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}
