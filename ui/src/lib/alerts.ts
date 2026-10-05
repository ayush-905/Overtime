// Alerts: what's worth a chime, from the live agents, the plan windows and the
// day's cost. Each kind has its own switch in Settings: an agent needs you, one
// has waited for you a while, one looks stuck, a limit is 80% / 90% used or hit,
// you're on pace to run out, a limit you hit (or nearly) has reset, today's cost
// passed a budget, and the weekly digest is ready. What has already been said is
// remembered, so a reload doesn't repeat it. app/alerts.ts runs the checks and
// says them.

import { changed } from './bus';
import { clip, duration, money, projectName, whenText } from './format';
import { titleFor } from './labels';
import { doingText, sinceFor, type LiveAgent } from './agents';
import { providerName, quotaFreshness, stuckState, stuckText, type QuotaItem } from './limits';
import { digestReady } from './digest';
import { readAlertPrefs, STUCK_MAX_MINUTES, WAIT_MAX_MINUTES, type AlertPrefs } from './alertPrefs';

export { STUCK_MAX_MINUTES, WAIT_MAX_MINUTES, readAlertPrefs, type AlertPrefs };

const MINUTE = 60_000;
const NEEDS_KEY = 'overtime-alerts'; // the original switch, kept so it stays on for you
const PREFS_KEY = 'overtime-alert-prefs';
const MEMORY_KEY = 'overtime-alert-memory';
const RESET_GRACE_MS = 15 * MINUTE; // a reset older than this, found on coming back, isn't worth a chime

export function saveAlertPrefs(prefs: AlertPrefs) {
  try {
    localStorage.setItem(NEEDS_KEY, prefs.needs ? '1' : '0');
    const { needs: _needs, ...rest } = prefs;
    localStorage.setItem(PREFS_KEY, JSON.stringify(rest));
  } catch {}
  changed('prefs');
}

export type Level = 'info' | 'warn' | 'crit' | 'good';
export type Alert = { title: string; body: string; tag: string; level: Level };

type Memory = {
  said: Record<string, number>;
  hot: Record<string, { resetsAt: number; name: string; session: boolean } | number>;
};
let memory: Memory = { said: {}, hot: {} };
export function loadMemory() {
  try {
    memory = { said: {}, hot: {}, ...JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}') };
  } catch {
    memory = { said: {}, hot: {} };
  }
}
loadMemory();

function saveMemory() {
  // Forget what's over a week old.
  const cutoff = Date.now() - 8 * 86_400_000;
  for (const [k, t] of Object.entries(memory.said)) if (t < cutoff) delete memory.said[k];
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {}
}

const said = (key: string) => !!memory.said[key];
const say = (key: string) => {
  memory.said[key] = Date.now();
};

/** New agents that need you since the last snapshot. */
export function checkNeeds(prefs: AlertPrefs, prev: Map<string, LiveAgent>, agents: LiveAgent[]): Alert[] {
  if (!prefs.needs) return [];
  return agents
    .filter((a) => a.kind === 'main' && a.needsYou && !prev.get(a.id)?.needsYou)
    .map((a) => ({
      title: doingText(a),
      body: `${clip(titleFor(a.id, a.title), 80)}${a.project ? ` · ${projectName(a.project)}` : ''}`,
      tag: a.id,
      level: 'info' as const,
    }));
}

/** An agent has been done and waiting for you longer than you'd like: once per wait. */
export function checkWaiting(prefs: AlertPrefs, agents: LiveAgent[], now: number): Alert[] {
  if (!prefs.waiting) return [];
  const out: Alert[] = [];
  for (const a of agents) {
    const since = a.kind === 'main' && a.needsYou ? sinceFor(a) : null;
    if (!since || now - since < prefs.waitMinutes * MINUTE) continue;
    const key = `wait:${a.id}:${Math.round(since / 1000)}`;
    if (said(key)) continue;
    say(key);
    out.push({
      title: `${clip(titleFor(a.id, a.title), 60)} has waited ${duration(now - since)} for you`,
      body: `${doingText(a)}${a.project ? ` · ${projectName(a.project)}` : ''}`,
      tag: key,
      level: 'warn',
    });
  }
  if (out.length) saveMemory();
  return out;
}

/** An agent looks stuck: failing over and over, or one call (or the whole turn) going nowhere. Once each time. */
export function checkStuck(prefs: AlertPrefs, agents: LiveAgent[], now: number): Alert[] {
  if (!prefs.stuck) return [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out: Alert[] = [];
  for (const a of agents) {
    const stuck = stuckState(a as never, now, prefs.stuckMinutes);
    if (!stuck) continue;
    // Once per tool call that runs too long, and once per turn for the rest.
    const mark = stuck.kind === 'tool' ? stuck.since : a.turnStartedAt || stuck.since;
    const key = `stuck:${a.id}:${stuck.kind}:${Math.round(mark / 1000)}`;
    if (said(key)) continue;
    say(key);
    const session = a.kind === 'sub' && a.parentId ? byId.get(a.parentId) || a : a;
    out.push({
      title: `${a.kind === 'sub' ? 'A subagent of ' : ''}${clip(titleFor(session.id, session.title), 60)} may be stuck`,
      body: `${stuckText(stuck, now)}${a.project ? ` · ${projectName(a.project)}` : ''}`,
      tag: key,
      level: 'warn',
    });
  }
  if (out.length) saveMemory();
  return out;
}

/** Early in the week, once: last week's digest is ready to read. */
export function checkDigest(prefs: AlertPrefs, now: number): Alert[] {
  if (!prefs.digest) return [];
  const ready = digestReady(now);
  const key = ready ? `digest:${ready.to}` : '';
  if (!ready || said(key) || new Date(now).getHours() < 8) return [];
  say(key);
  saveMemory();
  return [
    {
      title: 'Your week in review is ready',
      body: 'Open it from the Overview: cost, projects, your time and how long agents waited for you.',
      tag: key,
      level: 'info',
    },
  ];
}

/** Limits, pace, resets and the daily budget, from whatever the limit cards show. */
export function checkLimits(
  prefs: AlertPrefs,
  items: QuotaItem[],
  todayCost: number | null | undefined,
  now: number,
): Alert[] {
  const out: Alert[] = [];
  let dirty = false;
  for (const w of items) {
    if (w.usedPercent == null || w.expired || w.stale || quotaFreshness(w, now).stale || !w.resetsAt || w.idle)
      continue;
    // Keyed by window, with the reset rounded so an estimate, the exact numbers
    // and a recorded report of the same window all agree on it.
    const win = `${w.id}:${Math.round(w.resetsAt / (10 * MINUTE))}`;
    const name = `${providerName(w.provider)} ${w.label.toLowerCase()} limit`;
    const used = w.usedPercent;
    if (used >= 90 && !memory.hot[win]) {
      memory.hot[win] = { resetsAt: w.resetsAt, name, session: w.id === 'claude:session' };
      dirty = true;
    }
    const at = [100, 90, 80].find((x) => used >= x);
    if (prefs.limits && at && !said(`${win}:${at}`)) {
      // One alert for the highest mark reached; the lower ones count as said.
      for (const x of [80, 90, 100]) if (x <= at) say(`${win}:${x}`);
      dirty = true;
      const resets = `It resets ${whenText(w.resetsAt)}, in ${duration(w.resetsAt - now)}.${w.source === 'recorded' ? ' As Codex last recorded it.' : ''}`;
      out.push(
        at === 100
          ? { title: `You've hit the ${name}`, body: resets, tag: `${win}:limit`, level: 'crit' }
          : {
              title: `${name[0].toUpperCase()}${name.slice(1)} ${Math.round(used)}% used`,
              body: resets,
              tag: `${win}:limit`,
              level: at >= 90 ? 'crit' : 'warn',
            },
      );
    }
    // Forecasts come with each window: Claude's from its spend, Codex's from its readings.
    const o = w.outlook;
    if (prefs.pace && o && (o.level === 'warn' || o.level === 'crit') && !said(`${win}:pace`)) {
      say(`${win}:pace`);
      dirty = true;
      out.push({
        title: `On pace to run out of the ${name}`,
        body: `${o.text}. ${o.tip}`,
        tag: `${win}:pace`,
        level: 'warn',
      });
    }
  }
  // A window you hit, or nearly, has started over.
  for (const [win, hot] of Object.entries(memory.hot)) {
    const resetsAt = typeof hot === 'number' ? hot : hot.resetsAt;
    if (resetsAt > now) continue;
    delete memory.hot[win];
    dirty = true;
    if (prefs.reset && typeof hot !== 'number' && hot.name && now - resetsAt < RESET_GRACE_MS) {
      out.push({
        title: `Your ${hot.name} has reset`,
        body: hot.session ? 'A fresh 5-hour window starts with your next message.' : "You're back to 100% on it.",
        tag: `${win}:reset`,
        level: 'good',
      });
    }
  }
  // The budget counts both providers, whichever one the dashboard shows.
  const day = `budget:${new Date(now).toDateString()}`;
  if (prefs.budget && prefs.budgetUsd > 0 && todayCost != null && todayCost >= prefs.budgetUsd && !said(day)) {
    say(day);
    dirty = true;
    out.push({
      title: `Today's cost passed ${money(prefs.budgetUsd)}`,
      body: `≈ ${money(todayCost)} so far today, at API list prices.`,
      tag: day,
      level: 'warn',
    });
  }
  if (dirty) saveMemory();
  return out;
}
