// Every shape Overtime's server sends, in one place: the live snapshot that
// /events streams, the insights in it, and what each GET route answers. The
// dashboard imports these (ui/src/data/types.ts re-exports them), and the
// server's producers say they return them with JSDoc, so `npm run check:server`
// fails when what a function returns stops matching (tsconfig.server.json).
// What server.js adds itself (each response's wrapper, an agent's resumeCommand
// and internCost, an exact window's spend) and lib/resume.js aren't checked yet.
//
// Types only: nothing here exists at run time, and the server and the Mac app
// never load it.
//
// Units: times are epoch ms (`EpochMs`), lengths of time ms (`Ms`), money US
// dollars at API list prices (`Usd`), and sizes tokens (`Tokens`). A field that
// can be null says so; one marked `?` is sometimes left out of the JSON.

// ── Units and small pieces ─────────────────────────────────────────────────

/** A moment, in milliseconds since the Unix epoch. */
export type EpochMs = number;
/** A length of time, in milliseconds. */
export type Ms = number;
/** Money in US dollars, at the provider's API list prices. */
export type Usd = number;
/** A number of tokens. */
export type Tokens = number;
/** A stretch of time: [start, end], both epoch ms. */
export type Span = [start: EpochMs, end: EpochMs];

/** A harness Overtime reads, by its id (lib/harnesses). */
export type Source = 'claude' | 'codex' | 'pi';
/** A provider view the analytics are worked out for: every source together, or one. */
export type ScopeName = 'all' | Source;

/** How full a conversation is: its last reply's context against its model's window. */
export type Context = { used: Tokens; window: Tokens; pct: number };
/** How full a conversation was at its last reply (`at`), from the history. */
export type RecordedContext = Context & { at: EpochMs };

/** A name with what it cost (topList): the top few, then the rest summed up as one `other` row. */
export type CostItem = { name: string; cost: Usd; tokens: Tokens; other?: true };
/** A label and how many fall under it, for a distribution's buckets. */
export type Bucket = { label: string; count: number };
/** Spend in fixed steps: `costs[i]` is what the step starting at `from + i * step` cost (USD). */
export type SpendSeries = { from: EpochMs; step: Ms; costs: Usd[] };

// ── The live snapshot (/events) ────────────────────────────────────────────

/** What a live agent is doing. */
export type AgentStatus = 'thinking' | 'working' | 'replying' | 'waiting' | 'done' | 'idle';
/** Why an agent needs you: its turn is over, it asks a question, it has a plan, or a tool call waits for your approval. */
export type NeedsYou = 'turn' | 'question' | 'plan' | 'approval';
/** A tool's category, which picks where in the office the work happens (lib/agents.js CATEGORIES). */
export type ToolCategory =
  | 'edit'
  | 'read'
  | 'search'
  | 'bash'
  | 'web'
  | 'plan'
  | 'delegate'
  | 'ask'
  | 'handback'
  | 'other';
/** Where in the pixel office an agent is. */
export type OfficeZone = 'desk' | 'books' | 'servers' | 'web' | 'board' | 'meeting' | 'files' | 'lounge';
/** What an agent mostly did in a slot of its activity timeline. */
export type TimelineState = 'think' | 'wait' | 'edit' | 'read' | 'bash' | 'web' | 'plan' | 'delegate' | 'other';

/** The tool call an agent is waiting on now. */
export type AgentTool = {
  name: string;
  category: ToolCategory;
  icon: string;
  verb: string;
  detail: string;
  startedAt: EpochMs;
};
/** The last tool call an agent started. */
export type AgentLastTool = { name: string; icon: string; verb: string; detail: string };
/** A file an agent changed this session: edits that went through and lines added and removed. */
export type AgentFile = { path: string; name: string; edits: number; added: number; removed: number };
/** One line of an agent's recent activity. */
export type AgentEvent = { t: EpochMs; icon: string; text: string };

/** One agent as the office and the dashboard see it (lib/agents.js view()). */
export type AgentView = {
  id: string;
  /** Its id in its own transcripts, without Overtime's prefix. */
  nativeId: string;
  kind: 'main' | 'sub';
  source: Source;
  /** The session that started it, for a subagent. */
  parentId: string | null;
  /** A first name it goes by in the office. */
  nick: string;
  /** A number from its id, for its look in the office. */
  seed: number;
  title: string;
  project: string | null;
  /** The folder it was started in, wherever it has cd'd to since. */
  cwd: string | null;
  branch: string | null;
  model: string | null;
  /** The model as people say it ("Opus 5.5"). */
  modelName: string | null;
  /** What it was started from (cli, claude-desktop, codex, pi…). */
  entrypoint: string | null;
  /** Started by a script (an SDK entrypoint), not a person. */
  background: boolean;
  agentType: string | null;
  status: AgentStatus;
  zone: OfficeZone;
  needsYou: NeedsYou | null;
  tool: AgentTool | null;
  lastTool: AgentLastTool | null;
  turnStartedAt: EpochMs | null;
  /** When its last turn ended; 0 before the first did. */
  endedAt: EpochMs;
  endReason: 'done' | 'interrupted' | null;
  /** Its first activity; 0 before any. */
  startedAt: EpochMs;
  lastActivity: EpochMs;
  /** The start of its last reply. */
  snippet: string | null;
  /** Tool calls so far, by category. */
  counts: Partial<Record<ToolCategory, number>>;
  turns: number;
  tokens: { input: Tokens; output: Tokens; cacheRead: Tokens; cacheWrite: Tokens; total: Tokens };
  /** USD so far; null for a harness that doesn't report costs live (Codex) before any is known. */
  cost: Usd | null;
  /** False when some of its usage has no known price. */
  costKnown: boolean;
  context: Context | null;
  compactions: number;
  /** Epoch ms of its last compaction; 0 if none. */
  lastCompactAt: EpochMs;
  errors: number;
  /** Epoch ms of its last failed tool call; 0 if none. */
  lastErrorAt: EpochMs;
  /** The last few tool calls that finished: [when, 1 if it worked else 0, tool]. */
  results: [t: EpochMs, ok: 0 | 1, tool: string][];
  /** Files it changed, most recent first (up to 8). */
  files: AgentFile[];
  lines: { added: number; removed: number };
  /** The last hour in 30 slots, each what it mostly did then (null for nothing). */
  timeline: (TimelineState | null)[];
  recent: AgentEvent[];
  /** Whether it's in the office now (recently active). */
  present: boolean;
};

/** An agent in the snapshot: its view, with what its subagents cost and how to resume it. */
export type Agent = AgentView & {
  /** What its subagents cost so far, USD. */
  internCost: Usd;
  /** The command that resumes it, for a main session with a native id; else null. */
  resumeCommand: string | null;
};

/** One line of the office's activity feed. */
export type FeedItem = {
  id: number;
  t: EpochMs;
  agentId: string;
  who: string;
  seed: number;
  kind: 'main' | 'sub';
  icon: string;
  text: string;
};

/** How an open session is doing: needs you, working, idle, or no messages yet. */
export type OpenStatus = 'needs' | 'working' | 'idle' | 'new';
/** An agent process running on this Mac, with its memory and CPU and those of the tools it started. */
export type OpenProcess = {
  pid: number;
  source: Source;
  /** One process running many sessions (the Codex app's). */
  shared: boolean;
  /** The session it was matched to, if any. */
  id: string | null;
  title: string | null;
  project: string | null;
  openedAt: EpochMs;
  lastActive: EpochMs | null;
  status: OpenStatus;
  inOffice: boolean;
  /** Resident memory, bytes. */
  memBytes: number;
  /** Memory of the MCP servers and tools it started, bytes. */
  toolsMemBytes: number;
  /** How many MCP servers and tools it started. */
  tools: number;
  /** CPU as a share of one core (%), null until a second sample. */
  cpuPct: number | null;
  runtimeShared?: undefined;
};
/** A session running inside a shared process (a Codex app chat), which has no memory or CPU of its own. */
export type SharedRuntimeSession = {
  id: string;
  source: Source;
  title: string | null;
  project: string | null;
  status: Exclude<OpenStatus, 'new'>;
  openedAt: EpochMs | null;
  lastActive: EpochMs;
  memBytes: null;
  toolsMemBytes: null;
  cpuPct: null;
  runtimeShared: true;
};
/** A row of the open sessions: a process, or a chat inside a shared one. */
export type OpenSession = OpenProcess | SharedRuntimeSession;
/** The agent processes on this Mac (lib/open-sessions.js), sampled every `everyMs` while a page is open. */
export type OpenSessions = {
  sampledAt: EpochMs;
  everyMs: Ms;
  /** Needing you first, then working, idle, and new. */
  sessions: OpenSession[];
  /** Processes that run many sessions at once. */
  sharedRuntimes: OpenProcess[];
};

/** How a window's capacity was worked out: from the last few times you hit it. */
export type Calibration = { lastHitAt: EpochMs; samples: number };
/** The 5-hour session window, as the local estimate sees it. */
export type EstimateSession = {
  /** Whether a window is running now. */
  active: boolean;
  start: EpochMs | null;
  resetsAt: EpochMs | null;
  limited: boolean;
  /** USD used in it so far. */
  used: Usd;
  /** % used, null when there's nothing to compare with. */
  pct: number | null;
  /** USD a full window held, from recent limit hits. */
  capacity: Usd | null;
  calibration: Calibration | null;
};
/** The weekly window, as the local estimate sees it. */
export type EstimateWeekly = {
  resetsAt: EpochMs | null;
  /** No reset known, so it's the last 7 days. */
  rolling: boolean;
  limited: boolean;
  used: Usd;
  pct: number | null;
  capacity: Usd | null;
  calibration: Calibration | null;
};
/** Claude Code's plan limits estimated from local usage (lib/limits.js estimateLimits). */
export type LimitsEstimate = {
  source: 'estimate';
  session: EstimateSession;
  weekly: EstimateWeekly;
  /** USD spent in the last 30 minutes, 24 hours and 7 days, for projecting. */
  rates: { cost30m: Usd; cost24h: Usd; cost7d: Usd };
  /** Recent spend: 5-minute steps for the session window, hourly for the week. */
  usage: { fine: SpendSeries; hourly: SpendSeries };
  spend: SpendSummary | null;
  computedAt: EpochMs;
};

/** One of Codex's plan windows. */
export type CodexWindow = {
  provider: 'codex';
  accountId: string;
  bucketId: string;
  kind: 'primary' | 'secondary';
  /** `${accountId}:${bucketId}:${kind}`. */
  id: string;
  bucketName: string;
  durationMs: Ms | null;
  /** % used, 0 to 100. */
  usedPercent: number | null;
  resetsAt: EpochMs | null;
  plan: string | null;
  /** Its recent pace, on recorded readings only (null with too few). */
  pace?: CodexPace | null;
};
/** A Codex window's readings so far and its recent pace. */
export type CodexPace = {
  /** % of the limit per ms. */
  rate: number;
  basis: 'over the last hour' | 'over the last day';
  /** Readings: [when, % used]. */
  history: [t: EpochMs, usedPercent: number][];
  start: EpochMs;
};
/** Codex's plan windows (lib/codex-limits.js normalizeCodexLimits). */
export type CodexLimits = {
  provider: 'codex';
  accountId: string;
  status: 'ok' | 'unavailable';
  source: 'exact' | 'recorded';
  observedAt: EpochMs;
  windows: CodexWindow[];
  message: string | null;
};
/** Nothing to show for Codex, and why. */
export type CodexLimitsMissing = {
  provider: 'codex';
  status: 'unavailable' | 'error';
  windows: CodexWindow[];
  message: string;
};
/** What Codex recorded in its transcripts (recordedCodexLimits), or that it recorded nothing. */
export type RecordedCodexLimits = CodexLimits | (CodexLimitsMissing & { status: 'unavailable'; source: 'recorded' });

/** Settings the server works with. */
export type Prefs = {
  /** The hour (0 to 12) a working day starts. */
  workdayHour: number;
  /** Whether search keeps the conversations' text. */
  search: boolean;
};

/** One provider view's analytics. */
export type AnalyticsView = {
  /** Null until the history has been read. */
  insights: Insights | null;
  spend: SpendSummary | null;
  today: ActivitySummary | null;
};
/** Every provider view: all of them, and each source with a folder on this Mac. */
export type Analytics = { all: AnalyticsView } & Partial<Record<Source, AnalyticsView>>;

/** Everything a page needs, as /events sends it (server.js snapshot()); later messages patch it. */
export type Snapshot = {
  now: EpochMs;
  /** The transcript folders followed, with ~ for home. */
  watching: string[];
  /** Null before the first sample. */
  openSessions: OpenSessions | null;
  /** Null until the history has been read. */
  limits: LimitsEstimate | null;
  analytics: Analytics;
  codexLimits: RecordedCodexLimits;
  prefs: Prefs;
  /** The agents in the office now. */
  agents: Agent[];
  feed: FeedItem[];
};

// ── Spend and today ────────────────────────────────────────────────────────

/** Spend over a stretch of time (lib/limits.js). */
export type SpendTotals = {
  cost: Usd;
  tokens: Tokens;
  /** Tokens from models with no known price. */
  unpricedTokens: Tokens;
  partial: boolean;
  /** False when every token in it is unpriced. */
  costKnown: boolean;
};
/** Today, yesterday (all of it, and up to this time of day), the last 7 and 30 days, and this month (spendSummary). */
export type SpendSummary = {
  today: SpendTotals;
  yesterday: SpendTotals;
  yesterdayByNow: SpendTotals;
  last7: SpendTotals;
  last30: SpendTotals;
  month: SpendTotals & { from: EpochMs };
};

/** A session that did some work today. */
export type TodaySession = {
  id: string;
  source: Source;
  title: string;
  project: string;
  cost: Usd;
  tokens: Tokens;
  partial: boolean;
  context: RecordedContext | null;
};
/** Today's totals for one provider view (lib/insights.js activitySummary). */
export type ActivitySummary = {
  tokens: Tokens;
  cost: Usd;
  costPartial: boolean;
  /** Tool calls. */
  tools: number;
  added: number;
  removed: number;
  sessions: number;
  /** Priciest first. */
  sessionList: TodaySession[];
};

// ── Insights (lib/insights.js computeInsights) ─────────────────────────────

/** Where the money went over a stretch: by model, main agents against subagents, kind of token and project. */
export type Breakdown = {
  cost: Usd;
  tokens: Tokens;
  models: CostItem[];
  agents: CostItem[];
  types: TokenTypeCost[];
  projects: CostItem[];
};
/** What one kind of token cost. */
export type TokenTypeCost = {
  name: string;
  key: 'output' | 'cacheRead' | 'cacheWrite' | 'input' | 'search';
  cost: Usd;
  tokens: Tokens;
};

/** A day of the daily-cost trend, from its midnight. */
export type TrendDay = { start: EpochMs; cost: Usd; tokens: Tokens };
/** Average spend per weekday over up to four weeks (index 0 is Sunday). */
export type Weekdays = {
  /** Where the averages start: your first day of real use in the last 28. */
  since: EpochMs;
  today: { cost: Usd; tokens: Tokens };
  days: { cost: Usd; tokens: Tokens; total: Usd; count: number; activeDays: number }[];
};
/** The last 30 days, the hours of the day, the week as a grid, and the average weekday. */
export type Trend = {
  /** 30 days, oldest first. */
  days: TrendDay[];
  /** 24 hours of the day. */
  hours: { cost: Usd; tokens: Tokens }[];
  /** USD by weekday (Sunday first) and hour, to the cent. */
  grid: number[][];
  weekdays: Weekdays;
};

/** What prompt caching saved and cost. */
export type CacheStats = {
  cost: Usd;
  saved: Usd;
  read: Tokens;
  write: Tokens;
  fresh: Tokens;
  writeCost: Usd;
  rebuilds: number;
  rebuildCost: Usd;
  afterPause: number;
  afterPauseCost: Usd;
  /** Share of input read from the cache (0 to 1), null with no input. */
  hitRate: number | null;
};

/** How much each message carried in context over 7 days, what that cost, and the compactions. */
export type ContextHealth = {
  buckets: { max: Tokens | null; label: string; messages: number; cost: Usd }[];
  messages: number;
  cost: Usd;
  avgContext: Tokens | null;
  compactions: { count: number; auto: number; avgBefore: Tokens | null };
};

/** A session that paid for a very long conversation. */
export type LongContextSession = {
  id: string;
  source: Source;
  cost: Usd;
  surcharge: Usd;
  messages: number;
  peak: Tokens;
  title: string;
  project: string | null;
};
/** What very long conversations cost over 7 days: the exact surcharge and the estimated size cost. */
export type LongContext = {
  since: EpochMs;
  /** All spend in the stretch. */
  spend: Usd;
  /** Surcharge and size cost together. */
  cost: Usd;
  surcharge: { cost: Usd; requests: number };
  size: { cost: Usd; messages: number };
  /** Tokens past which a conversation counts as long. */
  from: Tokens;
  sessions: LongContextSession[];
  count: number;
};

/** Tool calls over 7 days: how many failed, which tools and why, and how many you denied. */
export type ToolFailures = {
  calls: number;
  failed: number;
  denied: number;
  /** Edits that failed because the file was unread or changed since. */
  staleEdits: number;
  today: { calls: number; failed: number; denied: number };
  byTool: { name: string; calls: number; failed: number; denied: number }[];
  reasons: { text: string; count: number }[];
};

/** One message you sent, with what it set off. */
export type MessageSummary = {
  text: string;
  t: EpochMs;
  /** USD, subagents included. */
  cost: Usd;
  partial: boolean;
  source: Source;
  /** How long the agent worked on it. */
  ms: Ms;
  project: string;
  session: string;
  inOffice: boolean;
};
/** The messages you sent over 7 days. */
export type MessageStats = {
  count: number;
  today: number;
  activeDays: number;
  interrupts: number;
  cost: Usd;
  partial: boolean;
  medianMs: Ms | null;
  buckets: Bucket[];
  priciest: MessageSummary | null;
  longest: MessageSummary | null;
  /** The three priciest. */
  top: MessageSummary[];
};

/** How long your turns took over 7 days, leaving out unfinished ones (lib/turn-performance.js). */
export type TurnPerformance = {
  count: number;
  pending: number;
  interrupted: number;
  /** Durations that end at the last reply rather than a recorded completion. */
  inferred: number;
  medianMs: Ms | null;
  p90Ms: Ms | null;
  maxMs: Ms | null;
  buckets: Bucket[];
};

/** Waiting for your reply on one day. */
export type WaitDay = { start: EpochMs; ms: Ms; replies: number };
/** One of the longest waits for your reply. */
export type LongWait = { session: string; source: Source; title: string; project: string; t: EpochMs; ms: Ms };
/** How long agents sat waiting for you over 7 days (waits over 30 minutes left out). */
export type WaitingStats = {
  ms: Ms;
  replies: number;
  medianMs: Ms | null;
  /** Replies after a wait long enough to count as you stepping away. */
  away: number;
  today: WaitDay;
  /** 7 days, oldest first. */
  days: WaitDay[];
  projects: { name: string; ms: Ms; replies: number }[];
  longest: LongWait[];
};

/** The most agents at once, and when (null before any). */
export type Peak = { count: number; main: number; sub: number; at: EpochMs | null };
/** How many agents worked at once over 7 days, and today hour by hour. */
export type ParallelWork = {
  peak: Peak;
  peakToday: Peak;
  /** Agent time added up across agents. */
  agentMs: Ms;
  /** Time at least one agent was working. */
  busyMs: Ms;
  agentMsToday: Ms;
  busyMsToday: Ms;
  /** 24 hours of today. */
  hours: { max: number; agentMs: Ms }[];
};

/** A working day you sent messages on (from the hour your day starts). */
export type YouWorkDay = {
  start: EpochMs;
  first: EpochMs;
  last: EpochMs;
  messages: number;
  /** Your active stretches. */
  stretches: Span[];
  activeMs: Ms;
  /** Still sending messages after midnight. */
  late: boolean;
};
/** A working day you sent nothing: only its start (the rest are left out). */
export type YouDayOff = {
  start: EpochMs;
  messages: 0;
  first?: undefined;
  last?: undefined;
  stretches?: undefined;
  activeMs?: undefined;
  late?: undefined;
};
/** A calendar day of your active time. */
export type YouDate = { start: EpochMs; activeMs: Ms; messages: number; first: EpochMs | null; last: EpochMs | null };
/** Your working hours over 14 working days, and active time over 30 calendar days. */
export type WorkingHours = {
  days: (YouWorkDay | YouDayOff)[];
  dates: YouDate[];
  /** Ms after the working day's start. */
  typicalStart: Ms | null;
  typicalStop: Ms | null;
  typicalLength: Ms | null;
  completedDays: number;
  lateNights: number;
  /** The working day of the last late night. */
  lastLate: EpochMs | null;
  daysOff: number;
  streak: number;
  longestStreak: number;
  /** Active time over the last 7 days. */
  week: Ms;
  prevWeek: Ms;
};

/** A day no agent worked: only its start and zeros (the rest are left out). */
export type AgentIdleDay = {
  start: EpochMs;
  wallMs: 0;
  agentMs: 0;
  first?: undefined;
  last?: undefined;
  peak?: undefined;
  sessions?: undefined;
  subagents?: undefined;
  unattendedMs?: undefined;
  stretches?: undefined;
  late?: undefined;
};
/** A day at least one agent worked. */
export type AgentWorkDay = {
  start: EpochMs;
  first: EpochMs;
  last: EpochMs;
  /** Time at least one agent was working. */
  wallMs: Ms;
  /** Agent time added up across agents. */
  agentMs: Ms;
  /** The most at once. */
  peak: number;
  sessions: number;
  subagents: number;
  /** Agent work while you weren't active. */
  unattendedMs: Ms;
};
/** A working day of agent work, with its stretches drawn. */
export type AgentCalendarDay = AgentWorkDay & { stretches: Span[]; late: boolean };
/** When your agents worked: 14 working days for the calendar, 30 calendar days for the bars. */
export type AgentHours = {
  days: (AgentCalendarDay | AgentIdleDay)[];
  dates: (AgentWorkDay | AgentIdleDay)[];
  typicalStart: Ms | null;
  typicalStop: Ms | null;
  week: Ms;
  prevWeek: Ms;
  weekAgentMs: Ms;
  prevWeekAgentMs: Ms;
  weekUnattendedMs: Ms;
  lateNights: number;
  lastLate: EpochMs | null;
  longest: { ms: Ms; from: EpochMs; to: EpochMs } | null;
};

/** A 5-hour session window. */
export type SessionWindow = { start: EpochMs; end: EpochMs; cost: Usd; hitAt: EpochMs | null };
/** When to send a first message to fit one more window into your day (times are ms after the day's start). */
export type WindowsAdvice = { start: Ms; stop: Ms; useful: number; by: Ms; lead: Ms; resets: Ms[] };
/** Claude Code's 5-hour windows of the last 7 days, and a plan (lib/insights/you.js sessionPlan). */
export type SessionPlan = {
  since: EpochMs;
  windows: SessionWindow[];
  perDay: number | null;
  today: number;
  hits: number;
  /** Time locked out after hitting a limit. */
  lockedMs: Ms;
  plan: WindowsAdvice | null;
};

/** One of today's priciest sessions. */
export type TopSession = {
  id: string;
  source: Source;
  title: string;
  project: string | null;
  cost: Usd;
  partial: boolean;
  subCost: Usd;
  tokens: Tokens;
  added: number;
  removed: number;
  linesPerDollar: number | null;
  inOffice: boolean;
  last: EpochMs;
  context: RecordedContext | null;
};

/** One session's lane in today's timeline. */
export type TimelineLane = {
  id: string;
  source: Source;
  title: string;
  project: string;
  work: Span[];
  /** Its subagents working. */
  sub: Span[];
  /** Done and waiting for your reply. */
  waits: Span[];
  /** When you sent a message. */
  messages: EpochMs[];
  cost: Usd;
  tokens: Tokens;
  partial: boolean;
  busyMs: Ms;
  first: EpochMs;
  last: EpochMs | null;
};
/** Today as lanes, one per session, with your active time and your usual day. */
export type TodayTimeline = {
  from: EpochMs;
  you: Span[];
  /** For each 15 minutes of the day, how often you were active then (0 to 1) over `days` days. */
  usual: { days: number; slots: number[] };
  lanes: TimelineLane[];
  /** The quieter sessions left out. */
  others: { sessions: number; busyMs: Ms; cost: Usd; tokens: Tokens };
};

/** Where a skill comes from. */
export type SkillKind = 'personal' | 'project' | 'plugin' | 'app' | 'builtin';
/** A skill that was on offer. */
export type OfferedSkill = {
  name: string;
  source: Source;
  kind: SkillKind;
  project?: string;
  plugin?: string;
  about: string;
};
/** A skill that was used, and how. */
export type UsedSkill = OfferedSkill & {
  uses: number;
  /** Times you ran it as a command. */
  you: number;
  /** Times the agent chose it. */
  agent: number;
  sessions: number;
  days: number;
  projects: string[];
  lastAt: EpochMs;
};
/** Skills over 30 days (lib/skills.js skillUsage). */
export type SkillUsage = {
  /** How many were on offer; null when no transcript listed them. */
  offered: number | null;
  usedCount: number;
  uses: number;
  used: UsedSkill[];
  unused: OfferedSkill[];
};

/** A prompt you keep typing, and the command to make of it. */
export type RepeatedPrompt = {
  key: string;
  /** Occasions an hour or more apart. */
  count: number;
  sessions: number;
  days: number;
  lastAt: EpochMs;
  firstAt: EpochMs;
  /** Its length in words, on average. */
  words: number;
  /** Every time worded the same. */
  exact: boolean;
  /** Occasions by harness. */
  sources: Partial<Record<Source, number>>;
  /** The harness it was typed to most. */
  source: Source;
  projects: string[];
  examples: string[];
  body: string;
  /** Whether the body has $ARGUMENTS. */
  argument: boolean;
  name: string;
  description: string;
  /** Whether a command of that name exists already, by harness. */
  exists: Partial<Record<Source, boolean>>;
};
/** Prompts you sent on two or more occasions in 30 days (lib/prompts.js repeatedPrompts). */
export type RepeatedPrompts = { prompts: number; groups: RepeatedPrompt[] };

/** One of the last 30 days, for the heatmap's history (lib/insights/you.js dailyTotals). */
export type DailyTotal = {
  day: EpochMs;
  cost: Usd;
  tokens: Tokens;
  partial: boolean;
  activeMs: Ms;
  agentMs: Ms;
  messages: number;
  sessions: number;
};

/** Everything computeInsights works out for one provider view. */
export type ComputedInsights = {
  breakdown: { d7: Breakdown; d30: Breakdown };
  trend: Trend;
  cache: { d7: CacheStats; today: CacheStats };
  context: ContextHealth;
  longContext: LongContext;
  tools: ToolFailures;
  messages: MessageStats;
  turnPerformance: TurnPerformance;
  waiting: WaitingStats;
  parallel: ParallelWork;
  hours: WorkingHours;
  agentHours: AgentHours;
  /** Claude Code's own view only; null for the others and for all of them together. */
  windows: SessionPlan | null;
  topSessions: TopSession[];
  timeline: TodayTimeline;
  skills: SkillUsage;
  repeats: RepeatedPrompts;
  /** The last 30 days, which the server keeps and serves at /api/history instead. */
  daily: DailyTotal[];
  computedAt: EpochMs;
};
/** The insights as the snapshot sends them: each key computeInsights returns but `daily`. */
export type Insights = Omit<ComputedInsights, 'daily'>;
/** The name of an insight. */
export type InsightKey = keyof Insights;

// ── The GET routes ─────────────────────────────────────────────────────────

/** One day of a session in the list. */
export type SessionDay = {
  day: EpochMs;
  /** USD, subagents included. */
  cost: Usd;
  subCost: Usd;
  tokens: Tokens;
  messages: number;
  agentMs: Ms;
  waitMs: Ms;
  waits: number;
  added: number;
  removed: number;
  tools: number;
  failed: number;
  partial?: true;
};
/** A session of the last 30 days, with its numbers kept per day (lib/insights/sessions.js sessionList). */
export type SessionListItem = {
  id: string;
  source: Source;
  title: string;
  project: string | null;
  /** The model it used most. */
  model: string | null;
  models: CostItem[];
  /** When it began, even before the last 30 days. */
  startedAt: EpochMs;
  lastAt: EpochMs;
  subagents: number;
  context: RecordedContext | null;
  days: SessionDay[];
};
/** /api/sessions: null `sessions` until the history has been read. */
export type SessionsResponse = { computedAt: EpochMs; sessions: SessionListItem[] | null };

/** One of your messages in a session's panel. */
export type SessionMessage = { t: EpochMs; text: string; cost: Usd; partial: boolean; ms: Ms };
/** One of a session's subagents. */
export type SessionSubagent = {
  title: string;
  cost: Usd;
  partial: boolean;
  firstAt: EpochMs | null;
  lastAt: EpochMs | null;
  calls: number;
};
/** One session in full (lib/insights/sessions.js sessionDetail). */
export type SessionDetail = {
  id: string;
  nativeId: string;
  source: Source;
  title: string | null;
  project: string;
  cwd: string | null;
  firstAt: EpochMs | null;
  lastAt: EpochMs | null;
  cost: Usd;
  partial: boolean;
  subCost: Usd;
  /** What prompt caching saved, USD. */
  saved: Usd;
  tokens: { fresh: Tokens; output: Tokens; cacheRead: Tokens; cacheWrite: Tokens; total: Tokens };
  models: CostItem[];
  lines: { added: number; removed: number };
  tools: { calls: number; failed: number; denied: number; top: [tool: string, calls: number][] };
  compactions: number;
  context: RecordedContext | null;
  /** How long the agent worked on your messages. */
  agentMs: Ms;
  /** How long it waited for you. */
  waitMs: Ms;
  messages: { count: number; interrupts: number; list: SessionMessage[] };
  subagents: { count: number; list: SessionSubagent[] };
  /** Cost over time, in steps that suit how long it ran. */
  timeline: SpendSeries | null;
};
/** The app that opens a session, and its link. */
export type ResumeApp = { name: string; url: string };
/** Where a session can be picked up again (lib/resume.js resumeOptions); also /api/session-target. */
export type ResumeOptions =
  | { terminal: false; app: null; command?: undefined; appMissing?: undefined }
  | {
      terminal: true;
      command: string;
      app: ResumeApp | null;
      /** The app that would open it, and why it can't. */
      appMissing?: { name: string; why: string };
    };
/** /api/session: one session in full, and where it can be resumed. */
export type SessionResponse = SessionDetail & { resume: ResumeOptions };

/** A file one message's work read or changed. */
export type TurnFile = { path: string; reads: number; edits: number; added: number; removed: number };
/** A tool call's state. */
export type CallStatus = 'pending' | 'ok' | 'error' | 'denied';
/** A command one message's work ran. */
export type TurnCommand = { t: EpochMs; text: string; status: CallStatus; reason: string | null; sub: boolean };
/** /api/turn: one of your messages and what it led to (lib/insights/sessions.js turnDetail). */
export type TurnDetail = {
  id: string;
  cwd: string | null;
  t: EpochMs;
  /** Your next message, where this one's work ends. */
  next: EpochMs | null;
  text: string;
  /** Whether `text` is the whole message (search keeps it), not its start. */
  whole: boolean;
  searchOn: boolean;
  /** The agent's replies: the first 4 and the last 20 of more. */
  replies: { t: EpochMs; text: string }[];
  moreReplies: number;
  files: TurnFile[];
  moreFiles: number;
  commands: TurnCommand[];
  moreCommands: number;
  tools: [tool: string, calls: number][];
  failed: number;
  denied: number;
  subagents: number;
  cost: Usd;
  partial: boolean;
  tokens: Tokens;
  ms: Ms;
};

/** A project in a week's digest. */
export type DigestProject = { name: string; cost: Usd; sessions: number; agentMs: Ms };
/** A session in a week's digest. */
export type DigestSession = {
  id: string;
  title: string;
  project: string | null;
  source: Source;
  cost: Usd;
  messages: number;
  agentMs: Ms;
};
/** A stretch's totals in the digest. */
export type DigestTotals = {
  cost: Usd;
  partial: boolean;
  sessions: number;
  messages: number;
  agentMs: Ms;
  waitMs: Ms;
  waits: number;
  added: number;
  removed: number;
  tools: number;
  failed: number;
  bySource: Record<Source, Usd>;
  /** Your active time. */
  activeMs: Ms;
  projects: DigestProject[];
  topSessions: DigestSession[];
  /** The priciest day: [its midnight, USD]. */
  busiest: [day: EpochMs, cost: Usd] | null;
};
/** /api/digest: a week in review, with the same days of the week before (lib/insights/sessions.js weeklyDigest). */
export type WeeklyDigest = DigestTotals & {
  from: EpochMs;
  to: EpochMs;
  /** 1 for last week, 0 for this one so far. */
  weeksAgo: number;
  days: number;
  before: DigestTotals;
  /** Limit windows hit, each once. */
  hits: { claude: number; codex: number };
  computedAt: EpochMs;
};

/** A day on record for the heatmap: from the transcripts, or `kept` in ~/.overtime/history.json. */
export type HistoryDay = DailyTotal & { kept?: true };
/** /api/history: every day on record for one provider view, oldest first (lib/store.js historyDays). */
export type HistoryResponse = { scope: ScopeName; days: HistoryDay[] };

/** How much text search holds. */
export type SearchStats = { on: boolean; messages: number; chars: number };
/** A message that matched a search. */
export type SearchHit = { t: EpochMs; who: 'you' | 'agent'; text: string };
/** A session with messages that matched, the latest first. */
export type SearchResult = {
  session: string;
  source: Source;
  title: string | null;
  project: string;
  count: number;
  lastAt: EpochMs;
  hits: SearchHit[];
};
/** /api/search: sessions whose conversations have every word of `q`. */
export type SearchResponse = {
  q: string;
  scope: ScopeName;
  on: boolean;
  ready: boolean;
  stats: SearchStats;
  terms: string[];
  results: SearchResult[];
  /** Matching messages. */
  total: number;
  /** Matching sessions; left out when there was nothing to search for. */
  sessions?: number;
};

/** /api/settings: the dashboard's saved settings, by name. */
export type SettingsResponse = { initialized: boolean; values: Record<string, string> };
/** /api/hello: who's answering on this port. */
export type HelloResponse = { app: 'overtime'; version: string; desktop: boolean };

/** A plan window from Anthropic: % used and when it resets. */
export type ExactWindow = { pct: number; resetsAt: EpochMs | null };
/** Another window Anthropic reports, like the weekly Opus one. */
export type ExactExtra = ExactWindow & { key: string; label: string };
/** Anthropic's numbers (lib/limits.js exactLimits); `stale` when they're the last ones it gave. */
export type ExactLimitsOk = {
  source: 'exact';
  status: 'ok';
  session: ExactWindow | null;
  weekly: ExactWindow | null;
  extras: ExactExtra[];
  fetchedAt: EpochMs;
  stale?: true;
};
/** Why there are no numbers from Anthropic. */
export type ExactLimitsProblem =
  | { source: 'exact'; status: 'cooling'; retryAt: EpochMs }
  | { source: 'exact'; status: 'no-login' | 'expired' | 'error'; message: string };
/** What exactLimits answers. */
export type ExactLimits = ExactLimitsOk | ExactLimitsProblem;
/** An exact window with what it has cost so far, from the local index (null before it's read). */
export type ExactWindowSpend = ExactWindow & { spend?: SpendTotals | null };
/** /api/limits/exact: Anthropic's numbers, each window with its spend so far. */
export type ExactLimitsResponse =
  | (Omit<ExactLimitsOk, 'session' | 'weekly'> & { session: ExactWindowSpend | null; weekly: ExactWindowSpend | null })
  | ExactLimitsProblem;
/** /api/limits/codex: Codex's live check through its app server (lib/codex-limits.js). */
export type ExactCodexLimits =
  | CodexLimits
  | (CodexLimitsMissing & { status: 'error' })
  | (CodexLimitsMissing & { status: 'unavailable'; accountType: string | null });

/** What each GET route answers (a 404 or 503 answers null). */
export type GetApi = {
  '/api/sessions': SessionsResponse;
  '/api/session': SessionResponse | null;
  '/api/session-target': ResumeOptions | null;
  '/api/turn': TurnDetail | null;
  '/api/digest': WeeklyDigest | null;
  '/api/history': HistoryResponse | null;
  '/api/search': SearchResponse;
  '/api/settings': SettingsResponse;
  '/api/hello': HelloResponse;
};

// ── What the actions answer ────────────────────────────────────────────────

/** /api/resume: the session opened in Terminal, or why not. */
export type ResumeResponse = { ok: true; command: string; file: string } | { ok: false; message: string };
/** /api/commands: the command file written, or why not (lib/prompts.js writeCommand). */
export type CommandResponse =
  | { ok: true; file: string; content: string; use: string }
  | { ok: false; status: number; message: string; file?: string };

/** What each action (a POST with the X-Overtime header) answers. */
export type PostApi = {
  '/api/prefs': Prefs;
  '/api/resume': ResumeResponse;
  '/api/commands': CommandResponse;
  '/api/limits/exact': ExactLimitsResponse;
  '/api/limits/codex': ExactCodexLimits;
};
