// Aggregate observed human-turn durations without treating unfinished turns as fast replies.
// @ts-check
/** @import { TurnPerformance } from '../types/api.js' */
const QUIET_MS = 30 * 60_000;
/** @type {[number, string][]} */
export const TURN_BUCKETS = [
  [60_000, 'Under 1m'],
  [5 * 60_000, '1–5m'],
  [15 * 60_000, '5–15m'],
  [60 * 60_000, '15–60m'],
  [Infinity, 'Over 1h'],
];

/** @returns {TurnPerformance} */
export function turnPerformance(turns, agents, now) {
  const sessions = new Map();
  for (const turn of turns) {
    const list = sessions.get(turn.rec.session) || [];
    list.push(turn);
    sessions.set(turn.rec.session, list);
  }
  const durations = [];
  let pending = 0,
    interrupted = 0,
    inferred = 0;
  for (const list of sessions.values()) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i++) {
      const turn = list[i];
      if (turn.kind !== 'human' || turn.rec.sub || turn.t > now) continue;
      const next = list[i + 1];
      const live = agents.get(turn.rec.session);
      const current = !next && live && live.lastActivity >= turn.t;
      if (next?.kind === 'interrupt' || (current && live.endReason === 'interrupted')) {
        interrupted++;
        continue;
      }
      // Codex can record task_started just after its user message. Match that
      // span too, while keeping the following prompt's work out of this turn.
      const work = turn.rec.work?.find(
        (w) => (w.start <= turn.t && w.end >= turn.t) || (w.start >= turn.t && w.start < (next?.t ?? now)),
      );
      const ongoing =
        current &&
        (['thinking', 'working', 'replying'].includes(live.status) ||
          ['approval', 'question', 'plan'].includes(live.needsYou));
      const settled = current && (live.status === 'done' || live.needsYou === 'turn');
      const end = work?.completed ? Math.min(work.end, next?.t ?? Infinity) : turn.end;
      const ms = end - turn.t;
      if (
        ongoing ||
        (work && !work.completed) ||
        !(ms > 0) ||
        end > now ||
        (!next && !work?.completed && !settled && now - end < QUIET_MS)
      ) {
        pending++;
        continue;
      }
      durations.push(ms);
      if (!work?.completed) inferred++;
    }
  }
  durations.sort((a, b) => a - b);
  const percentile = (p) => (durations.length ? durations[Math.max(0, Math.ceil(p * durations.length) - 1)] : null);
  return {
    count: durations.length,
    pending,
    interrupted,
    inferred,
    medianMs: percentile(0.5),
    p90Ms: percentile(0.9),
    maxMs: durations.at(-1) ?? null,
    buckets: TURN_BUCKETS.map(([max, label], i) => ({
      label,
      count: durations.filter((ms) => ms < max && ms >= (i ? TURN_BUCKETS[i - 1][0] : 0)).length,
    })),
  };
}
