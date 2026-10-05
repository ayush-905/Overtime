import test from 'node:test';
import assert from 'node:assert/strict';
import { turnPerformance } from '../lib/turn-performance.js';

const MIN = 60_000;
const now = 1000 * MIN;
const turn = (session, ms, options = {}) => ({
  t: now - 100 * MIN,
  end: now - 100 * MIN + ms,
  kind: 'human',
  rec: { session, source: 'claude', sub: false, work: [] },
  ...options,
});

test('duration percentiles and exclusive buckets use only recorded human turns', () => {
  const turns = [30_000, MIN, 5 * MIN, 15 * MIN, 60 * MIN].map((ms, i) => turn(String(i), ms));
  turns.push(turn('sub', 1000, { rec: { session: 'sub', sub: true } }), turn('background', 1000, { kind: 'other' }));
  const result = turnPerformance(turns, new Map(), now);
  assert.equal(result.count, 5);
  assert.equal(result.medianMs, 5 * MIN);
  assert.equal(result.p90Ms, 60 * MIN);
  assert.deepEqual(
    result.buckets.map((b) => b.count),
    [1, 1, 1, 1, 1],
  );
});

test('ongoing, approval, question, and plan waits never look like completed fast turns', () => {
  for (const needsYou of [null, 'approval', 'question', 'plan']) {
    const result = turnPerformance(
      [turn('live', 4 * MIN)],
      new Map([['live', { status: needsYou ? 'idle' : 'working', needsYou, lastActivity: now }]]),
      now,
    );
    assert.equal(result.count, 0);
    assert.equal(result.pending, 1);
  }
});

test('recent unconfirmed replies and no replies are excluded; explicit completion is included', () => {
  const recent = turn('codex', MIN, { t: now - 2 * MIN, end: now - MIN });
  assert.equal(turnPerformance([recent, turn('zero', 0)], new Map(), now).pending, 2);
  recent.rec.work = [{ start: recent.t, end: recent.end, completed: true }];
  const result = turnPerformance([recent], new Map(), now);
  assert.equal(result.count, 1);
  assert.equal(result.inferred, 0);
});

test('interruptions, future records and unfinished recorded work are excluded', () => {
  const interrupted = turn('a', MIN);
  const interrupt = { ...interrupted, t: interrupted.end, kind: 'interrupt' };
  const unfinished = turn('b', MIN);
  unfinished.rec.work = [{ start: unfinished.t, end: unfinished.end, completed: false }];
  const result = turnPerformance(
    [interrupt, interrupted, unfinished, turn('future', MIN, { t: now + MIN, end: now + 2 * MIN })],
    new Map(),
    now,
  );
  assert.equal(result.count, 0);
  assert.equal(result.interrupted, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.medianMs, null);
  assert.equal(result.p90Ms, null);
});

test('Codex completion includes quiet stretches and task_started after the user message', () => {
  const recorded = turn('codex', 0, { t: now - 10 * MIN, end: now - 10 * MIN });
  recorded.rec.work = [{ start: recorded.t + 1000, end: now - 4 * MIN, completed: true }];
  const result = turnPerformance([recorded], new Map(), now);
  assert.equal(result.count, 1);
  assert.equal(result.medianMs, 6 * MIN);
  assert.equal(result.inferred, 0);
});
