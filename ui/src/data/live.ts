// What's happening now, from the server's live feed (/events): the first message
// after connecting has everything, and each one after only what changed, put
// back together by @shared/live.js, the same merger the office uses. Unchanged
// parts keep their identity (a message that changes nothing gives back the same
// snapshot), so a card that reads only its part redraws only when that part
// changes (see scope.ts for the hooks that pick them out). The demo (?demo) makes
// up snapshots of the same shape instead.
//
// The provider filter lives here too, since most of what's scoped by it comes
// from here: the analytics, agents and open sessions for the provider in view.

import { create } from 'zustand';
import { createMerger } from '@shared/live.js';
import { env } from '@/lib/env';
import { changed } from '@/lib/bus';
import { PROVIDER_KEY, readProvider, saveProvider, type Provider } from '@/lib/prefs';
import { onOtherTab } from '@/lib/storage';
import { demo, post } from './api';
import type { Prefs, Snapshot } from './types';

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
  // A provider with no folder on this Mac (any more) has nothing to show: show them all, without forgetting the choice.
  const { provider } = useLive.getState();
  useLive.setState(
    snap.analytics && provider !== 'all' && !snap.analytics[provider] ? { snap, provider: 'all' } : { snap },
  );
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
export async function setServerPrefs(patch: Partial<Prefs>) {
  let prefs: Prefs = { ...(useLive.getState().snap?.prefs || { workdayHour: 4, search: true }), ...patch };
  if (!demo) prefs = await post<Prefs>('/api/prefs', patch);
  const snap = useLive.getState().snap;
  if (snap) apply({ ...snap, prefs });
}

let started = false;

/** Start following the server (or the demo). Once. */
export function connectLive() {
  if (started) return;
  started = true;
  if (demo) {
    // Its working days start when yours do, as the cards count them.
    import('@shared/demo.js').then((m) => m.startDemo(apply, { workdayHour: () => env.workdayHour }));
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
onOtherTab((key) => {
  if (key === PROVIDER_KEY) useLive.setState({ provider: readProvider() });
});

/** An agent is working while it's thinking, using a tool or replying. */
export const WORKING = ['thinking', 'working', 'replying'];

/** The main agents that need you, whatever the filter: for the title, the badges and the Dock. */
export const needsCount = (snap: Snapshot | null) =>
  (snap?.agents || []).filter((a) => a.kind === 'main' && a.needsYou).length;
