// How often the app starts something again before it stops trying: at most
// `times` in any `withinMs`. The server gets 5 a minute (server-host.js), each
// window's page 3 in 5 minutes (page-keeper.js). No Electron here, so the tests
// can load it.

/** `take()` says whether one more try is allowed, and counts it if so; `reset()` forgets the tries so far. */
export function retryLimit({ times, withinMs, now = Date.now }) {
  let tries = [];
  return {
    take() {
      const t = now();
      tries = tries.filter((at) => t - at < withinMs);
      if (tries.length >= times) return false;
      tries.push(t);
      return true;
    },
    reset() {
      tries = [];
    },
  };
}
