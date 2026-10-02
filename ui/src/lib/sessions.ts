// The last 30 days of sessions, as /api/sessions sends them: each session's
// numbers kept per day, so any range adds up exactly.

export const TOTAL_KEYS = ['cost', 'subCost', 'tokens', 'messages', 'agentMs', 'waitMs', 'waits', 'added', 'removed', 'tools', 'failed'] as const;
export type TotalKey = (typeof TOTAL_KEYS)[number];
export type Totals = Record<TotalKey, number> & { partial: boolean };

export type SessionDay = Partial<Record<TotalKey, number>> & { day: number; partial?: boolean };

export type Session = {
  id: string;
  source: 'claude' | 'codex';
  title: string | null;
  project: string | null;
  model: string | null;
  models?: { name: string; cost: number; tokens?: number }[];
  startedAt: number;
  lastAt: number;
  subagents?: number;
  context?: { used: number; window: number; pct: number; at: number } | null;
  days: SessionDay[];
};

export type SessionInRange = Session & Totals & { lastDay: number };

/** A session's numbers over the days from `from` up to `to`. */
export function totalsFrom(s: Session, from: number, to = Infinity): Totals {
  const t = { ...Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])), partial: false } as unknown as Totals;
  for (const d of s.days) {
    if (d.day < from || d.day >= to) continue;
    for (const k of TOTAL_KEYS) t[k] += d[k] || 0;
    t.partial ||= !!d.partial;
  }
  return t;
}

/** Sessions for a provider that ran between two days, with their numbers for just those days. */
export function sessionsIn(list: Session[] | null | undefined, provider: string, from: number, to = Infinity): SessionInRange[] {
  return (list || [])
    .filter((s) => (provider === 'all' || s.source === provider) && s.days.some((d) => d.day >= from && d.day < to))
    .map((s) => ({
      ...s,
      ...totalsFrom(s, from, to),
      // The last day it ran in range, which a list by day files it under.
      lastDay: Math.max(...s.days.filter((d) => d.day >= from && d.day < to).map((d) => d.day)),
    }));
}
