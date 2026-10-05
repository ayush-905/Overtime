// Your settings live on disk, in ~/.overtime/settings.json, so they outlast
// clearing the browser and follow you to any browser on this Mac. The server
// puts them into the page before anything reads them (see settingsScript), and
// every module keeps reading and writing them in the browser's storage as it
// always has; this sends what changed back to the server a moment later.

const PREFIX = 'overtime-';
// Where you were last is up to each browser, and so is whether it has synced yet.
const LOCAL_ONLY = new Set(['overtime-page', 'overtime-synced']);
const SYNCED_KEY = 'overtime-synced';
const EVERY_MS = 1500;

let sent = new Map(); // what the server has, as far as this page knows
let sending = false;

const synced = (key) => key?.startsWith(PREFIX) && !LOCAL_ONLY.has(key);

function current() {
  const now = new Map();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (synced(key)) now.set(key, localStorage.getItem(key));
    }
  } catch {}
  return now;
}

/** Once this browser's settings are all on disk, it matches the file from then on (see settingsScript). */
function markSynced() {
  try {
    if (!localStorage.getItem(SYNCED_KEY)) localStorage.setItem(SYNCED_KEY, '1');
  } catch {}
}

/** Send whatever changed since the last time. Unsent changes are tried again next time. */
async function flush({ leaving = false } = {}) {
  if (sending && !leaving) return;
  const now = current();
  const set = {};
  for (const [key, value] of now) if (sent.get(key) !== value) set[key] = value;
  for (const key of sent.keys()) if (!now.has(key)) set[key] = null;
  if (!Object.keys(set).length) {
    markSynced();
    return;
  }
  sending = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'X-Overtime': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ set }),
      keepalive: leaving,
    });
    if (res.ok) {
      for (const [key, value] of Object.entries(set)) value === null ? sent.delete(key) : sent.set(key, value);
      markSynced();
    }
  } catch {}
  sending = false;
}

/** Start keeping settings on disk, from the copy the server put in the page. */
export function startSettingsSync() {
  const saved = window.overtimeSettings;
  if (!saved) return;
  // Before there's a settings file, everything this browser has is new to the server, so the first check saves it all.
  sent = saved.initialized ? new Map(Object.entries(saved.values)) : new Map();
  flush();
  setInterval(flush, EVERY_MS);
  // Another tab in this browser changed a setting, and sends it itself.
  window.addEventListener('storage', (e) => {
    if (!synced(e.key)) return;
    if (e.newValue == null) sent.delete(e.key);
    else sent.set(e.key, e.newValue);
  });
  window.addEventListener('pagehide', () => flush({ leaving: true }));
  // Settings were reset or put back in another tab: start again from the file.
  try {
    new BroadcastChannel('overtime').onmessage = (e) => {
      if (e.data === 'reload') location.reload();
    };
  } catch {}
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush({ leaving: true });
  });
}
