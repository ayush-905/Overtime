// Golden tests: the formatting, the address, labels, session totals, search,
// Cost ⇄ Tokens and colour themes, on fixed inputs in every setting that changes
// what they write (the clock, the currency, the hour your day starts, what things
// are compared by). The expected results are in __snapshots__/; the tests run on
// London's clock (see vite.config.ts), so they come out the same on any machine, a
// change to summer time included. The tests share settings, so keep their order.

import { describe, expect, test } from 'vitest';
import { demoSessions } from '@shared/demo.js';
import { env } from './env';
import * as format from './format';
import * as route from './route';
import * as labels from './labels';
import * as sessions from './sessions';
import * as search from './search';
import * as measure from './measure';
import { setCurrency } from './prefs';
import { resolve, THEMES } from './appearance';

const now = new Date(2026, 8, 29, 22, 14, 30).getTime();
const times = [
  now,
  now - 5 * 60_000,
  new Date(2026, 8, 29, 0, 0).getTime(),
  new Date(2026, 8, 29, 3, 59).getTime(),
  new Date(2026, 8, 29, 12, 30).getTime(),
  new Date(2026, 0, 1, 9, 5).getTime(),
  new Date(2026, 2, 29, 2, 30).getTime(),
];
const numbers = [
  null,
  0,
  0.004,
  0.3,
  1,
  9.99,
  10,
  42.5,
  99.5,
  100,
  999.4,
  1000,
  1234.5,
  9999,
  10_000,
  123_456,
  1_000_000,
  4_900_000_000,
  -1500,
];
const durations = [
  null,
  0,
  20_000,
  59_000,
  61_000,
  3_599_000,
  3_600_000,
  5_430_000,
  47 * 3_600_000,
  49 * 3_600_000,
  10 * 86_400_000,
];

test("the tests run on London's clock, as the snapshots were taken", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London');
});

describe('format', () => {
  for (const h24 of [false, true]) {
    test(`times with the ${h24 ? '24' : '12'}-hour clock`, () => {
      env.clock24 = h24;
      const out = times.map((t) => ({
        t,
        clock: format.clock(t),
        dayLabel: format.dayLabel(t),
        weekday: format.weekday(t),
        longDate: format.longDate(t),
        calendarDay: format.calendarDay(t),
        threeDaysBefore: format.calendarDay(t, -3),
        nextMidnight: format.nextMidnight(t),
      }));
      expect({ out, hours: Array.from({ length: 24 }, (_, h) => format.hourLabel(h)) }).toMatchSnapshot();
    });
  }

  for (const hour of [4, 0, 9]) {
    test(`working days starting at ${hour}`, () => {
      env.workdayHour = hour;
      const days = times.map((t) => [0, -1, 1, -6].map((d) => format.workDay(t, d)));
      expect({ days, runs: format.dayRuns() }).toMatchSnapshot();
    });
  }

  test('durations, counts and percentages', () => {
    const days = Array.from({ length: 30 }, (_, i) => format.calendarDay(now, i - 29));
    expect({
      durations: durations.map((ms) => ({
        ms,
        duration: format.duration(ms),
        ...(ms != null
          ? { hoursText: format.hoursText(ms), hoursShort: format.hoursShort(ms), ago: format.ago(ms) }
          : {}),
      })),
      numbers: numbers.map((n) => ({
        n,
        compact: format.compact(n),
        bytes: format.bytesText(n),
        cpu: format.cpuText(n),
        ...(n != null && n >= 0 ? { pct: format.pctText(n) } : {}),
      })),
      pctOf: [
        [0, 0],
        [1, 3],
        [0.5, 100],
        [99, 100],
        [5, 7],
      ].map(([a, b]) => format.pctOf(a, b)),
      lists: [[], ['a'], ['a', 'b'], ['a', 'b', 'c', 'd']].map((list) => format.listText(list)),
      plurals: [0, 1, 2].map((n) => format.plural(n, 'session')),
      ticks30: format.dayTicks(days),
      ticks7: format.dayTicks(days.slice(-7)),
      clipped: ['short', 'exactly ten', 'a much longer piece of text'].map((text) => format.clip(text, 10)),
    }).toMatchSnapshot();
  });

  for (const [code, rate] of [
    ['USD', undefined],
    ['INR', 88],
    ['INR', 83.5],
    ['JPY', 150],
    ['EUR', undefined],
    ['AED', undefined],
  ] as const) {
    test(`money in ${code}${rate ? ` at ${rate}` : ''}`, () => {
      setCurrency(code, rate);
      expect(numbers.map((n) => `${n}: ${format.money(n)} · ${format.moneyCol(n)}`)).toMatchSnapshot();
    });
  }

  test('project colours', () => {
    expect({
      hues: ['overtime', 'thrive-backend', 'Member-Management', '', 'x'].map((name) => format.projectHue(name)),
      hashes: ['', 'abc', 'overtime'].map((s) => format.hashString(s)),
    }).toMatchSnapshot();
  });
});

describe('route', () => {
  test('links and addresses', () => {
    const cases: [string, Record<string, string | number | null>][] = [
      ['sessions', {}],
      ['sessions', { range: '7', project: 'shop', q: 'a b', sort: null }],
      ['projects', { p: 'Thrive API', range: '' }],
    ];
    expect({
      links: cases.map(([page, params]) => route.pageLink(page, params)),
      hashes: ['', '#', '#cost', '#sessions?range=7&project=shop', '#session=abc', '#sessions?q=a%20b'].map((hash) =>
        route.parseHash(hash),
      ),
      dayParams: times.map((t) => route.dayParam(t)),
      days: ['2026-09-24', '2026-13-01', 'nope', '', null].map((d) => route.parseDay(d)),
    }).toMatchSnapshot();
  });
});

describe('labels', () => {
  test('titles without the greeting', () => {
    const titles = [
      'hi',
      'hi bro, fix the login redirect',
      'Hey there can you please add a CSV export',
      'hello! the build is broken',
      'please check the tests',
      'Could you kindly look at this',
      'hiya',
      null,
      '',
      'Fix the thing',
      'yo claude what does this do',
    ];
    expect(titles.map((t) => [t, labels.tidyTitle(t), labels.titleFor('none', t)])).toMatchSnapshot();
  });
});

describe('sessions', () => {
  test('totals over any range', () => {
    const list = demoSessions(now) as sessions.Session[];
    const from = format.calendarDay(now, -6);
    // A line for each session and range, as JSON, to keep the snapshot short.
    expect(
      list.flatMap((s) => [
        `${s.id} all: ${JSON.stringify(sessions.totalsFrom(s, 0))}`,
        `${s.id} 7 days: ${JSON.stringify(sessions.totalsFrom(s, from))}`,
        `${s.id} 7 days to today: ${JSON.stringify(sessions.totalsFrom(s, from, format.calendarDay(now)))}`,
      ]),
    ).toMatchSnapshot();
  });
});

describe('search', () => {
  test('the words of a search, and where they fall', () => {
    const escape = (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const asHtml = (parts: { text: string; mark: boolean }[]) =>
      parts.map((p) => (p.mark ? `<mark>${escape(p.text)}</mark>` : escape(p.text))).join('');
    expect({
      terms: ['', 'Timezone', '"exact phrase" and more', 'a b c d e f g h i j', '  spaced   out  '].map((q) =>
        search.queryTerms(q),
      ),
      marked: [
        ['The dashboard <b> is ready', 'dash ready'],
        ['aaa', 'a'],
        ['no match here', 'zzz'],
        ['overlap overlapping', 'overlap lap'],
      ].map(([text, q]) => asHtml(search.highlightParts(text, search.queryTerms(q)))),
    }).toMatchSnapshot();
  });
});

describe('measure', () => {
  const items = [
    { cost: 12.345, tokens: 1_234_567, partial: true },
    { cost: 0.001, tokens: 0 },
    { cost: 0, tokens: 45_000 },
    { cost: 1500, tokens: 4_900_000_000 },
  ];
  for (const by of ['cost', 'tokens']) {
    for (const page of ['overview', 'cost']) {
      test(`by ${by} on ${page}`, () => {
        setCurrency('INR', 88);
        localStorage.setItem('overtime-measure', by);
        env.measure = by as 'cost' | 'tokens';
        env.page = page;
        expect({
          byTokens: measure.byTokens(),
          items: items.map((x) => ({
            of: measure.measureOf(x),
            col: measure.measureCol(x),
            text: measure.measureText(x),
            other: measure.otherText(x),
            value: measure.valueText(x.tokens),
            short: measure.valueShort(x.cost),
            something: measure.something(measure.measureOf(x)),
          })),
        }).toMatchSnapshot();
      });
    }
  }
});

describe('appearance', () => {
  test("a colour theme's variables", () => {
    expect({
      themes: Object.fromEntries(THEMES.map((t) => [t.id, resolve({ theme: t.id })])),
      custom: [
        ['#4f46e5', '#0d9488'],
        ['#1f2937', '#475569'],
      ].map(([accent, chart]) => resolve({ theme: 'custom', accent, chart })),
    }).toMatchSnapshot();
  });
});
