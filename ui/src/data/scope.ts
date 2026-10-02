// What the cards read: the live data for the provider in view, the plan windows
// worked out from the estimate and the exact checks, and your alert settings.

import { useMemo } from 'react';
import { useLive, scopeOf } from './live';
import { useLimits } from './limits';
import { useChanged, useNow } from './hooks';
import { env, serverNow } from '@/lib/env';
import { quotaItems, type LimitsInput, type QuotaItem } from '@/lib/limits';
import { readAlertPrefs } from '@/lib/alertPrefs';
import type { LiveAgent } from '@/lib/agents';

/** The analytics, agents and open sessions for the provider in view. */
export function useScope() {
  const snap = useLive((s) => s.snap);
  const provider = useLive((s) => s.provider);
  return { snap, provider, scope: scopeOf(snap, provider) };
}

/** Every live agent, and the ones in view, as the agent helpers read them. */
export function useAgents() {
  const { scope } = useScope();
  return {
    all: (scope?.allAgents || []) as unknown as LiveAgent[],
    agents: (scope?.agents || []) as unknown as LiveAgent[],
  };
}

/** What the plan windows are worked out from, as of now (a new value each second). */
export function useLimitsInput(): LimitsInput {
  const now = useNow();
  const limits = useLive((s) => s.snap?.limits || null);
  const codexRecorded = useLive((s) => s.snap?.codexLimits || null);
  const exactOn = useLimits((s) => s.exactOn);
  const exact = useLimits((s) => s.exact);
  const codexExactOn = useLimits((s) => s.codexExactOn);
  const codexExact = useLimits((s) => s.codexExact);
  return useMemo(
    () => ({ now: now - env.timeOffset, limits: limits as LimitsInput['limits'], exactOn, exact: exact as LimitsInput['exact'], codexRecorded: codexRecorded as LimitsInput['codexRecorded'], codexExactOn, codexExact: codexExact as LimitsInput['codexExact'] }),
    [now, limits, exactOn, exact, codexRecorded, codexExactOn, codexExact],
  );
}

/** The plan windows for a provider, or for the provider in view. */
export function useQuota(provider?: string): { items: QuotaItem[]; input: LimitsInput } {
  const input = useLimitsInput();
  const inView = useLive((s) => s.provider);
  const p = provider ?? inView;
  return useMemo(() => ({ items: quotaItems(input, p), input }), [input, p]);
}

/** Your alert settings, read again when they change. */
export function useAlertPrefs() {
  const v = useChanged();
  return useMemo(() => readAlertPrefs(), [v]);
}

export { serverNow };
