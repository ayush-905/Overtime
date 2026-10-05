import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFeed, emptyPage, patchFor } from '../lib/live-feed.js';
import { createMerger } from '../web/shared/live.js';

/** A snapshot as the server makes one, small. */
const snapshot = (
  now,
  {
    agents = [],
    feed = [],
    analytics = { all: { insights: { trend: { days: [1, 2] }, hours: { h: 3 } }, spend: { today: 1.23456789 } } },
    prefs = { workdayHour: 4 },
  } = {},
) => ({ now, prefs, analytics, agents, feed });
const message = (text) => {
  assert.match(text, /^data: .*\n\n$/s);
  return JSON.parse(text.slice(6));
};
const changed = (msg) => msg.changes.map(([path]) => path.join('.'));
const agent = (id, status = 'idle') => ({ id, status });

test('the first message has everything: each part, the analytics card by card, and every item in order', () => {
  const page = emptyPage();
  const msg = message(
    patchFor(page, snapshot(1, { agents: [agent('a'), agent('b')], feed: [{ id: 1, text: 'Read a file' }] })),
  );
  assert.equal(msg.now, 1);
  assert.equal(msg.patch, 1);
  assert.deepEqual(changed(msg), [
    'prefs',
    'analytics.all.insights.trend',
    'analytics.all.insights.hours',
    'analytics.all.spend',
  ]);
  // Costs and ratios go with four decimals at most.
  assert.deepEqual(msg.changes.find(([path]) => path.join('.') === 'analytics.all.spend')[1], { today: 1.2346 });
  assert.deepEqual(msg.items, [
    [['agents'], ['a', 'b'], [agent('a'), agent('b')]],
    [['feed'], [1], [{ id: 1, text: 'Read a file' }]],
  ]);
});

test("an agent that did nothing new isn't sent again, one that changed is, and nothing new sends nothing", () => {
  const page = emptyPage();
  patchFor(page, snapshot(1, { agents: [agent('a'), agent('b')] }));
  // The same snapshot again, a moment later: no changes, and no items at all.
  const quiet = message(patchFor(page, snapshot(2, { agents: [agent('a'), agent('b')] })));
  assert.deepEqual(quiet, { now: 2, patch: 1, changes: [] });
  // b works on: only b goes, and the order (unchanged) as null.
  const msg = message(patchFor(page, snapshot(3, { agents: [agent('a'), agent('b', 'working')] })));
  assert.deepEqual(msg.changes, []);
  assert.deepEqual(msg.items, [[['agents'], null, [agent('b', 'working')]]]);
});

test('a new order is sent whole, with only the items that are new or changed', () => {
  const page = emptyPage();
  patchFor(page, snapshot(1, { agents: [agent('a'), agent('b')] }));
  const msg = message(patchFor(page, snapshot(2, { agents: [agent('c'), agent('a')] })));
  assert.deepEqual(msg.items, [[['agents'], ['c', 'a'], [agent('c')]]]);
  // The same items in another order: the order alone.
  const swapped = message(patchFor(page, snapshot(3, { agents: [agent('a'), agent('c')] })));
  assert.deepEqual(swapped.items, [[['agents'], ['a', 'c'], []]]);
});

test('a part replaces whatever the page had under it, and the parts under it come back whole after', () => {
  const page = emptyPage();
  patchFor(page, snapshot(1));
  // The analytics aren't worked out yet (or any more): one part stands for all of them.
  const gone = message(patchFor(page, snapshot(2, { analytics: null })));
  assert.deepEqual(gone.changes, [[['analytics'], null]]);
  assert.deepEqual([...page.parts.keys()], ['prefs', 'analytics']);
  // When they're back, every card is sent again, even ones the page had before.
  const back = message(patchFor(page, snapshot(3)));
  assert.deepEqual(changed(back), [
    'analytics.all.insights.trend',
    'analytics.all.insights.hours',
    'analytics.all.spend',
  ]);
  assert.ok(!page.parts.has('analytics'));
  // One card changing sends that card alone.
  const one = message(
    patchFor(
      page,
      snapshot(4, {
        analytics: { all: { insights: { trend: { days: [1, 2] }, hours: { h: 4 } }, spend: { today: 1.23456789 } } },
      }),
    ),
  );
  assert.deepEqual(one.changes, [[['analytics', 'all', 'insights', 'hours'], { h: 4 }]]);
});

test('the page puts the messages back together into the snapshot', () => {
  const page = emptyPage();
  const merge = createMerger();
  const snaps = [
    snapshot(1, { agents: [agent('a'), agent('b')], feed: [{ id: 1, text: 'one' }] }),
    snapshot(2, {
      agents: [agent('b', 'working'), agent('c')],
      feed: [
        { id: 1, text: 'one' },
        { id: 2, text: 'two' },
      ],
      prefs: { workdayHour: 6 },
    }),
    snapshot(3, { agents: [agent('c')], analytics: null }),
    snapshot(4, { agents: [], feed: [] }),
  ];
  for (const snap of snaps) {
    const whole = merge(message(patchFor(page, snap)));
    assert.deepEqual(
      whole,
      JSON.parse(
        JSON.stringify(snap, (_key, v) =>
          typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v,
        ),
      ),
    );
  }
});

test('each page has its own record, so one that connects later gets everything', () => {
  const live = createLiveFeed();
  const page = () => ({
    sent: [],
    write(text) {
      this.sent.push(message(text));
    },
  });
  const first = page();
  const later = page();
  live.open(first);
  live.sendAll(snapshot(1, { agents: [agent('a')] }));
  live.open(later);
  assert.equal(live.size, 2);
  live.sendAll(snapshot(2, { agents: [agent('a')] }));
  assert.deepEqual(first.sent[1], { now: 2, patch: 1, changes: [] });
  assert.deepEqual(later.sent[0].items, [
    [['agents'], ['a'], [agent('a')]],
    [['feed'], [], []],
  ]);
  // A page that's gone is sent nothing more.
  live.close(first);
  live.sendAll(snapshot(3, { agents: [agent('a', 'working')] }));
  live.send(first, snapshot(3));
  assert.equal(first.sent.length, 2);
  assert.equal(later.sent.length, 2);
  assert.equal(live.size, 1);
});
