// Keeps a window's page going. If its renderer process goes (it crashed, ran
// out of memory, or was killed), the page loads again a second later, where it
// was. The dashboard's alerts and the menu bar's figures come from pages that
// stay hidden, so without this they would just stop. A page that keeps going
// (a fourth time in 5 minutes) is left as it is and counted as down;
// `onChange(down)` hears that, so the app can say so, and `revive()` loads it
// again with a fresh count. A page that couldn't load while the server was away
// loads again with `retry()` once it's back.
//
// No Electron here: `wc` is the window's webContents, or a stand-in in the tests.

import { retryLimit } from './retry-limit.js';

const ABORTED = -3; // a load that another one replaced: nothing went wrong

/**
 * `name` says which window in the log; `home()` is where to load if the page has
 * no address yet; `quitting()` is true once the app is quitting, when pages go
 * for good.
 */
export function keepPage(
  wc,
  {
    name,
    home,
    log = () => {},
    onChange = () => {},
    quitting = () => false,
    delayMs = 1000,
    times = 3,
    withinMs = 5 * 60_000,
  },
) {
  const reloads = retryLimit({ times, withinMs });
  let down = false;
  let failed = false; // its last load didn't reach the server
  let timer = null;

  function load() {
    if (wc.isDestroyed()) return;
    // A load that fails says so through did-fail-load, below.
    wc.loadURL(wc.getURL() || home()).catch(() => {});
  }

  function setDown(next) {
    if (down === next) return;
    down = next;
    onChange(down);
  }

  wc.on('render-process-gone', (_e, { reason, exitCode }) => {
    log(`the ${name}'s page stopped (${reason}, code ${exitCode})`);
    if (reason === 'clean-exit' || quitting()) return;
    if (!reloads.take()) {
      log(`the ${name}'s page keeps stopping; not loading it again`);
      setDown(true);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (quitting()) return;
      log(`loading the ${name}'s page again`);
      load();
    }, delayMs);
  });
  wc.on('unresponsive', () => log(`the ${name}'s page isn't responding`));
  wc.on('responsive', () => log(`the ${name}'s page is responding again`));
  wc.on('did-start-loading', () => {
    failed = false;
  });
  wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === ABORTED) return;
    failed = true;
    log(`the ${name}'s page couldn't load (${description})`);
  });
  // Loaded again by anything (the server moved, you opened it): it's back.
  wc.on('did-finish-load', () => {
    if (!failed) setDown(false);
  });
  wc.on('destroyed', () => clearTimeout(timer));

  return {
    get down() {
      return down;
    },
    /** Load it again, asked to: the count of reloads starts afresh. */
    revive() {
      clearTimeout(timer);
      reloads.reset();
      log(`loading the ${name}'s page again, as asked`);
      setDown(false);
      load();
    },
    /** The server's back: a page that couldn't reach it loads again. */
    retry() {
      if (!failed) return;
      log(`loading the ${name}'s page again, now the server's back`);
      load();
    },
  };
}
