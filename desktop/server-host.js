// The server behind the app's windows. If Overtime is already running on its
// port (`npm start` in a terminal, say), the app uses that one as it is, so two
// servers never write your settings over each other. Otherwise the app starts
// its own, the same server.js, in a utility process beside it, and starts it
// again if it stops. If the one it was using stops, the app takes over on the
// same port, and open pages reconnect by themselves. Only if something else
// holds the port does it pick a free one, and then the windows load from there.

import { utilityProcess } from 'electron';
import { hello } from './hello.js';

const WATCH_MS = 5000;

/**
 * `entry` is server.js; `env` what it runs with. `onPort(port)` hears when the
 * port changes after the start, so the windows can load from the new one.
 */
export function createServerHost({ entry, port: preferred, env, log = () => {}, onPort = () => {} }) {
  let child = null; // the server the app started, if it did
  let port = null;
  let mode = null; // 'own' or 'shared'
  let stopping = false;
  let watch = null;
  let restarts = [];

  /** Start server.js on a port: { ok, port, proc }, { inUse }, or { error }. */
  function fork(p) {
    return new Promise((resolve) => {
      const proc = utilityProcess.fork(entry, [], { env: { ...env, PORT: String(p) }, serviceName: 'Overtime server', stdio: 'pipe' });
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
        if (proc === child) stopped(code);
      });
    });
  }

  function own(result) {
    stopWatching();
    child = result.proc;
    mode = 'own';
    setPort(result.port);
    log(`started the server on port ${port}`);
  }

  function share(p) {
    child = null;
    mode = 'shared';
    setPort(p);
    log(`using the Overtime already running on port ${p}`);
    // If it stops, take over.
    let misses = 0;
    stopWatching();
    watch = setInterval(async () => {
      if (await hello(p)) { misses = 0; return; }
      if (++misses < 2) return;
      stopWatching();
      log('the server this app was using stopped; starting its own');
      await startOn(p).catch((error) => log(error.message));
    }, WATCH_MS);
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

  /** Ours stopped without being asked to: start it again, on the same port so pages reconnect. */
  function stopped(code) {
    child = null;
    if (stopping) return;
    const now = Date.now();
    restarts = restarts.filter((t) => now - t < 60_000);
    if (restarts.length >= 5) {
      log(`the server keeps stopping (code ${code}); not starting it again`);
      return;
    }
    restarts.push(now);
    log(`the server stopped (code ${code}); starting it again`);
    setTimeout(() => startOn(port).catch((error) => log(error.message)), 1000);
  }

  return {
    async start() {
      if (await hello(preferred)) share(preferred);
      else await startOn(preferred);
      return port;
    },
    stop() {
      stopping = true;
      stopWatching();
      child?.kill();
    },
    get port() { return port; },
    get mode() { return mode; },
  };
}
