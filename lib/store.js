// What Overtime keeps of its own, as small JSON files in ~/.overtime
// (or $OVERTIME_DIR): your dashboard settings (settings.json), the ones that
// change what the server works out, like the hour your working day starts and
// whether search keeps the conversations' text (prefs.json), and a summary of each past day (history.json), so the activity
// heatmap reaches further back than the transcripts, which Claude Code clears
// after 30 days. Nothing is written anywhere else, and never to a transcript.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SOURCES } from './sources.js';

/** Overtime's folder: $OVERTIME_DIR, else ~/.overtime. */
export const dataDir = () => process.env.OVERTIME_DIR || path.join(os.homedir(), '.overtime');

const DAY = 86_400_000;
const KEEP_DAYS = 400; // a year of heatmap, and a little over
const SCOPES = ['all', ...SOURCES];

export const DEFAULT_PREFS = { workdayHour: 4, search: true };

/**
 * Settings as the server accepts them: a working day starts between midnight
 * and noon, and search inside conversations is on or off. Anything else keeps `base`.
 */
export function cleanPrefs(input = {}, base = DEFAULT_PREFS) {
  const hour = input?.workdayHour == null || input.workdayHour === '' ? NaN : Number(input.workdayHour);
  return {
    workdayHour: Number.isInteger(hour) && hour >= 0 && hour <= 12 ? hour : base.workdayHour ?? DEFAULT_PREFS.workdayHour,
    search: typeof input?.search === 'boolean' ? input.search : base.search ?? DEFAULT_PREFS.search,
  };
}

// Dashboard settings are the pages' own saved values, by the name the page keeps
// them under. Where you were last, and whether a browser has synced yet, stay with each browser.
const SETTING_KEY = /^overtime-[a-z0-9-]{1,60}$/;
export const LOCAL_ONLY = ['overtime-page', 'overtime-synced'];
const MAX_VALUE = 200_000;
const MAX_TOTAL = 2_000_000;

export const isSetting = (key) => SETTING_KEY.test(key) && !LOCAL_ONLY.includes(key);

/**
 * Apply a page's changes to the saved settings: `set` maps a name to its new
 * text, or to null to forget it. Anything that isn't a dashboard setting, or is
 * too big, is left out. Returns the new values and whether anything changed.
 */
export function applySettings(values, set) {
  const next = { ...values };
  let changed = false;
  for (const [key, value] of Object.entries(set && typeof set === 'object' ? set : {})) {
    if (!isSetting(key)) continue;
    if (value === null) {
      if (key in next) {
        delete next[key];
        changed = true;
      }
    } else if (typeof value === 'string' && value.length <= MAX_VALUE && next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  const size = Object.entries(next).reduce((n, [k, v]) => n + k.length + v.length, 0);
  return size > MAX_TOTAL ? { values, changed: false, tooBig: true } : { values: next, changed };
}

/**
 * A script for the top of a page that puts your saved settings into the
 * browser before anything reads them. The saved ones win. A browser that has
 * synced before then matches the file exactly, so a setting cleared elsewhere
 * is cleared here too; one that hasn't keeps what only it has, and the page
 * sends that to be saved, so opening the dashboard in a new browser loses nothing.
 */
export function settingsScript(saved) {
  const data = JSON.stringify({ initialized: !!saved.initialized, values: saved.values || {} })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>
    // Your settings, as Overtime keeps them in ~/.overtime/settings.json.
    (() => {
      const saved = ${data};
      window.overtimeSettings = saved;
      if (!saved.initialized) return;
      try {
        const local = ${JSON.stringify(LOCAL_ONLY)};
        const stale = [];
        if (localStorage.getItem('overtime-synced')) {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (/^overtime-/.test(key) && !local.includes(key) && !(key in saved.values)) stale.push(key);
          }
        }
        for (const key of stale) localStorage.removeItem(key);
        for (const [key, value] of Object.entries(saved.values)) if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
      } catch {}
    })();
  </script>`;
}

/** A day as the history file writes it: 2026-09-24, in local time. */
export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function keyTime(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Days the transcripts still cover in full replace what was kept for them;
 * older ones keep what was written while they were. `fresh` is, per provider
 * view, the last 30 days as `dailyTotals` gives them, oldest first.
 */
export function mergeHistory(kept, fresh, now = Date.now()) {
  const days = { ...(kept?.days || {}) };
  // The oldest day or two may already have lost transcripts to Claude Code's clean-up,
  // and today isn't over, so only the days in between are written down.
  const settledFrom = now - 28 * DAY;
  const today = dayKey(now);
  let changed = false;
  for (const scope of SCOPES) {
    for (const d of fresh?.[scope] || []) {
      const key = dayKey(d.day);
      if (d.day < settledFrom || key === today) continue;
      const { day, ...values } = d;
      const before = days[key]?.[scope];
      if (before && JSON.stringify(before) === JSON.stringify(values)) continue;
      days[key] = { ...days[key], [scope]: values };
      changed = true;
    }
  }
  const cutoff = dayKey(now - KEEP_DAYS * DAY);
  for (const key of Object.keys(days)) {
    if (key < cutoff) {
      delete days[key];
      changed = true;
    }
  }
  return { history: { version: 1, days }, changed };
}

/**
 * Every day on record for one provider view, oldest first: what was kept,
 * with the last 30 days from the transcripts over it.
 */
export function historyDays(kept, fresh, scope) {
  const byKey = new Map();
  for (const [key, v] of Object.entries(kept?.days || {})) if (v[scope]) byKey.set(key, { day: keyTime(key), ...v[scope], kept: true });
  for (const d of fresh?.[scope] || []) byKey.set(dayKey(d.day), d);
  return [...byKey.values()].sort((a, b) => a.day - b.day);
}

export function createStore({ dir = dataDir() } = {}) {
  const timers = new Map();

  async function read(name, fallback) {
    try {
      return JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  /** Written a moment later, all at once, so a burst of changes is one write. */
  function write(name, value) {
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(async () => {
      timers.delete(name);
      try {
        await fsp.mkdir(dir, { recursive: true });
        const file = path.join(dir, name);
        await fsp.writeFile(`${file}.tmp`, JSON.stringify(value));
        await fsp.rename(`${file}.tmp`, file);
      } catch (error) {
        console.error(`Couldn't save ${name} in ${dir}: ${error.message}`);
      }
    }, 1000));
  }

  return { dir, read, write };
}
