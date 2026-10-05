// The last 30 days of sessions, as /api/sessions sends them: each session's
// numbers kept per day, so any range adds up exactly.

import type { SessionDay as ApiSessionDay, SessionListItem } from '@/data/types';

export const TOTAL_KEYS = [
  'cost',
  'subCost',
  'tokens',
  'messages',
  'agentMs',
  'waitMs',
  'waits',
  'added',
  'removed',
  'tools',
  'failed',
] as const satisfies readonly (keyof ApiSessionDay)[];
export type TotalKey = (typeof TOTAL_KEYS)[number];
export type Totals = Record<TotalKey, number> & { partial: boolean };

/** One day of a session (SessionDay in data/types.ts), of which tests build only some numbers. */
export type SessionDay = Pick<ApiSessionDay, 'day'> &
  Partial<Omit<ApiSessionDay, 'day' | 'partial'>> & { partial?: boolean };

/** A session as /api/sessions sends it (SessionListItem in data/types.ts), of which tests build only these parts. */
export type Session = Pick<SessionListItem, 'id' | 'source' | 'startedAt' | 'lastAt'> &
  Partial<Pick<SessionListItem, 'models' | 'subagents' | 'context'>> & {
    title: string | null;
    project: string | null;
    model: string | null;
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
export function sessionsIn(
  list: Session[] | null | undefined,
  provider: string,
  from: number,
  to = Infinity,
): SessionInRange[] {
  return (list || [])
    .filter((s) => (provider === 'all' || s.source === provider) && s.days.some((d) => d.day >= from && d.day < to))
    .map((s) => ({
      ...s,
      ...totalsFrom(s, from, to),
      // The last day it ran in range, which a list by day files it under.
      lastDay: Math.max(...s.days.filter((d) => d.day >= from && d.day < to).map((d) => d.day)),
    }));
}
