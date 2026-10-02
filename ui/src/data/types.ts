// The shapes the server sends (see server.js's snapshot()). Only what the pages
// read is spelled out; the rest passes through untyped until a card needs it.

export type Source = 'claude' | 'codex';

export type Agent = {
  id: string;
  nativeId: string;
  kind: 'main' | 'sub';
  source: Source;
  parentId: string | null;
  nick: string;
  title: string;
  project: string | null;
  cwd: string | null;
  branch: string | null;
  model: string | null;
  entrypoint: string | null;
  background: boolean;
  status: string;
  needsYou: string | null;
  tool: { name: string; detail?: string; startedAt?: number } | null;
  turnStartedAt: number | null;
  endedAt: number | null;
  lastActivity: number;
  snippet: string | null;
  cost: number;
  context: { used: number; window: number; pct: number } | null;
  [key: string]: unknown;
};

export type Spend = { cost: number; tokens: number; unpricedTokens?: number; partial?: boolean; costKnown?: boolean };

export type AnalyticsView = {
  insights: Record<string, unknown> | null;
  spend: { today: Spend; yesterday: Spend; yesterdayByNow: Spend; last7: Spend; last30: Spend; month: Spend & { from: number } } | null;
  today: { tokens: number; cost: number; costPartial?: boolean; tools: number; added: number; removed: number; sessions: number; sessionList?: unknown[] } | null;
};

export type OpenSessions = { sampledAt: number; everyMs: number; sessions: ({ source: Source } & Record<string, unknown>)[]; sharedRuntimes?: ({ source: Source } & Record<string, unknown>)[] };

export type Snapshot = {
  now: number;
  watching: string[];
  openSessions: OpenSessions | null;
  limits: Record<string, unknown> | null;
  analytics: { all: AnalyticsView; claude: AnalyticsView; codex: AnalyticsView } | null;
  codexLimits: Record<string, unknown> | null;
  prefs: { workdayHour: number; search: boolean } | null;
  agents: Agent[];
  feed: unknown[];
};
