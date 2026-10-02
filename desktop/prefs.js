// The app's own few settings, in desktop.json beside your dashboard settings
// (~/.overtime, or $OVERTIME_DIR): what the menu bar shows (every plan
// limit, the one closest to its limit, today's cost, or just the icon), whether
// the app leaves the Dock with its window closed, and where the windows were.
// Written at once, since the app can quit a moment later.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../lib/store.js';

const DIR = dataDir();
const FILE = path.join(DIR, 'desktop.json');

export const MENU_BAR = ['limits', 'closest', 'cost', 'icon'];
const DEFAULTS = { menuBarShows: 'limits', hideDockWhenClosed: false, bounds: null, officeBounds: null };

const isBounds = (b) => b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width >= 200 && b.height >= 200;

function clean(raw) {
  return {
    menuBarShows: MENU_BAR.includes(raw?.menuBarShows) ? raw.menuBarShows : DEFAULTS.menuBarShows,
    hideDockWhenClosed: typeof raw?.hideDockWhenClosed === 'boolean' ? raw.hideDockWhenClosed : DEFAULTS.hideDockWhenClosed,
    bounds: isBounds(raw?.bounds) ? raw.bounds : null,
    officeBounds: isBounds(raw?.officeBounds) ? raw.officeBounds : null,
  };
}

let prefs = null;

export function readPrefs() {
  if (!prefs) {
    try { prefs = clean(JSON.parse(readFileSync(FILE, 'utf8'))); } catch { prefs = clean({}); }
  }
  return prefs;
}

export function savePrefs(change) {
  prefs = clean({ ...readPrefs(), ...change });
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${FILE}.tmp`, JSON.stringify(prefs));
    renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.error(`Couldn't save desktop.json in ${DIR}: ${error.message}`);
  }
  return prefs;
}
