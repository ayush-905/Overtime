// What the Mac app does when something stops: a window's page whose renderer
// goes (page-keeper.js), and the server it runs (server-host.js). Electron
// itself is stood in for, so this runs under plain Node.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { retryLimit } from '../desktop/retry-limit.js';
import { keepPage } from '../desktop/page-keeper.js';
import { createServerHost } from '../desktop/server-host.js';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await wait(2);
  }
}

/** A window's webContents: it loads what it's told (or fails to, with the server away), and can be made to crash. */
function fakePage(url) {
  const wc = new EventEmitter();
  Object.assign(wc, {
    url,
    loads: [],
    serverUp: true,
    getURL: () => wc.url,
    isDestroyed: () => false,
    async loadURL(to) {
      wc.loads.push(to);
      wc.url = to;
      wc.emit('did-start-loading');
      if (!wc.serverUp) {
        wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', to, true);
        // Electron can say the error page finished loading, too.
        wc.emit('did-finish-load');
        throw new Error('ERR_CONNECTION_REFUSED');
      }
      wc.emit('did-finish-load');
    },
    crash: (reason = 'crashed') => wc.emit('render-process-gone', {}, { reason, exitCode: 5 }),
  });
  return wc;
}

/** Electron's utilityProcess: each server it starts listens, or stops at once, as `plan` says ('listen' by default). */
function fakeUtility() {
  const procs = [];
  const plan = [];
  return {
    procs,
    plan,
    fork(_entry, _args, { env }) {
      const proc = new EventEmitter();
      proc.kill = () => setImmediate(() => proc.emit('exit', 0));
      proc.stop = (code = 1) => proc.emit('exit', code);
      procs.push(proc);
      const what = plan.shift() || 'listen';
      setImmediate(() => {
        if (what === 'listen') proc.emit('message', { type: 'listening', port: Number(env.PORT) || 50123 });
        else proc.emit('exit', 1);
      });
      return proc;
    },
  };
}

test('a limit on tries allows so many in a while, and starts afresh when reset', () => {
  let now = 0;
  const limit = retryLimit({ times: 3, withinMs: 1000, now: () => now });
  assert.deepEqual([limit.take(), limit.take(), limit.take(), limit.take()], [true, true, true, false]);
  now = 999;
  assert.equal(limit.take(), false);
  now = 1000;
  assert.equal(limit.take(), true);
  limit.reset();
  assert.deepEqual([limit.take(), limit.take(), limit.take(), limit.take()], [true, true, true, false]);
});

test("a window's page that stops loads again where it was, and one that keeps stopping is left down until asked", async () => {
  const wc = fakePage('http://127.0.0.1:4781/#sessions');
  const logs = [];
  const changes = [];
  const page = keepPage(wc, {
    name: 'main window',
    home: () => 'http://127.0.0.1:4781/',
    log: (line) => logs.push(line),
    onChange: (down) => changes.push(down),
    delayMs: 5,
  });

  wc.crash();
  await wait(20);
  assert.deepEqual(wc.loads, ['http://127.0.0.1:4781/#sessions']);
  // A clean exit isn't a crash: it stays as it is.
  wc.crash('clean-exit');
  await wait(20);
  assert.equal(wc.loads.length, 1);

  wc.crash('oom');
  await wait(20);
  wc.crash('killed');
  await wait(20);
  assert.equal(wc.loads.length, 3);
  assert.equal(page.down, false);
  // A fourth time in 5 minutes: it's left down, and the app hears it once.
  wc.crash();
  await wait(20);
  assert.equal(wc.loads.length, 3);
  assert.equal(page.down, true);
  assert.deepEqual(changes, [true]);
  assert.match(logs.join('\n'), /the main window's page stopped \(crashed, code 5\)/);
  assert.match(logs.join('\n'), /keeps stopping; not loading it again/);

  // Asked to, it loads again, and has its three reloads back.
  page.revive();
  assert.equal(page.down, false);
  assert.deepEqual(changes, [true, false]);
  assert.equal(wc.loads.length, 4);
  for (let i = 0; i < 3; i++) {
    wc.crash();
    await wait(20);
  }
  assert.equal(wc.loads.length, 7);
  assert.equal(page.down, false);
});

test("a page that couldn't reach the server loads again once it's back, and none loads while the app quits", async () => {
  const wc = fakePage('http://127.0.0.1:4781/#overview');
  let quitting = false;
  const page = keepPage(wc, { name: 'popover', home: () => '', delayMs: 5, quitting: () => quitting });
  wc.serverUp = false;
  wc.crash();
  await wait(20);
  assert.equal(wc.loads.length, 1);
  wc.serverUp = true;
  page.retry();
  assert.equal(wc.loads.length, 2);
  // Loaded, there's nothing to retry.
  page.retry();
  assert.equal(wc.loads.length, 2);
  assert.equal(page.down, false);

  quitting = true;
  wc.crash('killed');
  await wait(20);
  assert.equal(wc.loads.length, 2);
});

test("the app's server starts again when it stops, is given up on when it keeps stopping, and starts when asked", async (t) => {
  const utility = fakeUtility();
  const states = [];
  const logs = [];
  const host = createServerHost({
    entry: 'server.js',
    port: 4999,
    env: {},
    utilityProcess: utility,
    hello: async () => null,
    restartMs: 5,
    log: (line) => logs.push(line),
    onState: (state) => states.push(state),
  });
  t.after(() => host.stop());
  assert.equal(await host.start(), 4999);
  assert.equal(host.mode, 'own');
  assert.equal(host.state, 'running');

  // Five stops in a minute are each started again, on the same port.
  for (let i = 0; i < 5; i++) {
    utility.procs.at(-1).stop();
    assert.equal(host.state, 'restarting');
    await until(() => host.state === 'running');
  }
  assert.equal(utility.procs.length, 6);
  assert.equal(host.port, 4999);
  // A sixth, and it gives up, and says so.
  utility.procs.at(-1).stop(7);
  assert.equal(host.state, 'stopped');
  await wait(20);
  assert.equal(utility.procs.length, 6);
  assert.match(logs.join('\n'), /the server keeps stopping \(code 7\); not starting it again/);
  assert.deepEqual(states, ['running', ...Array(5).fill(['restarting', 'running']).flat(), 'stopped']);

  // Asked to, it starts again, with its five restarts back.
  host.restart();
  assert.equal(host.state, 'restarting');
  await until(() => host.state === 'running');
  assert.equal(host.port, 4999);
  utility.procs.at(-1).stop();
  await until(() => host.state === 'running');
  assert.equal(utility.procs.length, 8);
});

test("a server that won't start again is given up on, not tried forever, and stopping the app doesn't restart it", async (t) => {
  const utility = fakeUtility();
  const states = [];
  const host = createServerHost({
    entry: 'server.js',
    port: 4999,
    env: {},
    utilityProcess: utility,
    hello: async () => null,
    restartMs: 5,
    onState: (state) => states.push(state),
  });
  t.after(() => host.stop());
  await host.start();
  utility.plan.push(...Array(10).fill('fail'));
  utility.procs.at(-1).stop();
  await until(() => host.state === 'stopped');
  // The one that stopped, and five that didn't start.
  assert.equal(utility.procs.length, 6);
  assert.deepEqual(states, ['running', 'restarting', 'stopped']);

  utility.plan.length = 0;
  host.restart();
  await until(() => host.state === 'running');
  host.stop();
  await wait(20);
  assert.equal(utility.procs.length, 7);
  assert.equal(host.state, 'running');
});

test("the app shares the Overtime already running, takes over when it stops, and says so when it can't", async (t) => {
  const utility = fakeUtility();
  let up = true;
  const host = createServerHost({
    entry: 'server.js',
    port: 4999,
    env: {},
    utilityProcess: utility,
    hello: async () => (up ? { app: 'overtime' } : null),
    watchMs: 5,
    restartMs: 5,
  });
  t.after(() => host.stop());
  await host.start();
  assert.equal(host.mode, 'shared');
  assert.equal(host.state, 'running');
  assert.equal(utility.procs.length, 0);

  up = false;
  utility.plan.push(...Array(6).fill('fail'));
  await until(() => host.state === 'stopped');
  assert.equal(utility.procs.length, 6);

  utility.plan.length = 0;
  host.restart();
  await until(() => host.state === 'running');
  assert.equal(host.mode, 'own');
  assert.equal(host.port, 4999);
});
