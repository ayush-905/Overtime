// What's happening now, from the server's live feed (/events): the first message
// after connecting has everything, and each one after only what changed, put
// back together by @shared/live.js, the same merger the office uses. Unchanged
// parts keep their identity, so a card that reads only its
// part redraws only when that part changes. The demo (?demo) makes up snapshots
// of the same shape instead.
//
// The provider filter lives here too, since most of what's scoped by it comes
// from here: the analytics, agents and open sessions for the provider in view.

import { create } from 'zustand';
import { createMerger } from '@shared/live.js';
import { env } from '@/lib/env';
import { changed } from '@/lib/bus';
import { readProvider, saveProvider, type Provider } from '@/lib/prefs';
import { demo, post } from './api';
import type { Agent, AnalyticsView, OpenSessions, Snapshot } from './types';

type LiveState = {
  snap: Snapshot | null;
  /** Whether the live feed is connected; false while it's trying again. */
  connected: boolean;
  provider: Provider;
  setProvider: (p: Provider) => void;
};

export const useLive = create<LiveState>((set, get) => ({
  snap: null,
  connected: true,
  provider: readProvider(),
  setProvider: (p) => {
    if (p === get().provider) return;
    saveProvider(p);
    set({ provider: p });
  },
}));

let lastPrefs = '';

function apply(snap: Snapshot) {
  env.timeOffset = Date.now() - snap.now;
  // Settings the server works with, like the hour your working day starts.
  const prefs = JSON.stringify(snap.prefs || null);
  if (snap.prefs) env.workdayHour = snap.prefs.workdayHour ?? 4;
  useLive.setState({ snap });
  if (prefs !== lastPrefs) {
    lastPrefs = prefs;
    changed('prefs');
  }
}

/**
 * Change a setting the server works with (the hour your day starts, search inside
 * conversations), and show it at once rather than with the next snapshot.
 * Throws when the server can't be reached, so the caller can say so.
 */
export async function setServerPrefs(patch: Partial<NonNullable<Snapshot['prefs']>>) {
  let prefs = { ...(useLive.getState().snap?.prefs || { workdayHour: 4, search: true }), ...patch };
  if (!demo) prefs = await post<NonNullable<Snapshot['prefs']>>('/api/prefs', patch);
  const snap = useLive.getState().snap;
  if (snap) apply({ ...snap, prefs });
}

let started = false;

/** Start following the server (or the demo). Once. */
export function connectLive() {
  if (started) return;
  started = true;
  if (demo) {
    import('@shared/demo.js').then((m) => m.startDemo(apply));
    return;
  }
  const merge = createMerger();
  const source = new EventSource('/events');
  source.onopen = () => useLive.setState({ connected: true });
  source.onerror = () => useLive.setState({ connected: false });
  source.onmessage = (e) => {
    try {
      apply(merge(JSON.parse(e.data)) as Snapshot);
    } catch (error) {
      console.error(error);
    }
  };
}

// Another tab changed the provider filter.
window.addEventListener('storage', (e) => {
  if (e.key === 'overtime-provider') useLive.setState({ provider: readProvider() });
});

// ── For the provider in view ──────────────────────────────────────────────────

export type Scope = {
  provider: Provider;
  /** Every live agent, whatever the filter. */
  allAgents: Agent[];
  agents: Agent[];
  insights: AnalyticsView['insights'];
  spend: AnalyticsView['spend'];
  today: AnalyticsView['today'];
  openSessions: OpenSessions | null;
};

const scopeCache = new WeakMap<Snapshot, Map<Provider, Scope>>();

/** The analytics, agents and open sessions for the provider in view, worked out once per snapshot. */
export function scopeOf(snap: Snapshot | null, provider: Provider): Scope | null {
  if (!snap) return null;
  let byProvider = scopeCache.get(snap);
  if (!byProvider) scopeCache.set(snap, (byProvider = new Map()));
  let scope = byProvider.get(provider);
  if (!scope) {
    const mine = (x: { source: string }) => provider === 'all' || x.source === provider;
    const view = snap.analytics?.[provider];
    const open = snap.openSessions;
    scope = {
      provider,
      allAgents: snap.agents,
      agents: snap.agents.filter(mine),
      insights: view?.insights || null,
      spend: view?.spend || null,
      today: view?.today || null,
      openSessions: open ? { ...open, sessions: open.sessions.filter(mine), sharedRuntimes: (open.sharedRuntimes || []).filter(mine) } : null,
    };
    byProvider.set(provider, scope);
  }
  return scope;
}

/** An agent is working while it's thinking, using a tool or replying. */
export const WORKING = ['thinking', 'working', 'replying'];

/** The main agents that need you, whatever the filter: for the title, the badges and the Dock. */
export const needsCount = (snap: Snapshot | null) => (snap?.agents || []).filter((a) => a.kind === 'main' && a.needsYou).length;
