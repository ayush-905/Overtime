// The server behind the app's windows. If Overtime is already running on its
// port (`npm start` in a terminal, say), the app uses that one as it is, so two
// servers never write your settings over each other. Otherwise the app starts
// its own, the same server.js, in a utility process beside it, and starts it
// again if it stops. If the one it was using stops, the app takes over on the
// same port, and open pages reconnect by themselves. Only if something else
// holds the port does it pick a free one, and then the windows load from there.
// If its own keeps stopping (a sixth time in a minute), or can't be started
// in its place, the app gives up and says so; `restart()` tries again.

import { hello as overtimeOn } from './hello.js';
import { retryLimit } from './retry-limit.js';

const WATCH_MS = 5000;
const RESTART_MS = 1000;

/**
 * `entry` is server.js; `env` what it runs with; `utilityProcess` is Electron's,
 * passed in so the tests can stand in for it (and for `hello`, and the timings).
 * `onPort(port)` hears when the port changes after the start, so the windows can
 * load from the new one. `onState(state)` hears how it's going: 'running' (its
 * own server, or the one it shares: see `mode`), 'restarting' (its own stopped,
 * or the one it shared did, and it's starting one), or 'stopped' (it gave up).
 */
export function createServerHost({
  entry,
  port: preferred,
  env,
  utilityProcess,
  log = () => {},
  onPort = () => {},
  onState = () => {},
  hello = overtimeOn,
  watchMs = WATCH_MS,
  restartMs = RESTART_MS,
}) {
  let child = null; // the server the app started, if it did
  let port = null;
  let mode = null; // 'own' or 'shared'
  let state = 'starting';
  let stopping = false;
  let watch = null;
  let again = null;
  const restarts = retryLimit({ times: 5, withinMs: 60_000 });

  function setState(next) {
    if (next === state) return;
    state = next;
    onState(state);
  }

  /** Start server.js on a port: { ok, port, proc }, { inUse }, or { error }. */
  function fork(p) {
    return new Promise((resolve) => {
      const proc = utilityProcess.fork(entry, [], {
        env: { ...env, PORT: String(p) },
        serviceName: 'Overtime server',
        stdio: 'pipe',
      });
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      proc.stdout?.on('data', (d) => log(String(d).trimEnd()));
      proc.stderr?.on('data', (d) => log(String(d).trimEnd()));
      proc.on('message', (m) => {
        if (m?.type === 'listening') settle({ ok: true, port: m.port, proc });
        else if (m?.type === 'in-use') settle({ inUse: true });
        else if (m?.type === 'error') settle({ error: m.message });
      });
      proc.on('exit', (code) => {
        settle({ error: `it stopped (code ${code})` });
        if (proc === child) stopped(`code ${code}`);
      });
    });
  }

  function own(result) {
    stopWatching();
    child = result.proc;
    mode = 'own';
    setPort(result.port);
    log(`started the server on port ${port}`);
    setState('running');
  }

  function share(p) {
    child = null;
    mode = 'shared';
    setPort(p);
    log(`using the Overtime already running on port ${p}`);
    setState('running');
    // If it stops, take over.
    let misses = 0;
    stopWatching();
    watch = setInterval(async () => {
      if (await hello(p)) {
        misses = 0;
        return;
      }
      if (++misses < 2) return;
      stopWatching();
      log('the server this app was using stopped; starting its own');
      setState('restarting');
      startAgain();
    }, watchMs);
  }

  function stopWatching() {
    clearInterval(watch);
    watch = null;
  }

  function setPort(p) {
    const changed = port != null && p !== port;
    port = p;
    if (changed) onPort(p);
  }

  /** Our own server on `p`, or the Overtime there, or ours on any free port. */
  async function startOn(p) {
    let result = await fork(p);
    if (result.inUse) {
      if (await hello(p)) return share(p);
      log(`port ${p} is taken by something else; using a free one`);
      result = await fork(0);
    }
    if (!result.ok) throw new Error(`Overtime's server couldn't start: ${result.error}`);
    own(result);
  }

  /** On the same port, so pages reconnect; one that doesn't start counts as stopping again. */
  function startAgain() {
    if (stopping) return;
    startOn(port ?? preferred).catch((error) => {
      log(error.message);
      stopped("it didn't start");
    });
  }

  /** Ours stopped without being asked to: start it again in a moment, unless it keeps stopping. */
  function stopped(why) {
    child = null;
    if (stopping) return;
    if (!restarts.take()) {
      log(`the server keeps stopping (${why}); not starting it again`);
      setState('stopped');
      return;
    }
    log(`the server stopped (${why}); starting it again`);
    setState('restarting');
    clearTimeout(again);
    again = setTimeout(startAgain, restartMs);
  }

  return {
    async start() {
      if (await hello(preferred)) share(preferred);
      else await startOn(preferred);
      return port;
    },
    /** After it gave up: start it again, asked to, with a fresh count of restarts. */
    restart() {
      if (stopping || state !== 'stopped') return;
      restarts.reset();
      log('starting the server again, as asked');
      setState('restarting');
      startAgain();
    },
    stop() {
      stopping = true;
      stopWatching();
      clearTimeout(again);
      child?.kill();
    },
    get port() {
      return port;
    },
    get mode() {
      return mode;
    },
    get state() {
      return state;
    },
  };
}
