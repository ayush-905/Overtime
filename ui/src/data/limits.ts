// Exact plan limits, beside the local estimate in the live feed. Claude Code's
// exact check is on unless you turned it off: the server asks Anthropic with your
// Claude Code login, at most every 10 minutes (and when you press Refresh).
// Codex's live check is off unless you turn it on; otherwise its windows are what
// Codex recorded in its transcripts.

import { create } from 'zustand';
import { post, demo } from './api';
import { EXACT_KEY, CODEX_EXACT_KEY, readExactOn, readCodexExactOn } from '@/lib/prefs';

const EVERY_MS = 10 * 60 * 1000;

type ExactResult = { status: string; message?: string; [key: string]: unknown };

type LimitsState = {
  exactOn: boolean;
  exact: ExactResult | null;
  codexExactOn: boolean;
  codexExact: ExactResult | null;
  refreshing: boolean;
  codexRefreshing: boolean;
};

export const useLimits = create<LimitsState>(() => ({
  exactOn: readExactOn(),
  exact: null,
  codexExactOn: readCodexExactOn(),
  codexExact: null,
  refreshing: false,
  codexRefreshing: false,
}));

let exactTimer: ReturnType<typeof setInterval> | undefined;
let codexTimer: ReturnType<typeof setInterval> | undefined;
let exactFetchedAt = 0;

async function fetchExact(force = false) {
  if (!useLimits.getState().exactOn || demo) return;
  exactFetchedAt = Date.now();
  let result: ExactResult;
  try {
    result = await post<ExactResult>(`/api/limits/exact${force ? '?fresh=1' : ''}`);
  } catch {
    result = { status: 'error', message: "Couldn't reach Overtime's server." };
  }
  // Switched off while it was on its way.
  if (useLimits.getState().exactOn) useLimits.setState({ exact: result });
}

/** The Codex card's Refresh: ask Codex when the live check is on, else re-read the transcripts. */
async function fetchCodex(force = false) {
  const s = useLimits.getState();
  if (demo || s.codexRefreshing) return;
  useLimits.setState({ codexRefreshing: true });
  if (!s.codexExactOn) {
    await post('/api/refresh').catch(() => {});
  } else {
    let result: ExactResult;
    try {
      result = await post<ExactResult>(`/api/limits/codex${force ? '?fresh=1' : ''}`);
    } catch {
      result = { status: 'error', message: "Couldn't reach Overtime's server for Codex's limits." };
    }
    if (useLimits.getState().codexExactOn) useLimits.setState({ codexExact: result });
  }
  useLimits.setState({ codexRefreshing: false });
}

export function setExact(on: boolean, { save = true } = {}) {
  useLimits.setState({ exactOn: on });
  if (save) try { localStorage.setItem(EXACT_KEY, on ? '1' : '0'); } catch {}
  clearInterval(exactTimer);
  exactTimer = undefined;
  if (on && !demo) {
    fetchExact();
    exactTimer = setInterval(fetchExact, EVERY_MS);
  } else if (!on) {
    useLimits.setState({ exact: null });
    if (!demo) post('/api/limits/forget').catch(() => {});
  }
}

export function setCodexExact(on: boolean, { save = true } = {}) {
  useLimits.setState({ codexExactOn: on });
  if (save) try { localStorage.setItem(CODEX_EXACT_KEY, on ? '1' : '0'); } catch {}
  clearInterval(codexTimer);
  codexTimer = undefined;
  if (on && !demo) {
    fetchCodex();
    codexTimer = setInterval(fetchCodex, EVERY_MS);
  } else if (!on) {
    useLimits.setState({ codexExact: null });
  }
}

/** Refresh: ask now, and restart the regular timer so the next check doesn't follow straight after. With exact off it only re-reads the transcripts here. */
export async function refreshLimits() {
  const s = useLimits.getState();
  if (s.refreshing) return;
  useLimits.setState({ refreshing: true });
  const codex = s.codexExactOn ? fetchCodex(true) : null;
  if (s.exactOn && !demo) {
    await fetchExact(true);
    clearInterval(exactTimer);
    exactTimer = setInterval(fetchExact, EVERY_MS);
  } else if (!demo) {
    await post('/api/refresh').catch(() => {});
  }
  useLimits.setState({ refreshing: false });
  await codex;
}

export const refreshCodex = () => fetchCodex(true);

let started = false;

/** Start the regular checks that are on. Once. */
export function startLimits() {
  if (started) return;
  started = true;
  const s = useLimits.getState();
  if (s.exactOn && !demo) setExact(true, { save: false });
  if (s.codexExactOn) setCodexExact(true, { save: false });
  // Coming back to the page catches up on a check that's due, but no sooner.
  window.addEventListener('focus', () => {
    if (useLimits.getState().exactOn && Date.now() - exactFetchedAt > EVERY_MS) fetchExact();
  });
  // Another tab flipped a switch.
  window.addEventListener('storage', (e) => {
    if (e.key === EXACT_KEY) setExact(e.newValue !== '0', { save: false });
    if (e.key === CODEX_EXACT_KEY) setCodexExact(e.newValue === '1', { save: false });
  });
}
