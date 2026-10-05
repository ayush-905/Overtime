// The exact plan limits, as Anthropic reports them for the Claude Code login.
// Nothing here leaves the machine: fetch is stubbed, the login is a test one in
// a scratch CLAUDE_CONFIG_DIR, and the Keychain lookup is answered by the test.
//
// One copy of the module for the whole file, as the server has, so what it
// remembers carries over: the tests run in order, the ones before any reading
// first, and each starts a day after the last, so nothing remembered is fresh.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exactLimits, forgetLogin } from '../lib/limits.js';
import { scratch } from './helpers.js';

const SECOND = 1000;
let clock = Date.parse('2026-03-02T10:00:00.000Z');

/**
 * A test login in a scratch folder, fetch answering with `answers` in turn (a
 * Response, or an error to throw), and the clock, a day on from the last test.
 */
async function setup(t, { token = 'test-token-1', expiresIn = 3600 * SECOND, answers = [] } = {}) {
  clock += 86_400 * SECOND;
  const start = clock;
  t.mock.method(Date, 'now', () => clock);
  forgetLogin(); // the last test's login
  const dir = await scratch(t);
  const credentials = path.join(dir, '.credentials.json');
  const saveLogin = (accessToken) =>
    writeFile(
      credentials,
      JSON.stringify({
        claudeAiOauth: {
          accessToken,
          refreshToken: 'test-refresh',
          expiresAt: start + expiresIn,
          scopes: ['user:inference'],
        },
      }),
    );
  if (token) await saveLogin(token);
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  t.after(() => {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  });

  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: String(url), headers: init.headers });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  });
  // The Keychain has nothing, so the login comes from the file.
  const keychain = [];
  const run = async (cmd, args) => {
    keychain.push([cmd, ...args]);
    return null;
  };
  return {
    exact: (options = {}) => exactLimits({ run, ...options }),
    start,
    requests,
    keychain,
    credentials,
    saveLogin,
    later: (ms) => {
      clock += ms;
    },
  };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const USAGE = {
  five_hour: { utilization: 42.4, resets_at: '2026-03-02T14:00:00.000Z' },
  seven_day: { utilization: 107, resets_at: 1_772_900_000 },
  seven_day_opus: { utilization: 12, resets_at: null },
  seven_day_sonnet: null,
  seven_day_oauth_apps: { utilization: 'none' },
};

test('a login past its expiry, or none at all, says so without asking Anthropic', async (t) => {
  const s = await setup(t, { expiresIn: -SECOND });
  const r = await s.exact();
  assert.equal(r.status, 'expired');
  assert.match(r.message, /expired/);
  await rm(s.credentials);
  const none = await s.exact();
  assert.equal(none.status, 'no-login');
  assert.match(none.message, /claude auth login/);
  assert.equal(s.requests.length, 0);
});

test('rate limited before any reading: it says when it will try again, five minutes on unless Anthropic says otherwise', async (t) => {
  const s = await setup(t, { answers: [json({ error: 'rate_limited' }, 429)] });
  const r = await s.exact();
  assert.deepEqual(r, { source: 'exact', status: 'cooling', retryAt: s.start + 5 * 60 * SECOND });
  s.later(4 * 60 * SECOND);
  assert.deepEqual(await s.exact(), r);
  assert.equal(s.requests.length, 1);
});

test('with no reading yet, a failure says what went wrong', async (t) => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const s = await setup(t, {
    answers: [new TypeError('fetch failed'), timeout, new Response('not json', { status: 200 }), json({}, 502)],
  });
  const said = [];
  for (let i = 0; i < 4; i++) {
    const r = await s.exact();
    assert.equal(r.status, 'error');
    said.push(r.message);
  }
  assert.deepEqual(said, [
    "Couldn't reach Anthropic (network error).",
    "Couldn't reach Anthropic (timed out).",
    "Couldn't reach Anthropic (network error).",
    'Anthropic answered 502. Trying again later.',
  ]);
});

test('a login Anthropic turns down (401 or 403) asks you to sign in again, and is read afresh the next time', async (t) => {
  const s = await setup(t, {
    answers: [json({ error: 'invalid token' }, 401), json({ error: 'forbidden' }, 403), json(USAGE)],
  });
  let r = await s.exact();
  assert.equal(r.status, 'expired');
  assert.match(r.message, /\(401\).*claude auth login/);
  r = await s.exact();
  assert.equal(r.status, 'expired');
  assert.match(r.message, /\(403\)/);
  // You signed in again: the new login is used.
  await s.saveLogin('test-token-2');
  r = await s.exact();
  assert.equal(r.status, 'ok');
  assert.equal(s.requests.at(-1).headers.Authorization, 'Bearer test-token-2');
});

test('the exact limits come from Anthropic with the Claude Code login, and are asked for at most once a minute', async (t) => {
  const s = await setup(t, {
    answers: [
      json(USAGE),
      json({ ...USAGE, five_hour: { utilization: 50, resets_at: '2026-03-02T14:00:00.000Z' } }),
      json(USAGE),
    ],
  });
  const r = await s.exact();
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'exact');
  // Percentages rounded and kept within 0 to 100; reset times from an ISO date or seconds.
  assert.deepEqual(r.session, { pct: 42, resetsAt: Date.parse('2026-03-02T14:00:00.000Z') });
  assert.deepEqual(r.weekly, { pct: 100, resetsAt: 1_772_900_000_000 });
  // Only the extra windows Anthropic reported a number for.
  assert.deepEqual(r.extras, [{ key: 'seven_day_opus', label: 'Weekly · Opus', pct: 12, resetsAt: null }]);
  assert.equal(r.fetchedAt, s.start);

  assert.equal(s.requests.length, 1);
  const [{ url, headers }] = s.requests;
  assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(headers.Authorization, 'Bearer test-token-1');
  assert.equal(headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.match(headers['User-Agent'], /^overtime\//);
  // The Keychain is where the login is looked for first, on a Mac.
  if (process.platform === 'darwin')
    assert.deepEqual(s.keychain, [['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']]);

  // Within the minute, the same reading; Refresh asks again only after 15 seconds.
  s.later(10 * SECOND);
  assert.equal(await s.exact(), r);
  assert.equal(await s.exact({ force: true }), r);
  assert.equal(s.requests.length, 1);
  s.later(6 * SECOND);
  assert.equal((await s.exact({ force: true })).session.pct, 50);
  assert.equal(s.requests.length, 2);
  s.later(61 * SECOND);
  assert.equal((await s.exact()).session.pct, 42);
  assert.equal(s.requests.length, 3);
});

test('rate limited (429): the last good reading is kept, marked stale, and Anthropic is left alone until Retry-After has passed', async (t) => {
  const s = await setup(t, {
    answers: [
      json(USAGE),
      json({ error: 'rate_limited' }, 429, { 'retry-after': '120' }),
      json({ ...USAGE, five_hour: { utilization: 61, resets_at: null } }),
    ],
  });
  const good = await s.exact();
  s.later(61 * SECOND);
  let r = await s.exact();
  assert.deepEqual(r, { ...good, stale: true });
  assert.equal(s.requests.length, 2);
  // Within the two minutes it asked for, even Refresh doesn't ask again.
  s.later(60 * SECOND);
  assert.deepEqual(await s.exact({ force: true }), { ...good, stale: true });
  assert.equal(s.requests.length, 2);
  s.later(61 * SECOND);
  r = await s.exact();
  assert.deepEqual([r.status, r.stale, r.session.pct], ['ok', undefined, 61]);
  assert.equal(s.requests.length, 3);
});

test("a network error, a timeout, an answer that isn't JSON or a server error keeps the last good reading, marked stale", async (t) => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const s = await setup(t, {
    answers: [
      json(USAGE),
      new TypeError('fetch failed'),
      timeout,
      new Response('<html>Bad gateway</html>', { status: 200 }),
      json({}, 500),
    ],
  });
  const good = await s.exact();
  for (let i = 0; i < 4; i++) {
    s.later(61 * SECOND);
    assert.deepEqual(await s.exact(), { ...good, stale: true }, `answer ${i + 2}`);
  }
  assert.equal(s.requests.length, 5);
});

test('switching exact numbers off forgets the login, so the next reading uses the one on file then', async (t) => {
  const s = await setup(t, { answers: [json(USAGE), json(USAGE)] });
  await s.exact();
  await s.saveLogin('test-token-2');
  forgetLogin();
  s.later(61 * SECOND);
  await s.exact();
  assert.deepEqual(
    s.requests.map((r) => r.headers.Authorization),
    ['Bearer test-token-1', 'Bearer test-token-2'],
  );
});
