// The plan windows and live agents: quotaItems, stuckState, sinceFor and doingText
// on a snapshot from a real server and variations of it (exact on and off, fresh
// and stale, a limit hit, an idle window, Codex's live check, a pace that runs
// out). The expected results are in __snapshots__/, on London's clock.

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import fixture from './fixtures/limits.json';
import { env } from './env';
import { limitInfo, quotaItems, quotaFreshness, stuckState, stuckText, type LimitsInput } from './limits';
import { claudeWindow } from './usage';
import { doingText, sinceFor, waitingNow, type LiveAgent } from './agents';

const MIN = 60_000;
const HOUR = 60 * MIN;
const base = fixture.now;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterAll(() => vi.useRealTimers());

type Case = Omit<LimitsInput, 'now'> & { name: string; at: number };

type W = { pct: number; resetsAt: number; spend?: { cost: number } } | undefined;
const exactOk = (fetchedAt: number, session: W, weekly: W) => ({
  status: 'ok',
  fetchedAt,
  stale: false,
  session,
  weekly,
});

const cases: Case[] = [
  {
    name: 'the estimate, and what Codex recorded a day ago',
    at: base,
    limits: fixture.limits as never,
    exactOn: false,
    exact: null,
    codexRecorded: fixture.codexRecorded as never,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'exact, fresh',
    at: base,
    limits: fixture.limits as never,
    exactOn: true,
    exact: exactOk(
      base - 2 * MIN,
      { pct: 14, resetsAt: base + 3 * HOUR, spend: { cost: 30 } },
      { pct: 40, resetsAt: base + 3 * 86_400_000, spend: { cost: 800 } },
    ),
    codexRecorded: null,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'exact, too old to forecast from',
    at: base,
    limits: fixture.limits as never,
    exactOn: true,
    exact: exactOk(
      base - 35 * MIN,
      { pct: 55, resetsAt: base + 2 * HOUR, spend: { cost: 90 } },
      { pct: 70, resetsAt: base + 86_400_000, spend: { cost: 900 } },
    ),
    codexRecorded: null,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'exact, a limit hit and one missing',
    at: base,
    limits: fixture.limits as never,
    exactOn: true,
    exact: exactOk(base - MIN, { pct: 100, resetsAt: base + HOUR, spend: { cost: 200 } }, undefined),
    codexRecorded: null,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'exact switched on but failing',
    at: base,
    limits: fixture.limits as never,
    exactOn: true,
    exact: { status: 'error', message: 'Nope' },
    codexRecorded: null,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'a pace that runs out soon',
    at: base,
    limits: { ...fixture.limits, rates: { cost30m: 200, cost7d: 5000 } } as never,
    exactOn: true,
    exact: exactOk(
      base - MIN,
      { pct: 60, resetsAt: base + 4 * HOUR, spend: { cost: 120 } },
      { pct: 50, resetsAt: base + 5 * 86_400_000, spend: { cost: 1000 } },
    ),
    codexRecorded: null,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'no window running',
    at: base,
    limits: { ...fixture.limits, session: { ...fixture.limits.session, active: false } } as never,
    exactOn: false,
    exact: null,
    codexRecorded: null,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'Codex fresh, one window past its reset',
    at: fixture.codexRecorded.observedAt + 5 * MIN,
    limits: null,
    exactOn: false,
    exact: null,
    codexRecorded: {
      ...fixture.codexRecorded,
      windows: fixture.codexRecorded.windows.map((w, i) => ({
        ...w,
        resetsAt: i ? w.resetsAt : fixture.codexRecorded.observedAt - MIN,
        pace: { rate: 0.0004 / 60, basis: 'over the last hour' },
      })),
    } as never,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: 'Codex fast, running out',
    at: fixture.codexRecorded.observedAt + 5 * MIN,
    limits: null,
    exactOn: false,
    exact: null,
    codexRecorded: {
      ...fixture.codexRecorded,
      windows: fixture.codexRecorded.windows.map((w) => ({
        ...w,
        resetsAt: fixture.codexRecorded.observedAt + 3 * HOUR,
        pace: { rate: 50 / HOUR, basis: 'over the last hour' },
      })),
    } as never,
    codexExactOn: false,
    codexExact: null,
  },
  {
    name: "Codex's live check, newer",
    at: base,
    limits: null,
    exactOn: false,
    exact: null,
    codexRecorded: fixture.codexRecorded as never,
    codexExactOn: true,
    codexExact: {
      status: 'ok',
      source: 'exact',
      observedAt: base - MIN,
      windows: fixture.codexRecorded.windows.map((w) => ({
        ...w,
        pace: undefined,
        usedPercent: 30,
        resetsAt: w.resetsAt,
      })),
    } as never,
  },
  {
    name: "Codex's live check, signed out",
    at: base,
    limits: null,
    exactOn: false,
    exact: null,
    codexRecorded: fixture.codexRecorded as never,
    codexExactOn: true,
    codexExact: { status: 'unavailable', message: 'Signed out' } as never,
  },
];

describe('plan windows', () => {
  for (const h24 of [false, true]) {
    for (const c of cases) {
      test(`${c.name}${h24 ? ', 24-hour clock' : ''}`, () => {
        vi.setSystemTime(c.at);
        env.clock24 = h24;
        const inp: LimitsInput = { ...c, now: Date.now() };
        expect(
          Object.fromEntries(['all', 'claude', 'codex'].map((provider) => [provider, quotaItems(inp, provider)])),
        ).toMatchSnapshot();
      });
    }
  }

  test('the cases cover what matters: forecasts that run out, quiet ones, stale and expired windows', () => {
    const levels = new Set<string>();
    const flags = new Set<string>();
    for (const c of cases) {
      vi.setSystemTime(c.at);
      for (const w of quotaItems({ ...c, now: Date.now() })) {
        if (w.outlook) levels.add(w.outlook.level);
        if (w.stale) flags.add('stale');
        if (w.expired) flags.add('expired');
        if (w.limited) flags.add('limited');
        if (w.idle) flags.add('idle');
      }
    }
    expect([...levels].sort()).toEqual(['crit', 'ok', 'quiet', 'warn']);
    expect([...flags].sort()).toEqual(['expired', 'idle', 'limited', 'stale']);
  });
});

describe('a window and its chart', () => {
  test("the chart under a window heads where the window's forecast says, from the estimate and from exact figures", () => {
    const at: Record<string, number> = {};
    for (const c of cases.filter((x) =>
      ['the estimate, and what Codex recorded a day ago', 'exact, fresh'].includes(x.name),
    )) {
      vi.setSystemTime(c.at);
      const now = Date.now();
      const usage = {
        fine: { from: now - 6 * HOUR, step: 5 * MIN, costs: Array(72).fill(0.4) },
        hourly: { from: now - 8 * 24 * HOUR, step: HOUR, costs: Array(8 * 24).fill(2) },
      };
      const inp: LimitsInput = { ...c, now, limits: { ...c.limits, usage } as LimitsInput['limits'] };
      const info = limitInfo(inp, 'session');
      const drawn = claudeWindow(inp, 'session');
      if (!info || !('outlook' in info) || !info.outlook || !drawn || !('chart' in drawn)) throw new Error(c.name);
      expect(info.outlook.level).toBe('ok');
      expect(drawn.chart.atReset).toBeCloseTo(info.outlook.projected, 9);
      at[c.name] = Math.round(drawn.chart.atReset);
    }
    expect(Object.keys(at)).toHaveLength(2);
  });
});

describe('attention', () => {
  test('how fresh a reading is', () => {
    const readings = [
      { source: 'recorded', observedAt: base - 30 * MIN },
      { source: 'recorded', observedAt: base - 90 * MIN },
      { source: 'exact', observedAt: base - 25 * MIN },
      { source: 'estimate' },
      { source: 'exact', stale: true },
      { source: 'recorded' },
    ];
    expect(readings.map((w) => quotaFreshness(w, base))).toMatchSnapshot();
  });

  test('old recorded and exact readings are marked stale', () => {
    const now = 3_000_000_000;
    expect(quotaFreshness({ source: 'recorded', observedAt: now - 59 * MIN }, now).stale).toBe(false);
    expect(quotaFreshness({ source: 'recorded', observedAt: now - 60 * MIN }, now).stale).toBe(true);
    expect(quotaFreshness({ source: 'exact', observedAt: now - 20 * MIN }, now).stale).toBe(true);
    expect(quotaFreshness({ source: 'exact', observedAt: now, stale: true }, now).stale).toBe(true);
    expect(quotaFreshness({ source: 'estimate', observedAt: now - 60 * MIN }, now).stale).toBe(false);
  });

  test('an agent that looks stuck, and why', () => {
    const t = base;
    const results = (list: [number, number, string][]) => list;
    const agents = [
      {
        status: 'working',
        results: results([
          [t - 60_000, 0, 'Bash'],
          [t - 50_000, 0, 'Bash'],
          [t - 40_000, 0, 'Bash'],
          [t - 30_000, 0, 'Bash'],
        ]),
        lastActivity: t,
      },
      {
        status: 'working',
        results: results(
          Array.from(
            { length: 10 },
            (_, i) => [t - i * 30_000, i % 5 === 0 ? 1 : 0, i % 2 ? 'Edit' : 'Bash'] as [number, number, string],
          ).reverse(),
        ),
        lastActivity: t,
      },
      { status: 'working', tool: { name: 'Bash', startedAt: t - 15 * MIN }, results: [], lastActivity: t },
      { status: 'thinking', results: [], lastActivity: t - 12 * MIN },
      { status: 'working', needsYou: 'turn', results: [], lastActivity: t - HOUR },
      { status: 'idle', results: [], lastActivity: t - HOUR },
    ];
    vi.setSystemTime(t);
    expect(
      agents.map((a) =>
        [5, 10, 20].map((minutes) => {
          const s = stuckState(a as never, t, minutes);
          return { state: s, text: stuckText(s, t) };
        }),
      ),
    ).toMatchSnapshot();
  });

  test('an agent looks stuck when its calls keep failing, one runs too long, or nothing moves', () => {
    const now = 10_000_000;
    const base = {
      status: 'working',
      needsYou: null,
      lastActivity: now - MIN,
      tool: { name: 'Bash', startedAt: now - MIN },
    };
    const fails = (n: number, gap = 30_000) =>
      Array.from({ length: n }, (_, i) => [now - (n - i) * gap, 0, 'Bash'] as [number, number, string]);
    const stuck = (a: object) => stuckState(a as never, now, 10);
    const run = stuck({ ...base, results: [[now - 10 * MIN, 1, 'Read'], ...fails(4)] });
    expect(run).toMatchObject({ kind: 'failing', count: 4, name: 'Bash', inRow: true });
    // Most of the recent calls failing counts too, even with a success at the end.
    expect(stuck({ ...base, results: [...fails(6), [now - 1000, 1, 'Edit']] })).toMatchObject({
      kind: 'failing',
      inRow: false,
    });
    // Failures long ago, or three in a row, aren't stuck.
    expect(stuck({ ...base, results: fails(5, 5 * MIN).map(([t, ok, n]) => [t - 30 * MIN, ok, n]) })).toBeNull();
    expect(stuck({ ...base, results: fails(3) })).toBeNull();
    // One call running past the limit, and a turn with no sign of life.
    expect(stuck({ ...base, results: [], tool: { name: 'Bash', startedAt: now - 12 * MIN } })?.kind).toBe('tool');
    expect(stuck({ ...base, results: [], status: 'thinking', tool: null, lastActivity: now - 11 * MIN })?.kind).toBe(
      'silent',
    );
    // Waiting for you, or finished, is never stuck.
    expect(stuck({ ...base, needsYou: 'turn', results: fails(5) })).toBeNull();
    expect(stuck({ ...base, status: 'idle', results: fails(5) })).toBeNull();
  });
});

describe('live agents', () => {
  const t = base;
  const agent = (x: Partial<LiveAgent>): LiveAgent => ({
    id: 'a',
    kind: 'main',
    source: 'claude',
    title: 'A',
    project: 'p',
    status: 'idle',
    needsYou: null,
    tool: null,
    turnStartedAt: null,
    endedAt: null,
    lastActivity: t - MIN,
    ...x,
  });
  const list = [
    agent({ needsYou: 'turn', endedAt: t - 5 * MIN }),
    agent({ needsYou: 'turn', endReason: 'interrupted', endedAt: t - 2 * MIN }),
    agent({ needsYou: 'question', tool: { name: 'AskUserQuestion', startedAt: t - 3 * MIN }, endedAt: t - HOUR }),
    agent({ needsYou: 'plan', endedAt: t - 9 * MIN }),
    agent({ needsYou: 'approval', tool: { name: 'Bash', startedAt: t - MIN } }),
    agent({
      status: 'working',
      tool: { name: 'Bash', category: 'bash', verb: 'Running', detail: 'the tests', startedAt: t - 20_000 },
    }),
    agent({ status: 'working', tool: { name: 'search issues', category: 'other', startedAt: t - 20_000 } }),
    agent({ status: 'thinking', turnStartedAt: t - 40_000 }),
    agent({ status: 'replying', turnStartedAt: t - 40_000 }),
    agent({ status: 'done', endedAt: t - 10 * MIN }),
    agent({ status: 'idle' }),
  ];
  test('what each is doing, and since when', () => {
    expect(list.map((a) => ({ doing: doingText(a), since: sinceFor(a) }))).toMatchSnapshot();
  });
  test('the ones waiting for you, longest first', () => {
    vi.setSystemTime(t);
    expect(
      waitingNow(
        list.map((a, i) => ({ ...a, id: String(i) })),
        Date.now(),
      ),
    ).toMatchSnapshot();
  });
});
