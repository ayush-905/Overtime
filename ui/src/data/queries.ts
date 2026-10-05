// Data that isn't in the live feed, fetched while a page shows it and cached:
// the last 30 days of sessions (at most every 30 seconds), the days on record
// (every 5 minutes), one session's history, one message's detail, a search
// inside conversations, and the weekly digest. The demo makes them up instead.

import { QueryClient, useQuery } from '@tanstack/react-query';
import { getJson, demo } from './api';
import type {
  HistoryDay,
  HistoryResponse,
  ResumeOptions,
  SearchResponse,
  SessionListItem,
  SessionResponse,
  SessionsResponse,
  TurnDetail,
  WeeklyDigest,
} from './types';

export type { SearchResult } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Nobody can see a background tab, so it doesn't fetch until you come back.
      refetchIntervalInBackground: false,
    },
  },
});

const demoData = () => import('@shared/demo.js');

/**
 * Every session of the last 30 days. Null until the first list arrives. Only
 * fetched while something shows it (`enabled`): a closed dialog doesn't poll.
 */
export function useSessions({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: ['sessions'],
    queryFn: async (): Promise<SessionListItem[]> => {
      if (demo) return (await demoData()).demoSessions(Date.now()) as SessionListItem[];
      const body = await getJson<SessionsResponse>('/api/sessions');
      // Before its first scan the server has nothing yet; ask again shortly.
      if (!body.sessions) throw new Error('Not ready yet');
      return body.sessions;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 4,
    retryDelay: 3000,
  });
}

/** Every day on record for a provider view, for the activity heatmap (and the reset dialog, while it's open). */
export function useHistory(scope: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['history', scope],
    queryFn: async (): Promise<{ days: HistoryDay[] }> =>
      demo
        ? { days: (await demoData()).demoHistory(Date.now()) as HistoryDay[] }
        : getJson<HistoryResponse>(`/api/history?scope=${scope}`),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Where an inbox row opens its session: its Claude or Codex app link, if it has one. */
export function useSessionTarget(id: string) {
  return useQuery({
    queryKey: ['session-target', id],
    queryFn: () => getJson<ResumeOptions>(`/api/session-target?id=${encodeURIComponent(id)}`),
    enabled: !demo,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
}

/** One session in full, for its panel and for Compare. Only fetched while something shows it (`enabled`). */
export function useSessionDetail(id: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => getJson<SessionResponse>(`/api/session?id=${encodeURIComponent(id!)}`),
    enabled: enabled && !!id && !demo,
    staleTime: 10_000,
  });
}

/** One message of a session and what it led to. */
export function useTurn(id: string | null, at: number | null) {
  return useQuery({
    queryKey: ['turn', id, at],
    queryFn: () => getJson<TurnDetail>(`/api/turn?id=${encodeURIComponent(id!)}&t=${at}`),
    enabled: !!id && at != null && !demo,
    staleTime: 60_000,
  });
}

/** Sessions whose conversations have every word of `q`. Off (null) while search is off, or for fewer than two letters. */
export function useSearch(
  q: string,
  { on = true, scope = 'all', limit = 40 }: { on?: boolean; scope?: string; limit?: number } = {},
) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', scope, limit, query.toLowerCase()],
    queryFn: () =>
      getJson<SearchResponse>(`/api/search?${new URLSearchParams({ q: query, scope, limit: String(limit) })}`),
    enabled: on && !demo && query.length >= 2,
    staleTime: 10_000,
  });
}

/** The weekly digest: this week so far (0) or last week (1). */
export function useDigest(weeksAgo: number, enabled = true) {
  return useQuery({
    queryKey: ['digest', weeksAgo],
    queryFn: async (): Promise<WeeklyDigest> =>
      demo
        ? ((await demoData()).demoDigest(Date.now(), weeksAgo) as WeeklyDigest)
        : getJson<WeeklyDigest>(`/api/digest?week=${weeksAgo ? 1 : 0}`),
    enabled,
    staleTime: 60_000,
  });
}
