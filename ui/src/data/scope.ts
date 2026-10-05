// What the cards read: the live data for the provider in view, the plan windows
// worked out from the estimate and the exact checks, and your alert settings.
//
// Each hook picks out one part of the snapshot, and the server patches each part
// on its own (an insight, the spend, the agents one by one), so a card redraws
// when its part changes, not with every message.

import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLive } from './live';
import { useLimits } from './limits';
import { useChanged, useMinute } from './hooks';
import { serverNow } from '@/lib/env';
import { quotaItems, type LimitsInput, type QuotaItem } from '@/lib/limits';
import { readAlertPrefs } from '@/lib/alertPrefs';
import type { LiveAgent } from '@/lib/agents';
import type { Provider } from '@/lib/prefs';
import { sourcesIn, type Source } from '@/lib/sources';
import type { Agent, AnalyticsView, OpenSessions } from './types';

/** The provider in view: all of them, or one. */
export const useProvider = () => useLive((s) => s.provider);

/** One of the provider in view's insights, by its key (`trend`, `hours`, `topSessions`…). */
export function useInsight<T = unknown>(key: string): T | undefined {
  return useLive((s) => s.snap?.analytics?.[s.provider]?.insights?.[key]) as T | undefined;
}

/** Whether the provider in view's insights have come yet. */
export const useHasInsights = () => useLive((s) => !!s.snap?.analytics?.[s.provider]?.insights);

/** One insight for each of `sources`, whatever the filter: each provider's own trend, to split a chart by provider. */
export function useInsightOf<T = unknown>(sources: readonly string[], key: string): (T | undefined)[] {
  return useLive(
    useShallow((s) => sources.map((p) => s.snap?.analytics?.[p as Source]?.insights?.[key] as T | undefined)),
  );
}

/** What the provider in view spent: today, yesterday by now, the last 7 and 30 days, this month. */
export const useSpend = (): AnalyticsView['spend'] => useLive((s) => s.snap?.analytics?.[s.provider]?.spend ?? null);

/** Each of `sources`' spending, whatever the filter. */
export function useSpendOf(sources: readonly string[]): AnalyticsView['spend'][] {
  return useLive(useShallow((s) => sources.map((p) => s.snap?.analytics?.[p as Source]?.spend ?? null)));
}

/** Today for the provider in view: sessions, tool calls, lines changed, and each session's share. */
export const useToday = (): AnalyticsView['today'] => useLive((s) => s.snap?.analytics?.[s.provider]?.today ?? null);

/** The sources on this Mac, in order: each one a view of its own. */
export function useSources(): Source[] {
  const key = useLive((s) => sourcesIn(s.snap?.analytics).join(' '));
  return useMemo(() => key.split(' ') as Source[], [key]);
}

// ── The live agents ──────────────────────────────────────────────────────────

const NO_AGENTS: LiveAgent[] = [];
const lastFor = new Map<Provider, { from: Agent[]; list: LiveAgent[] }>();

/**
 * The agents of one provider, worked out once for each list of agents. While
 * that provider's agents are the same ones, unchanged, it's the same list as
 * before, so what reads it doesn't redraw when another provider's agent changes.
 */
function agentsIn(all: Agent[] | undefined, provider: Provider): LiveAgent[] {
  if (!all) return NO_AGENTS;
  if (provider === 'all') return all as unknown as LiveAgent[];
  const last = lastFor.get(provider);
  if (last?.from === all) return last.list;
  const list = all.filter((a) => a.source === provider) as unknown as LiveAgent[];
  const same = last && last.list.length === list.length && list.every((a, i) => a === last.list[i]);
  const kept = same ? last.list : list;
  lastFor.set(provider, { from: all, list: kept });
  return kept;
}

/** Every live agent, whatever the filter: the same list until one of them changes. */
export const useAllAgents = () => useLive((s) => agentsIn(s.snap?.agents, 'all'));

/** The live agents for the provider in view. */
export const useScopedAgents = () => useLive((s) => agentsIn(s.snap?.agents, s.provider));

/** Whether the live feed's first snapshot has come. */
export const useLoaded = () => useLive((s) => !!s.snap);

// ── The sessions open on this Mac ────────────────────────────────────────────

let openFor: { from: OpenSessions | null; provider: Provider; open: OpenSessions | null } | null = null;

/** The sessions open on this Mac for the provider in view, with their memory and CPU, or null before the first look. */
export const useOpenSessions = () =>
  useLive((s) => {
    const from = s.snap?.openSessions || null;
    if (openFor?.from === from && openFor.provider === s.provider) return openFor.open;
    const mine = (x: { source: string }) => s.provider === 'all' || x.source === s.provider;
    const open = from
      ? { ...from, sessions: from.sessions.filter(mine), sharedRuntimes: (from.sharedRuntimes || []).filter(mine) }
      : null;
    openFor = { from, provider: s.provider, open };
    return open;
  });

// ── The plan windows ─────────────────────────────────────────────────────────

/**
 * What the plan windows are worked out from, as of now: again each minute (what
 * they say moves by the minute), when a reading changes, and at the moment a
 * window resets, so that shows at once.
 */
export function useLimitsInput(): LimitsInput {
  const minute = useMinute();
  const [reset, setReset] = useState(0);
  const limits = useLive((s) => s.snap?.limits || null);
  const codexRecorded = useLive((s) => s.snap?.codexLimits || null);
  const exactOn = useLimits((s) => s.exactOn);
  const exact = useLimits((s) => s.exact);
  const codexExactOn = useLimits((s) => s.codexExactOn);
  const codexExact = useLimits((s) => s.codexExact);
  const input = useMemo(
    () => ({
      now: serverNow(),
      limits: limits as LimitsInput['limits'],
      exactOn,
      exact: exact as LimitsInput['exact'],
      codexRecorded: codexRecorded as LimitsInput['codexRecorded'],
      codexExactOn,
      codexExact: codexExact as LimitsInput['codexExact'],
    }),
    [minute, reset, limits, exactOn, exact, codexRecorded, codexExactOn, codexExact], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // A window that resets before the minute is up.
  useEffect(() => {
    const next = Math.min(
      ...quotaItems(input, 'all').map((w) => (w.resetsAt && w.resetsAt > input.now ? w.resetsAt : Infinity)),
    );
    if (next - input.now > 60_000) return;
    const t = setTimeout(() => setReset((n) => n + 1), next - input.now + 100);
    return () => clearTimeout(t);
  }, [input]);
  return input;
}

/** The plan windows for a provider, or for the provider in view. */
export function useQuota(provider?: string): { items: QuotaItem[]; input: LimitsInput } {
  const input = useLimitsInput();
  const inView = useProvider();
  const p = provider ?? inView;
  return useMemo(() => ({ items: quotaItems(input, p), input }), [input, p]);
}

/** Your alert settings, read again when they change. */
export function useAlertPrefs() {
  const v = useChanged();
  return useMemo(() => readAlertPrefs(), [v]);
}

export { serverNow };
