// Simulated agents for ?demo (/?demo and /office/?demo): the dashboard and the
// office show these instead of your transcripts, and the README's screenshot is
// taken from them. All of it is made up: Kettle, a recipe app with an API, a web
// app, a mobile app, a jobs worker and a docs site, worked on with Claude Code,
// Codex and Pi.
//
// It makes what the server sends, in the same shapes: the live snapshot
// (startDemo), the days on record (demoHistory), the sessions of the last 30 days
// (demoSessions) and the weekly digest (demoDigest). Each says which type in
// types/api.d.ts it makes, and `npm run check` checks them against it (the file
// is in tsconfig.server.json, and the dashboard's check reads it too), so a
// field the server adds, drops, renames or retypes breaks the build until the
// demo follows.
//
// The figures agree with each other: the past comes from one made-up plan of
// each day (dayPlan), the same for a date every time, and today from the agents
// running now, at API list prices.
// @ts-check
/** @import { ActivitySummary, Agent, AgentCalendarDay, AgentHours, AgentIdleDay, AgentTool } from '../../types/api.js' */
/** @import { AgentWorkDay, AnalyticsView, Breakdown, CacheStats, ContextHealth, CostItem } from '../../types/api.js' */
/** @import { DigestSession, DigestTotals, FeedItem, HistoryResponse, Insights, LimitsEstimate, LongContext } from '../../types/api.js' */
/** @import { MessageStats, MessageSummary, OfficeZone, OpenProcess, OpenSession, OpenSessions } from '../../types/api.js' */
/** @import { ParallelWork, RecordedCodexLimits, RepeatedPrompt, RepeatedPrompts, ScopeName } from '../../types/api.js' */
/** @import { SessionPlan, SessionsResponse, SkillUsage, Snapshot, Source, Span, SpendSeries } from '../../types/api.js' */
/** @import { SpendSummary, SpendTotals, TimelineLane, TimelineState, TodaySession, TodayTimeline } from '../../types/api.js' */
/** @import { TokenTypeCost, ToolCategory, ToolFailures, TopSession, Trend, TurnPerformance } from '../../types/api.js' */
/** @import { UsedSkill, OfferedSkill, WaitingStats, WeeklyDigest, WorkingHours, YouDate } from '../../types/api.js' */
/** @import { Context, YouDayOff, YouWorkDay } from '../../types/api.js' */

import { median, workDayStart } from './sums.js';

const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;

/** @type {Source[]} */
const SOURCES = ['claude', 'codex', 'pi'];

/** The sources a provider view covers. @param {ScopeName} scope @returns {Source[]} */
const sourcesOf = (scope) => (scope === 'all' ? SOURCES : [scope]);

// ── The cast ───────────────────────────────────────────────────────────────

/**
 * A session running when the demo starts: who, on what, with which model, how
 * long ago it started and what it has cost so far.
 * @typedef {{
 *   nick: string, title: string, project: string, branch: string, entrypoint: string,
 *   model: string, modelName: string, source: Source, startedH: number, cost: number,
 * }} Cast
 */

/** @type {Cast[]} */
const CAST = [
  {
    nick: 'Grace',
    title: 'Add full-text recipe search',
    project: 'kettle-api',
    branch: 'feat/recipe-search',
    entrypoint: 'claude-desktop',
    model: 'claude-opus-5-5',
    modelName: 'Opus 5.5',
    source: 'claude',
    startedH: 4.4,
    cost: 26.4,
  },
  {
    nick: 'Linus',
    title: 'Fix flaky image upload tests',
    project: 'kettle-api',
    branch: 'fix/upload-tests',
    entrypoint: 'claude-vscode',
    model: 'claude-sonnet-5',
    modelName: 'Sonnet 5',
    source: 'claude',
    startedH: 2.1,
    cost: 12.3,
  },
  {
    nick: 'Katherine',
    title: 'Build the weekly meal planner',
    project: 'kettle-web',
    branch: 'feat/meal-planner',
    entrypoint: 'cli',
    model: 'claude-opus-5-5',
    modelName: 'Opus 5.5',
    source: 'claude',
    startedH: 1.6,
    cost: 8.1,
  },
  {
    nick: 'Hedy',
    title: 'Move the web app to Vite',
    project: 'kettle-web',
    branch: 'chore/vite',
    entrypoint: 'claude-desktop',
    model: 'claude-opus-5-5',
    modelName: 'Opus 5.5',
    source: 'claude',
    startedH: 3.2,
    cost: 17.2,
  },
  {
    nick: 'Ken',
    title: 'Add retries to the email digest job',
    project: 'kettle-jobs',
    branch: 'feat/digest-retries',
    entrypoint: 'codex',
    model: 'gpt-6.1-sol',
    modelName: 'GPT-6.1 Sol',
    source: 'codex',
    startedH: 1.9,
    cost: 4.1,
  },
  {
    nick: 'Tim',
    title: 'Scheduled dependency audit',
    project: 'kettle-api',
    branch: 'main',
    entrypoint: 'sdk-cli',
    model: 'claude-haiku-4-5',
    modelName: 'Haiku 4.5',
    source: 'claude',
    startedH: 0.5,
    cost: 0.6,
  },
  {
    nick: 'Margaret',
    title: 'Write the API quickstart guide',
    project: 'kettle-docs',
    branch: 'docs/quickstart',
    entrypoint: 'pi',
    model: 'claude-sonnet-5-5',
    modelName: 'Sonnet 5.5',
    source: 'pi',
    startedH: 1.2,
    cost: 2.3,
  },
  {
    nick: 'Barbara',
    title: 'Add offline mode to the shopping list',
    project: 'kettle-mobile',
    branch: 'feat/offline-list',
    entrypoint: 'claude-vscode',
    model: 'claude-opus-5-5',
    modelName: 'Opus 5.5',
    source: 'claude',
    startedH: 2.7,
    cost: 11.4,
  },
  {
    nick: 'Dennis',
    title: 'Cache popular recipe pages',
    project: 'kettle-api',
    branch: 'perf/page-cache',
    entrypoint: 'cli',
    model: 'claude-sonnet-5',
    modelName: 'Sonnet 5',
    source: 'claude',
    startedH: 0.9,
    cost: 7.9,
  },
];
const INTERN_NAMES = ['Radia', 'Brendan', 'Frances', 'Guido', 'Joan', 'Niklaus'];

/**
 * What working on a project looks like: its files, what gets searched for, what
 * gets run (as Claude Code describes it, and the command itself), what
 * subagents are sent to do, the to-do items, the questions and the replies.
 * @typedef {{
 *   files: string[], patterns: string[], runs: [said: string, command: string][], tasks: string[],
 *   plans: string[], asks: string[], replies: string[],
 * }} Project
 */

/** @type {Record<string, Project>} */
const PROJECTS = {
  'kettle-api': {
    files: [
      'recipes.service.ts',
      'search.controller.ts',
      'uploads.ts',
      'schema.prisma',
      'recipes.test.ts',
      'cache.ts',
      'auth.middleware.ts',
    ],
    patterns: ['searchRecipes', 'TODO', 'uploadImage', 'cacheKey', 'findMany'],
    runs: [
      ['Run unit tests', 'npm test'],
      ['Run the database migration', 'npx prisma migrate dev'],
      ['Check git status', 'git status'],
      ['Lint the project', 'npm run lint'],
      ['Start the test database', 'docker compose up -d db'],
    ],
    tasks: ['Map the API routes', 'Find every search caller', 'Review test coverage', 'Check the upload edge cases'],
    plans: ['Mapping the search flow', 'Writing the migration', 'Updating the tests', 'Checking edge cases'],
    asks: ['Should search match ingredients as well as titles?', 'Keep cached pages for an hour or a day?'],
    replies: [
      'Search ranks titles first, then ingredients, and exact matches still come out on top.',
      'All tests pass now. The flaky one shared a temp folder with another suite.',
      'Popular recipe pages are cached for an hour and cleared when a recipe changes.',
    ],
  },
  'kettle-web': {
    files: ['MealPlanner.tsx', 'RecipeCard.tsx', 'vite.config.ts', 'useRecipes.ts', 'App.tsx', 'WeekView.tsx'],
    patterns: ['useEffect', 'process.env', 'webpack', 'mealPlan'],
    runs: [
      ['Build the app', 'npm run build'],
      ['Run component tests', 'npm test'],
      ['Install dependencies', 'npm install'],
      ['Check types', 'npx tsc --noEmit'],
    ],
    tasks: ['Find every webpack-only import', 'List the env variables in use', 'Review the planner components'],
    plans: ['Moving the config over', 'Building the week view', 'Updating the tests'],
    asks: ['Keep the old webpack config around for a week?', 'Should the planner start on Monday or Sunday?'],
    replies: [
      'The build is on Vite now; the dev server starts in under 2 seconds instead of 14.',
      'The planner saves each week as a draft until you publish it.',
    ],
  },
  'kettle-mobile': {
    files: ['ShoppingList.tsx', 'offline-store.ts', 'sync.ts', 'useNetwork.ts', 'ShoppingList.test.tsx'],
    patterns: ['NetInfo', 'syncQueue', 'AsyncStorage'],
    runs: [
      ['Run unit tests', 'npm test'],
      ['Check types', 'npx tsc --noEmit'],
      ['Lint the project', 'npm run lint'],
    ],
    tasks: ['Find where the list is saved', 'Check how sync errors are handled'],
    plans: ['Queueing changes offline', 'Replaying the queue', 'Testing a lost connection'],
    asks: ['Should the list sync as soon as the phone is back online?', 'Should a failed sync keep local changes?'],
    replies: ['The list works offline and syncs when the phone reconnects; conflicts keep the newest change.'],
  },
  'kettle-jobs': {
    files: ['digest.worker.ts', 'retry.ts', 'queue.ts', 'digest.test.ts', 'schedule.ts'],
    patterns: ['retryDelay', 'maxAttempts', 'sendDigest'],
    runs: [
      ['Run the digest tests', 'npm test -- digest'],
      ['Lint the project', 'npm run lint'],
      ['Show what changed', 'git diff --stat'],
    ],
    tasks: ['Find every job that sends email'],
    plans: ['Adding backoff', 'Testing the retries'],
    asks: ['Should a digest that fails five times go to the dead-letter queue?'],
    replies: ['Failed digests retry with backoff up to five times, then go to the dead-letter queue.'],
  },
  'kettle-docs': {
    files: ['quickstart.md', 'authentication.md', 'rate-limits.md', 'openapi.yaml', 'sidebar.json'],
    patterns: ['api_key', 'curl', 'rate limit'],
    runs: [
      ['Build the docs', 'npm run docs:build'],
      ['Check the links', 'npm run check-links'],
    ],
    tasks: ['List every endpoint without an example'],
    plans: ['Outlining the guide', 'Writing the examples'],
    asks: ['Show the examples in curl only, or JavaScript too?'],
    replies: ['The quickstart takes you from an API key to your first request in five steps, with curl examples.'],
  },
};
const HOSTS = ['react.dev', 'nodejs.org', 'developer.mozilla.org', 'www.postgresql.org', 'vite.dev'];
// Two made-up MCP tools, as Claude Code names them: a tracker and a database.
const MCP = [
  ['search issues', 'bugs labelled search'],
  ['run query', 'slowest recipe queries'],
];

/** The project's way of working; one that isn't listed works like the API. @param {string | null} name */
const projectOf = (name) => PROJECTS[name || ''] || PROJECTS['kettle-api'];

// Today's sessions that finished before the demo started, with their stretches in
// hours after the start of the lane chart (8 hours ago, or midnight if later).
/**
 * @typedef {{
 *   id: string, source: Source, title: string, project: string, cost: number, subCost: number,
 *   added: number, removed: number, used: number, work: Span[], sub: Span[], waits: Span[], messages: number[],
 * }} Earlier
 */
/** @type {Earlier[]} */
const EARLIER = [
  {
    id: 'demo-e1',
    source: 'claude',
    title: 'Review open pull requests',
    project: 'kettle-web',
    cost: 8.4,
    subCost: 1.1,
    added: 64,
    removed: 12,
    used: 212_000,
    work: [[0, 0.55]],
    sub: [[0.15, 0.3]],
    waits: [[0.25, 0.32]],
    messages: [0, 0.32],
  },
  {
    id: 'demo-e2',
    source: 'claude',
    title: 'Triage error alerts',
    project: 'kettle-api',
    cost: 14.9,
    subCost: 2.6,
    added: 188,
    removed: 41,
    used: 386_000,
    work: [
      [0.6, 1.5],
      [1.7, 2.3],
    ],
    sub: [[0.9, 1.2]],
    waits: [[1.5, 1.7]],
    messages: [0.6, 1.7],
  },
  {
    id: 'demo-e3',
    source: 'codex',
    title: 'Explain the cron schedule',
    project: 'kettle-jobs',
    cost: 1.4,
    subCost: 0,
    added: 0,
    removed: 0,
    used: 61_000,
    work: [[1.2, 1.6]],
    sub: [],
    waits: [],
    messages: [1.2],
  },
  {
    id: 'demo-e4',
    source: 'pi',
    title: 'Fix broken links in the docs',
    project: 'kettle-docs',
    cost: 0.9,
    subCost: 0,
    added: 23,
    removed: 19,
    used: 48_000,
    work: [[2.4, 2.9]],
    sub: [],
    waits: [],
    messages: [2.4],
  },
  {
    id: 'demo-e5',
    source: 'claude',
    title: 'Weekly stale-branch cleanup',
    project: 'kettle-api',
    cost: 0.4,
    subCost: 0,
    added: 0,
    removed: 0,
    used: 31_000,
    work: [[0.1, 0.2]],
    sub: [],
    waits: [],
    messages: [],
  },
  {
    id: 'demo-e6',
    source: 'claude',
    title: 'Rename the env variables',
    project: 'kettle-web',
    cost: 0.6,
    subCost: 0,
    added: 14,
    removed: 14,
    used: 52_000,
    work: [[3, 3.1]],
    sub: [],
    waits: [],
    messages: [3],
  },
  {
    id: 'demo-e7',
    source: 'claude',
    title: 'What does this regex match?',
    project: 'kettle-api',
    cost: 0.4,
    subCost: 0,
    added: 0,
    removed: 0,
    used: 28_000,
    work: [[4.1, 4.15]],
    sub: [],
    waits: [],
    messages: [4.1],
  },
];

// ── Prices and tokens ──────────────────────────────────────────────────────

/**
 * API list prices per million tokens, as lib/models.js has them.
 * @type {Record<string, [input: number, output: number, cacheRead: number, cacheWrite: number]>}
 */
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
  'gpt-6.1-sol': [2, 10, 0.1, 2.5],
};
/** A model's context window: Haiku's 200K, what Codex records for its model, and 1M for the rest. @param {string} model */
const windowOf = (model) => (model.includes('haiku') ? 200_000 : model.startsWith('gpt') ? 258_400 : 1_000_000);
/** @param {Source} source */
const contextWindow = (source) => (source === 'codex' ? 258_400 : 1_000_000);

/** @typedef {'output' | 'cacheRead' | 'cacheWrite' | 'input' | 'search'} TokenKey */
/** @type {[TokenKey, string][]} */
const TOKEN_TYPES = [
  ['output', 'Output (incl. thinking)'],
  ['cacheRead', 'Cache reads'],
  ['cacheWrite', 'Cache writes'],
  ['input', 'Fresh input'],
  ['search', 'Web searches'],
];
/**
 * How each source's spend splits by kind of token: [share of the cost, tokens per
 * dollar of it], from the prices of the models it mostly uses. Web searches are
 * $0.01 each and carry no tokens.
 * @type {Record<Source, Record<TokenKey, [share: number, perUsd: number]>>}
 */
const MIX = {
  claude: {
    cacheRead: [0.516, 3.57e6],
    output: [0.27, 4.65e4],
    cacheWrite: [0.19, 1.9e5],
    input: [0.02, 2.3e5],
    search: [0.004, 0],
  },
  codex: { cacheRead: [0.38, 1e7], output: [0.42, 1e5], cacheWrite: [0.12, 4e5], input: [0.08, 5e5], search: [0, 0] },
  pi: { cacheRead: [0.46, 5.5e6], output: [0.32, 1e5], cacheWrite: [0.16, 4e5], input: [0.06, 5e5], search: [0, 0] },
};
/** What a dollar buys in tokens, with each source's mix. @param {Source} source */
const perUsd = (source) => Object.values(MIX[source]).reduce((n, [share, per]) => n + share * per, 0);
/** What caching saves per token read from it (input price less cache price), USD. */
const SAVED_PER_READ = { claude: 4e-6, codex: 1.9e-6, pi: 1.8e-6 };

// Where each source's spend goes, by project.
/** @type {Record<Source, [project: string, share: number][]>} */
const PROJECT_SHARE = {
  claude: [
    ['kettle-api', 0.48],
    ['kettle-web', 0.3],
    ['kettle-mobile', 0.17],
    ['kettle-docs', 0.05],
  ],
  codex: [
    ['kettle-jobs', 0.72],
    ['kettle-api', 0.28],
  ],
  pi: [
    ['kettle-docs', 0.8],
    ['kettle-web', 0.2],
  ],
};
// And by model.
/** @type {Record<Source, [model: string, share: number, perUsd: number][]>} */
const MODEL_SHARE = {
  claude: [
    ['Opus 5.5', 0.66, 1.9e6],
    ['Opus 5', 0.19, 1.3e6],
    ['Sonnet 5', 0.12, 2.6e6],
    ['Haiku 4.5', 0.03, 4.8e6],
  ],
  codex: [
    ['GPT-6.1 Sol', 0.88, 3.8e6],
    ['GPT-6 Luna', 0.12, 4.8e6],
  ],
  pi: [
    ['Sonnet 5.5', 0.74, 2.6e6],
    ['GPT-6.1 Sol', 0.26, 2.8e6],
  ],
};

// ── Small helpers ──────────────────────────────────────────────────────────

/** @template T @param {readonly T[]} list @returns {T} */
const pick = (list) => list[Math.floor(Math.random() * list.length)];
/** @param {number} a @param {number} b */
const between = (a, b) => a + Math.random() * (b - a);
/** @param {number} x */
const cents = (x) => Math.round(x * 100) / 100;
/** @template T @param {readonly T[]} list @param {(x: T) => number} of */
const sum = (list, of) => list.reduce((n, x) => n + of(x), 0);

/** One of `entries` at random, each as likely as its weight. @template {string} T @param {[T, number][]} entries @returns {T} */
function weighted(entries) {
  const total = sum(entries, ([, w]) => w);
  let r = Math.random() * total;
  for (const [key, w] of entries) if ((r -= w) <= 0) return key;
  return entries[0][0];
}

/** The calendar day `t` is in, as a number: the same all day, a seed for that day. @param {number} t */
const dayNumber = (t) => Math.round(new Date(t).setHours(12, 0, 0, 0) / DAY);
/** Midnight `ago` calendar days before the day `t` is in. @param {number} t @param {number} [ago] */
function midnightOf(t, ago = 0) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ago);
  return d.getTime();
}
/** A number from 0 to 1, the same for the same day and salt, so a reload shows the same past. @param {number} n @param {number} salt */
function noise(n, salt) {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The parts of `spans` between `from` and `to`. @param {Span[]} spans @param {number} from @param {number} to @returns {Span[]} */
const clip = (spans, from, to) =>
  spans.filter(([a, b]) => b > from && a < to).map(([a, b]) => [Math.max(a, from), Math.min(b, to)]);
/** @param {Span[]} spans */
const totalMs = (spans) => sum(spans, ([a, b]) => b - a);
/** Spans that overlap (or come within `gap`) joined into one. @param {Span[]} spans @param {number} [gap] @returns {Span[]} */
function union(spans, gap = 0) {
  /** @type {Span[]} */
  const out = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// When your working day starts: the dashboard says (see startDemo); the office uses 4am.
let dayHour = () => 4;

/** The start of the working day `ago` days before the one `t` is in. @param {number} t @param {number} [ago] */
const workDay = (t, ago = 0) => workDayStart(t, dayHour(), -ago);

// ── The past, day by day ───────────────────────────────────────────────────

/**
 * A day you worked: when you sent your first and last message (hours after its
 * midnight; past 24 is after the next one), what it cost with every agent, and
 * Codex's and Pi's shares of that.
 * @typedef {{ first: number, last: number, cost: number, codex: number, pi: number, busy: number }} DayPlan
 */

/**
 * What you did on the calendar day starting at `midnight`, or null for a day off:
 * busy weekdays with the odd late night, a few short weekends, Codex on about
 * half the days, and Pi since two weeks before `t`.
 * @param {number} midnight
 * @param {number} t
 * @returns {DayPlan | null}
 */
function dayPlan(midnight, t) {
  const n = dayNumber(midnight);
  const weekday = new Date(midnight).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const off = noise(n, 1);
  if (weekend ? off < 0.72 : off < 0.06) return null;
  const first = weekend ? 10.5 + noise(n, 2) * 2.5 : 8.5 + noise(n, 2) * 1.6;
  const length = weekend ? 1.5 + noise(n, 3) * 2.5 : 8 + noise(n, 3) ** 1.5 * 8.5;
  const busy = 0.6 + noise(n, 4) * 0.8;
  return {
    first,
    last: first + length,
    cost: cents(length * busy * (weekend ? 6 : 12)),
    codex: noise(n, 5) < 0.55 ? 0.06 + noise(n, 6) * 0.12 : 0,
    pi: n > dayNumber(t) - 14 && noise(n, 7) < 0.6 ? 0.03 + noise(n, 8) * 0.07 : 0,
    busy,
  };
}

/** A day's spend by source. @param {DayPlan | null} plan @returns {Record<Source, number>} */
function costsOf(plan) {
  if (!plan) return { claude: 0, codex: 0, pi: 0 };
  return {
    claude: cents(plan.cost * (1 - plan.codex - plan.pi)),
    codex: cents(plan.cost * plan.codex),
    pi: cents(plan.cost * plan.pi),
  };
}

// When you were active in a day, as parts of the stretch from its first message to
// its last: all four with Claude Code, a couple with Codex, one with Pi.
/** @type {Record<ScopeName, [number, number][]>} */
const STRETCHES = {
  all: [
    [0, 0.1],
    [0.2, 0.33],
    [0.5, 0.6],
    [0.88, 1],
  ],
  claude: [
    [0, 0.1],
    [0.2, 0.33],
    [0.5, 0.6],
    [0.88, 1],
  ],
  codex: [
    [0.2, 0.33],
    [0.5, 0.6],
  ],
  pi: [[0.5, 0.6]],
};

/** Whether a source was used on a day. @param {DayPlan | null} plan @param {ScopeName} scope */
const usedOn = (plan, scope) =>
  !!plan && (scope === 'all' || scope === 'claude' || (scope === 'codex' ? plan.codex > 0 : plan.pi > 0));

/**
 * Today as the live demo has it, kept for what's asked for outside the snapshot
 * (the days on record, the digest): each source's spend and tokens, your
 * messages and active time, your agents' time, sessions and lines changed.
 * @typedef {{ cost: Record<Source, number>, tokens: Record<Source, number>, messages: number, activeMs: number,
 *   agentMs: number, sessions: number, tools: number, failed: number, added: number, removed: number,
 *   top: DigestSession[] }} LiveDay
 */
/** @type {LiveDay | null} */
let liveDay = null;

/**
 * A day's numbers for a provider view, for the days on record and the digest:
 * from its plan, or from the live demo for today.
 * @param {number} midnight
 * @param {number} t
 * @param {ScopeName} scope
 */
function dayStats(midnight, t, scope) {
  const sources = sourcesOf(scope);
  if (midnight === midnightOf(t) && liveDay) {
    const live = liveDay;
    const share =
      sum(sources, (s) => live.cost[s]) /
      Math.max(
        0.01,
        sum(SOURCES, (s) => live.cost[s]),
      );
    return {
      cost: sum(sources, (s) => live.cost[s]),
      bySource: live.cost,
      tokens: sum(sources, (s) => live.tokens[s]),
      messages: Math.round(live.messages * share),
      sessions: Math.max(1, Math.round(live.sessions * share)),
      activeMs: live.activeMs * share,
      agentMs: live.agentMs * share,
      waitMs: live.messages * share * 1.2 * MIN,
      waits: Math.max(0, Math.round(live.messages * share) - 1),
      tools: Math.round(live.tools * share),
      failed: Math.round(live.failed * share),
      added: Math.round(live.added * share),
      removed: Math.round(live.removed * share),
    };
  }
  const plan = dayPlan(midnight, t);
  const bySource = costsOf(plan);
  const cost = sum(sources, (s) => bySource[s]);
  if (!plan || !usedOn(plan, scope))
    return {
      cost,
      bySource,
      tokens: Math.round(sum(sources, (s) => bySource[s] * perUsd(s))),
      messages: 0,
      sessions: 0,
      activeMs: 0,
      agentMs: 0,
      waitMs: 0,
      waits: 0,
      tools: 0,
      failed: 0,
      added: 0,
      removed: 0,
    };
  const share = plan.cost ? cost / plan.cost : 0;
  const activeMs = (plan.last - plan.first) * H * sum(STRETCHES[scope], ([a, b]) => b - a);
  const messages = Math.max(1, messagesIn(activeMs));
  const tools = Math.round(cost * 9);
  return {
    cost,
    bySource,
    tokens: Math.round(sum(sources, (s) => bySource[s] * perUsd(s))),
    messages,
    sessions: Math.max(1, Math.round((2 + plan.busy * 5) * Math.sqrt(share))),
    activeMs,
    agentMs: activeMs * (1.5 + plan.busy * 0.5) + (plan.last > 24 && scope !== 'pi' ? 1.5 * H : 0),
    waitMs: messages * 1.2 * MIN,
    waits: messages - 1,
    tools,
    failed: Math.round(tools * 0.015),
    added: Math.round(cost * 22),
    removed: Math.round(cost * 7),
  };
}

/**
 * Your active stretches on each working day from `ago` days back to today, for a
 * provider view: from each day's plan, and today from `firstToday` until now.
 * @param {number} t
 * @param {number} firstToday
 * @param {ScopeName} scope
 * @param {number} ago
 * @returns {{ start: number, plan: DayPlan | null, first: number, last: number, stretches: Span[] }[]}
 */
function yourDays(t, firstToday, scope, ago) {
  return Array.from({ length: ago + 1 }, (_, i) => {
    const start = workDay(t, ago - i);
    const today = i === ago;
    const midnight = new Date(start).setHours(0, 0, 0, 0);
    const plan = dayPlan(midnight, t);
    if (!today && !usedOn(plan, scope)) return { start, plan: null, first: 0, last: 0, stretches: [] };
    const a = today
      ? firstToday
      : Math.max(start + 5 * MIN, Math.round(midnight + /** @type {DayPlan} */ (plan).first * H));
    const b = today ? t : Math.round(midnight + /** @type {DayPlan} */ (plan).last * H);
    if (b <= a) return { start, plan: null, first: 0, last: 0, stretches: [] };
    const parts = STRETCHES[scope].map(([x, y]) => /** @type {Span} */ ([a + (b - a) * x, a + (b - a) * y]));
    return { start, plan, first: parts[0][0], last: parts[parts.length - 1][1], stretches: parts };
  });
}

/** Messages in a stretch of active time. @param {number} ms */
const messagesIn = (ms) => Math.round((ms / H) * 10);

/**
 * Your working hours over 14 working days and active time over 30 calendar days.
 * @param {number} t
 * @param {number} firstToday
 * @param {ScopeName} scope
 * @returns {WorkingHours}
 */
function demoHours(t, firstToday, scope) {
  const all = yourDays(t, firstToday, scope, 31);
  const today = workDay(t);
  const days = all.slice(-14).map((d) => {
    if (!d.stretches.length) return /** @type {YouDayOff} */ ({ start: d.start, messages: 0 });
    const activeMs = totalMs(d.stretches);
    return /** @type {YouWorkDay} */ ({
      start: d.start,
      first: d.first,
      last: d.last,
      messages: Math.max(1, messagesIn(activeMs)),
      stretches: d.stretches,
      activeMs,
      late: d.last >= new Date(d.start).setHours(24, 0, 0, 0),
    });
  });
  const worked = days.filter((d) => d.messages > 0).map((d) => /** @type {YouWorkDay} */ (d));
  const done = worked.filter((d) => d.start < today);
  const has = all.map((d) => d.stretches.length > 0);
  let streak = 0;
  for (let i = has.length - (has[has.length - 1] ? 1 : 2); i >= 0 && has[i]; i--) streak++;
  let longestStreak = 0;
  for (let i = 0, run = 0; i < has.length; i++) longestStreak = Math.max(longestStreak, (run = has[i] ? run + 1 : 0));
  const stretches = all.flatMap((d) => d.stretches);
  /** @type {YouDate[]} */
  const dates = Array.from({ length: 30 }, (_, i) => {
    const start = midnightOf(t, 29 - i);
    const parts = clip(stretches, start, i === 29 ? t + 1 : midnightOf(t, 28 - i));
    const activeMs = totalMs(parts);
    return {
      start,
      activeMs,
      messages: parts.length ? Math.max(1, messagesIn(activeMs)) : 0,
      first: parts.length ? parts[0][0] : null,
      last: parts.length ? parts[parts.length - 1][1] : null,
    };
  });
  const lastLate = [...worked].reverse().find((d) => d.late);
  return {
    days,
    dates,
    typicalStart: median(worked.map((d) => d.first - d.start)),
    typicalStop: median(done.map((d) => d.last - d.start)),
    typicalLength: median(done.map((d) => d.last - d.first)),
    completedDays: done.length,
    lateNights: worked.filter((d) => d.late).length,
    lastLate: lastLate?.start ?? null,
    daysOff: days.filter((d) => d.start < today && !d.messages).length,
    streak,
    longestStreak,
    week: sum(dates.slice(-7), (d) => d.activeMs),
    prevWeek: sum(dates.slice(-14, -7), (d) => d.activeMs),
  };
}

/**
 * When your agents worked: a little inside your own stretches, and on late nights
 * on their own for an hour and a half after you stopped. Today they're still at it.
 * @param {number} t
 * @param {number} firstToday
 * @param {ScopeName} scope
 * @param {number} peakNow how many agents are at work now
 * @returns {AgentHours}
 */
function demoAgentHours(t, firstToday, scope, peakNow) {
  const solo = scope === 'codex' || scope === 'pi';
  const days = yourDays(t, firstToday, scope, 30).map((d, i, list) => {
    const today = i === list.length - 1;
    /** @type {Span[]} */
    const work = d.stretches.map(([a, b], k) => [
      a + 4 * MIN,
      today && k === d.stretches.length - 1 ? t : Math.max(a + 5 * MIN, b - 6 * MIN),
    ]);
    const late = d.last >= new Date(d.start).setHours(24, 0, 0, 0);
    /** @type {Span[]} */
    const alone = late && !today && !solo ? [[d.last + 10 * MIN, d.last + 100 * MIN]] : [];
    return { start: d.start, n: dayNumber(d.start), work: [...work, ...alone], alone };
  });
  /** @param {number} n */
  const ratio = (n) => (solo ? 1 + noise(n, 9) * 0.2 : 1.4 + noise(n, 9) * 0.6);
  /**
   * What the agents did between `from` and `to`.
   * @param {number} from @param {number} to @param {Span[]} work @param {Span[]} alone @param {number} n
   * @returns {AgentWorkDay | AgentIdleDay}
   */
  const stats = (from, to, work, alone, n) => {
    const parts = clip(work, from, to);
    if (!parts.length) return { start: from, wallMs: 0, agentMs: 0 };
    const wallMs = totalMs(parts);
    return {
      start: from,
      first: parts[0][0],
      last: parts[parts.length - 1][1],
      wallMs,
      agentMs: wallMs * ratio(n),
      peak: Math.max(solo ? 1 : 3 + Math.floor(noise(n, 10) * 6), to > t - MIN ? peakNow : 0),
      sessions: solo ? 1 + Math.floor(noise(n, 11) * 2) : 3 + Math.floor(noise(n, 11) * 4),
      subagents: solo ? 0 : 2 + Math.floor(noise(n, 12) * 6),
      unattendedMs: totalMs(clip(alone, from, to)),
    };
  };
  /** @type {AgentHours['longest']} */
  let longest = null;
  const calendar = days.slice(-14).map((d, i) => {
    const s = stats(d.start, i === 13 ? t : d.start + DAY, d.work, d.alone, d.n);
    if (!s.wallMs) return /** @type {AgentIdleDay} */ (s);
    const day = /** @type {AgentWorkDay} */ (s);
    const stretches = union(clip(d.work, d.start, d.start + DAY), 10 * MIN);
    for (const [a, b] of stretches) if (!longest || b - a > longest.ms) longest = { ms: b - a, from: a, to: b };
    return /** @type {AgentCalendarDay} */ ({
      ...day,
      stretches,
      late: day.last > new Date(day.start).setHours(24, 0, 0, 0),
    });
  });
  const work = days.flatMap((d) => d.work);
  const alone = days.flatMap((d) => d.alone);
  const dates = Array.from({ length: 30 }, (_, i) => {
    const start = midnightOf(t, 29 - i);
    return stats(start, i === 29 ? t : midnightOf(t, 28 - i), work, alone, dayNumber(start));
  });
  const worked = calendar.filter((d) => d.wallMs > 0).map((d) => /** @type {AgentCalendarDay} */ (d));
  const done = worked.filter((d) => d.start < workDay(t));
  /** @param {number} from @param {number | undefined} to @param {(d: AgentWorkDay | AgentIdleDay) => number} of */
  const total = (from, to, of) => sum(dates.slice(from, to), of);
  return {
    days: calendar,
    dates,
    typicalStart: median(worked.map((d) => d.first - d.start)),
    typicalStop: median(done.map((d) => d.last - d.start)),
    week: total(-7, undefined, (d) => d.wallMs),
    prevWeek: total(-14, -7, (d) => d.wallMs),
    weekAgentMs: total(-7, undefined, (d) => d.agentMs),
    prevWeekAgentMs: total(-14, -7, (d) => d.agentMs),
    weekUnattendedMs: total(-7, undefined, (d) => d.unattendedMs || 0),
    lateNights: worked.filter((d) => d.late).length,
    lastLate: [...worked].reverse().find((d) => d.late)?.start ?? null,
    longest,
  };
}

/**
 * Each source's spend as pieces of time with a rate, for the last 31 days: each
 * day's cost spread over your active stretches, and today's over today's.
 * @param {number} t
 * @param {number} firstToday
 * @param {Record<Source, number>} today
 * @returns {{ from: number, to: number, rate: Record<Source, number> }[]}
 */
function spendPieces(t, firstToday, today) {
  return yourDays(t, firstToday, 'all', 31).flatMap((d, i, list) => {
    if (!d.stretches.length) return [];
    const costs = i === list.length - 1 ? today : costsOf(d.plan);
    const ms = totalMs(d.stretches);
    return d.stretches.map(([from, to]) => ({
      from,
      to,
      rate: { claude: costs.claude / ms, codex: costs.codex / ms, pi: costs.pi / ms },
    }));
  });
}

/**
 * What `sources` spent between `from` and `to`.
 * @param {ReturnType<typeof spendPieces>} pieces @param {Source[]} sources @param {number} from @param {number} to
 */
const spentIn = (pieces, sources, from, to) =>
  sum(pieces, (p) => Math.max(0, Math.min(p.to, to) - Math.max(p.from, from)) * sum(sources, (s) => p.rate[s]));

// ── The plan windows ───────────────────────────────────────────────────────

/** Claude Code's 5-hour window now: 2.6 hours in and 82% used, at a pace that runs out before it resets. */
const SESSION = { inH: 2.6, used: 78.7, capacity: 96, cost30m: 7.4 };

/**
 * Claude Code's limits as the local estimate sees them.
 * @param {number} t
 * @param {ReturnType<typeof spendPieces>} pieces
 * @param {SpendSummary} spend
 * @param {number | null} earlier when today's earlier window started, if there was one
 * @returns {LimitsEstimate}
 */
function demoLimits(t, pieces, spend, earlier) {
  const start = t - SESSION.inH * H;
  // The weekly window resets on Tuesdays at 9am: the next one after now.
  const tuesday = new Date(t);
  tuesday.setDate(tuesday.getDate() + ((9 - tuesday.getDay()) % 7));
  tuesday.setHours(9, 0, 0, 0);
  if (tuesday.getTime() <= t) tuesday.setDate(tuesday.getDate() + 7);
  const weekUsed = spentIn(pieces, ['claude'], tuesday.getTime() - 7 * DAY, t);
  const capacity = 1250;
  return {
    source: 'estimate',
    session: {
      active: true,
      start,
      resetsAt: start + 5 * H,
      limited: false,
      used: SESSION.used,
      pct: Math.round((SESSION.used / SESSION.capacity) * 100),
      capacity: SESSION.capacity,
      calibration: { lastHitAt: t - 26 * H, samples: 3 },
    },
    weekly: {
      resetsAt: tuesday.getTime(),
      rolling: false,
      limited: false,
      used: cents(weekUsed),
      pct: Math.round((weekUsed / capacity) * 100),
      capacity,
      calibration: { lastHitAt: t - 9 * DAY, samples: 1 },
    },
    rates: {
      cost30m: SESSION.cost30m,
      cost24h: cents(spentIn(pieces, ['claude'], t - DAY, t)),
      cost7d: cents(spentIn(pieces, ['claude'], t - 7 * DAY, t)),
    },
    usage: demoUsage(t, start, earlier, pieces),
    spend,
    computedAt: t,
  };
}

/**
 * Spend in steps for the window chart: the session window's in 5 minutes, adding
 * up to what it has used (its last half hour to the pace), and the week's by the hour.
 * @param {number} t @param {number} start @param {number | null} earlier
 * @param {ReturnType<typeof spendPieces>} pieces
 * @returns {{ fine: SpendSeries, hourly: SpendSeries }}
 */
function demoUsage(t, start, earlier, pieces) {
  const FIVE = 5 * MIN;
  const fineFrom = Math.floor((t - 5.2 * H) / FIVE) * FIVE;
  const n = Math.ceil((t - fineFrom) / FIVE);
  /** @param {number} i */
  const wave = (i) => Math.max(0.1, Math.sin(i * 0.35) + Math.sin(i * 0.95 + 1) + 1.4);
  const lastHalfHour = n - 6;
  const inside = Array.from({ length: n }, (_, i) => fineFrom + i * FIVE >= start);
  const before = sum(
    inside.map((x, i) => (x && i < lastHalfHour ? wave(i) : 0)),
    (x) => x,
  );
  const recent = sum(
    Array.from({ length: 6 }, (_, k) => wave(lastHalfHour + k)),
    (x) => x,
  );
  const fine = Array.from({ length: n }, (_, i) => {
    const at = fineFrom + i * FIVE;
    if (i >= lastHalfHour) return cents((wave(i) / recent) * SESSION.cost30m);
    if (inside[i]) return cents((wave(i) / before) * (SESSION.used - SESSION.cost30m));
    // The end of today's earlier window, before a break.
    return earlier != null && at < earlier + 5 * H ? cents(wave(i) * 0.4) : 0;
  });
  const hourFrom = Math.floor((t - 169 * H) / H) * H;
  const hourly = Array.from({ length: Math.ceil((t - hourFrom) / H) }, (_, i) =>
    cents(spentIn(pieces, ['claude'], hourFrom + i * H, hourFrom + (i + 1) * H)),
  );
  return {
    fine: { from: fineFrom, step: FIVE, costs: fine },
    hourly: { from: hourFrom, step: H, costs: hourly },
  };
}

/**
 * Codex's windows as it recorded them 25 minutes ago, each with its recent pace.
 * @param {number} t
 * @returns {RecordedCodexLimits}
 */
function demoCodexLimits(t) {
  const observedAt = t - 25 * MIN;
  return {
    provider: 'codex',
    accountId: 'demo',
    status: 'ok',
    source: 'recorded',
    observedAt,
    message: null,
    windows: [
      {
        provider: 'codex',
        accountId: 'demo',
        bucketId: 'codex',
        kind: 'primary',
        id: 'demo:codex:primary',
        bucketName: 'codex',
        durationMs: 5 * H,
        usedPercent: 23,
        resetsAt: t + 3.2 * H,
        plan: 'plus',
        // About 12% an hour lately, so it ends the window a little past half.
        pace: {
          rate: 12 / H,
          basis: 'over the last hour',
          start: t - 1.8 * H,
          history: [
            [t - 108 * MIN, 6],
            [t - 90 * MIN, 10],
            [t - 72 * MIN, 13],
            [t - 55 * MIN, 17],
            [t - 40 * MIN, 20],
            [observedAt, 23],
          ],
        },
      },
      {
        provider: 'codex',
        accountId: 'demo',
        bucketId: 'codex',
        kind: 'secondary',
        id: 'demo:codex:secondary',
        bucketName: 'codex',
        durationMs: 7 * DAY,
        usedPercent: 41,
        resetsAt: t + 4.5 * DAY,
        plan: 'plus',
        // Half a percent an hour over the last day: on pace to end the week close to full.
        pace: {
          rate: 0.52 / H,
          basis: 'over the last day',
          start: t - 2.5 * DAY,
          history: [
            [t - 2.3 * DAY, 6],
            [t - 1.9 * DAY, 14],
            [t - 1.2 * DAY, 25],
            [t - 0.8 * DAY, 31],
            [t - 0.2 * DAY, 38],
            [observedAt, 41],
          ],
        },
      },
    ],
  };
}

const floor10 = (/** @type {number} */ ms) => Math.floor(ms / (10 * MIN)) * 10 * MIN;

/** When today's earlier window started, if there was room for one before the one the limit cards show. @param {number} t */
function earlierWindow(t) {
  const start = t - SESSION.inH * H - 5.5 * H;
  return start >= workDay(t) + H ? start : null;
}

/** Your first message today: just after the earlier window or the current one started. @param {number} t */
const firstMessageToday = (t) => Math.max(workDay(t) + 5 * MIN, (earlierWindow(t) ?? t - SESSION.inH * H) + 3 * MIN);

/**
 * Claude Code's 5-hour windows of the last 7 days, chained through each day you
 * worked, today's leading up to the one the limit cards show, and when to start.
 * @param {number} t
 * @param {WorkingHours} hours
 * @param {LimitsEstimate['session']} current
 * @param {number | null} earlier
 * @param {number} earlierCost
 * @returns {SessionPlan}
 */
function demoWindows(t, hours, current, earlier, earlierCost) {
  const since = new Date(workDay(t, 6)).setHours(0, 0, 0, 0);
  const costs = [46, 81, 71, 96, 58, 64, 96, 88, 22, 79, 96, 57, 69, 35];
  /** @type {SessionPlan['windows']} */
  const windows = [];
  let k = 0;
  for (const d of hours.days.slice(7, 13)) {
    if (!d.first || !d.last) continue;
    for (let start = floor10(d.first); start < d.last; start += 5 * H + 20 * MIN) {
      const cost = costs[k++ % costs.length];
      windows.push({ start, end: start + 5 * H, cost, hitAt: cost >= 96 ? start + 3.4 * H : null });
    }
  }
  if (earlier != null) windows.push({ start: earlier, end: earlier + 5 * H, cost: cents(earlierCost), hitAt: null });
  const start = /** @type {number} */ (current.start);
  windows.push({ start, end: start + 5 * H, cost: current.used, hitAt: null });
  const hit = windows.filter((w) => w.hitAt);
  const days = new Set(windows.map((w) => workDay(w.start)));
  const from = hours.typicalStart ?? 5 * H;
  const stop = hours.typicalStop ?? from + 9 * H;
  const useful = Math.floor((stop - from - H) / (5 * H)) + 1;
  const by = floor10(stop - H - useful * 5 * H);
  return {
    since,
    windows,
    perDay: windows.length / days.size,
    today: earlier != null ? 2 : 1,
    hits: hit.length,
    lockedMs: sum(hit, (w) => w.end - /** @type {number} */ (w.hitAt)),
    plan: {
      start: from,
      stop,
      useful,
      by,
      lead: from - by,
      resets: Array.from({ length: useful }, (_, i) => by + (i + 1) * 5 * H),
    },
  };
}

// ── Insights ───────────────────────────────────────────────────────────────

/**
 * One of today's sessions, live or finished: what the cost, today and timeline
 * cards show of it.
 * @typedef {{
 *   id: string, source: Source, title: string, project: string, cost: number, subCost: number, tokens: number,
 *   added: number, removed: number, used: number, inOffice: boolean, last: number,
 *   work: Span[], sub: Span[], waits: Span[], messages: number[],
 * }} Row
 */

/**
 * What the live demo knows right now: today's sessions, your first message
 * today (and how much the day so far is squeezed when it's early), the agents
 * at work, each source's tool calls and lines changed today, the compactions
 * and the turns going on.
 * @typedef {{ rows: Row[], firstToday: number, squeeze: number, atWork: { source: Source, kind: 'main' | 'sub' }[],
 *   counts: Record<Source, { tools: number, failed: number,
 *   added: number, removed: number }>, compactions: number, working: Record<Source, number> }} Live
 */

/** A spend total, with nothing unpriced. @param {number} cost @param {number} tokens @returns {SpendTotals} */
const totals = (cost, tokens) => ({
  cost: cents(cost),
  tokens: Math.round(tokens),
  unpricedTokens: 0,
  partial: false,
  costKnown: true,
});

/**
 * Today, yesterday (all of it and up to now), the last 7 and 30 days and this month.
 * @param {number} t @param {Source[]} sources @param {Record<Source, number>} today
 * @param {ReturnType<typeof spendPieces>} pieces
 * @returns {SpendSummary}
 */
function demoSpend(t, sources, today, pieces) {
  /** @param {number} ago */
  const day = (ago) => (ago === 0 ? today : costsOf(dayPlan(midnightOf(t, ago), t)));
  /** @param {Record<Source, number>} c */
  const cost = (c) => sum(sources, (s) => c[s]);
  /** @param {Record<Source, number>} c */
  const tokens = (c) => sum(sources, (s) => c[s] * perUsd(s));
  /** @param {number} from @param {number} to */
  const span = (from, to) => {
    let c = 0;
    let n = 0;
    for (let ago = from; ago >= to; ago--) {
      c += cost(day(ago));
      n += tokens(day(ago));
    }
    return totals(c, n);
  };
  const yesterdayStart = midnightOf(t, 1);
  const byNow = spentIn(pieces, sources, yesterdayStart, t - DAY);
  const yesterday = day(1);
  const monthFrom = new Date(midnightOf(t)).setDate(1);
  return {
    today: totals(cost(today), tokens(today)),
    yesterday: totals(cost(yesterday), tokens(yesterday)),
    yesterdayByNow: totals(byNow, (byNow * tokens(yesterday)) / Math.max(0.01, cost(yesterday))),
    last7: span(6, 0),
    last30: span(29, 0),
    month: { ...span(Math.round((midnightOf(t) - monthFrom) / DAY), 0), from: monthFrom },
  };
}

/**
 * Where the money went, given each source's spend over a stretch: by model,
 * main agents against subagents, kind of token and project.
 * @param {Record<Source, number>} costs
 * @returns {Breakdown}
 */
function demoBreakdown(costs) {
  const sources = SOURCES.filter((s) => costs[s] > 0);
  /** @param {[string, number, number][]} list @param {number} limit @returns {CostItem[]} */
  const top = (list, limit) => {
    /** @type {Map<string, { cost: number, tokens: number }>} */
    const by = new Map();
    for (const [name, cost, tokens] of list) {
      const v = by.get(name) || { cost: 0, tokens: 0 };
      v.cost += cost;
      v.tokens += tokens;
      by.set(name, v);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1].cost - a[1].cost);
    /** @type {CostItem[]} */
    const out = sorted.slice(0, limit).map(([name, v]) => ({ name, cost: v.cost, tokens: Math.round(v.tokens) }));
    const rest = sorted.slice(limit);
    if (rest.length)
      out.push({
        name: `${rest.length} other${rest.length === 1 ? '' : 's'}`,
        cost: sum(rest, ([, v]) => v.cost),
        tokens: Math.round(sum(rest, ([, v]) => v.tokens)),
        other: true,
      });
    return out;
  };
  const tokensOf = (/** @type {Source} */ s) => costs[s] * perUsd(s);
  /** @type {TokenTypeCost[]} */
  const types = TOKEN_TYPES.map(([key, name]) => ({
    name,
    key,
    cost: sum(sources, (s) => costs[s] * MIX[s][key][0]),
    tokens: Math.round(sum(sources, (s) => costs[s] * MIX[s][key][0] * MIX[s][key][1])),
  }))
    .filter((x) => x.cost > 0.005 || x.tokens > 0)
    .sort((a, b) => b.cost - a.cost);
  return {
    cost: sum(sources, (s) => costs[s]),
    tokens: Math.round(sum(sources, tokensOf)),
    models: top(
      sources.flatMap((s) =>
        MODEL_SHARE[s].map(([name, share, per]) => [name, costs[s] * share, costs[s] * share * per]),
      ),
      5,
    ),
    // Pi has no subagents.
    agents: top(
      sources.flatMap((s) => {
        const sub = s === 'pi' ? 0 : s === 'codex' ? 0.08 : 0.31;
        return /** @type {[string, number, number][]} */ ([
          ['Main agents', costs[s] * (1 - sub), tokensOf(s) * (1 - sub)],
          ['Subagents', costs[s] * sub, tokensOf(s) * sub],
        ]).filter(([, cost]) => cost > 0);
      }),
      2,
    ),
    types,
    projects: top(
      sources.flatMap((s) => PROJECT_SHARE[s].map(([name, share]) => [name, costs[s] * share, tokensOf(s) * share])),
      6,
    ),
  };
}

/**
 * What prompt caching saved and cost on `costs`' spend, with the cache rebuilt a
 * few times a day, mostly after a pause.
 * @param {Record<Source, number>} costs
 * @returns {CacheStats}
 */
function demoCache(costs) {
  const part = (/** @type {TokenKey} */ key) => sum(SOURCES, (s) => costs[s] * MIX[s][key][0] * MIX[s][key][1]);
  const read = part('cacheRead');
  const write = part('cacheWrite');
  const fresh = part('input');
  const writeCost = sum(SOURCES, (s) => costs[s] * MIX[s].cacheWrite[0]);
  const rebuilds = Math.round(sum(SOURCES, (s) => costs[s]) * 0.09);
  const afterPause = Math.round(rebuilds * 0.7);
  return {
    cost: sum(SOURCES, (s) => costs[s]),
    saved: sum(SOURCES, (s) => costs[s] * MIX[s].cacheRead[0] * MIX[s].cacheRead[1] * SAVED_PER_READ[s]),
    read: Math.round(read),
    write: Math.round(write),
    fresh: Math.round(fresh),
    writeCost,
    rebuilds,
    rebuildCost: writeCost * 0.24,
    afterPause,
    afterPauseCost: writeCost * 0.18,
    hitRate: read + write + fresh ? read / (read + write + fresh) : null,
  };
}

/**
 * Today's sessions as the Today card lists them, priciest first.
 * @param {Row[]} rows
 * @returns {TodaySession[]}
 */
const todayList = (rows) =>
  rows
    .map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      project: r.project,
      cost: cents(r.cost),
      tokens: r.tokens,
      partial: false,
      context: contextAt(r),
    }))
    .sort((a, b) => b.cost - a.cost);

/** How full a session was at its last reply. @param {Row} r */
function contextAt(r) {
  const window = contextWindow(r.source);
  return { used: r.used, window, pct: Math.min(100, Math.round((r.used / window) * 100)), at: r.last };
}

/**
 * Today's priciest sessions.
 * @param {Row[]} rows
 * @returns {TopSession[]}
 */
const topSessions = (rows) =>
  [...rows]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      project: r.project,
      cost: cents(r.cost),
      partial: false,
      subCost: cents(r.subCost),
      tokens: r.tokens,
      added: r.added,
      removed: r.removed,
      linesPerDollar: r.cost > 0.05 ? (r.added + r.removed) / r.cost : null,
      inOffice: r.inOffice,
      last: r.last,
      context: contextAt(r),
    }));

/**
 * Today as lanes, one a session: the busiest 14, in the order they started.
 * @param {number} t
 * @param {Row[]} rows
 * @param {WorkingHours} hours
 * @param {ScopeName} scope
 * @returns {TodayTimeline}
 */
function demoTimeline(t, rows, hours, scope) {
  const from = midnightOf(t);
  /** @type {TimelineLane[]} */
  const lanes = rows
    .map((r) => {
      const work = union(clip(r.work, from, t), MIN);
      const sub = union(clip(r.sub, from, t), MIN);
      const busy = union([...work, ...sub]);
      const messages = r.messages.filter((m) => m >= from && m <= t).sort((a, b) => a - b);
      const starts = [...busy.map((x) => x[0]), ...messages];
      return {
        id: r.id,
        source: r.source,
        title: r.title,
        project: r.project,
        work,
        sub,
        waits: clip(r.waits, from, t).filter(([a, b]) => b - a >= MIN),
        messages,
        cost: cents(r.cost),
        tokens: r.tokens,
        partial: false,
        busyMs: totalMs(busy),
        first: starts.length ? Math.min(...starts) : 0,
        last: Math.max(...busy.map((x) => x[1]), ...messages, 0) || null,
      };
    })
    .filter((l) => l.first > 0);
  const kept = new Set([...lanes].sort((a, b) => b.busyMs - a.busyMs).slice(0, 14));
  const others = lanes.filter((l) => !kept.has(l));
  // Your usual day: how often you were active in each quarter hour of the last two weeks.
  const past = yourDays(t, t, scope, 15).flatMap((d) => d.stretches);
  let days = 0;
  const slots = new Array(96).fill(0);
  for (let i = 1; i <= 14; i++) {
    const start = midnightOf(t, i);
    const parts = clip(past, start, midnightOf(t, i - 1));
    if (!parts.length) continue;
    days++;
    for (let k = 0; k < 96; k++) {
      const a = start + k * 15 * MIN;
      if (parts.some(([x, y]) => x < a + 15 * MIN && y > a)) slots[k]++;
    }
  }
  const todays = hours.days[hours.days.length - 1];
  return {
    from,
    you: clip(todays.stretches || [], from, t),
    usual: { days, slots: slots.map((n) => (days ? cents(n / days) : 0)) },
    lanes: lanes.filter((l) => kept.has(l)).sort((a, b) => a.first - b.first),
    others: {
      sessions: others.length,
      busyMs: sum(others, (l) => l.busyMs),
      cost: cents(sum(others, (l) => l.cost)),
      tokens: sum(others, (l) => l.tokens),
    },
  };
}

// The messages that cost the most or kept an agent busiest this week, in hours before now.
/** @type {(Omit<MessageSummary, 't' | 'partial'> & { ago: number })[]} */
const MESSAGES = [
  {
    text: 'Add full-text search over recipe titles and ingredients, ranked by how well they match',
    ago: 3.1,
    cost: 6.8,
    source: 'claude',
    ms: 41 * MIN,
    project: 'kettle-api',
    session: 'demo-0',
    inOffice: true,
  },
  {
    text: 'Move the build from webpack to Vite and keep the same output folder',
    ago: 2.9,
    cost: 4.9,
    source: 'claude',
    ms: 52 * MIN,
    project: 'kettle-web',
    session: 'demo-3',
    inOffice: true,
  },
  {
    text: 'Plan a weekly meal planner: drag recipes onto days, then make a shopping list from the week',
    ago: 1.5,
    cost: 3.6,
    source: 'claude',
    ms: 33 * MIN,
    project: 'kettle-web',
    session: 'demo-2',
    inOffice: true,
  },
  {
    text: 'Write the ratings migration, with a backfill that can run while the app is up',
    ago: 50,
    cost: 3.1,
    source: 'claude',
    ms: 74 * MIN,
    project: 'kettle-api',
    session: 'demo-past-ratings',
    inOffice: false,
  },
  {
    text: 'Retry failed digest emails with backoff, at most five times',
    ago: 1.8,
    cost: 1.9,
    source: 'codex',
    ms: 23 * MIN,
    project: 'kettle-jobs',
    session: 'demo-4',
    inOffice: true,
  },
  {
    text: 'Write a quickstart: get a key, make the first request, handle the errors',
    ago: 1.1,
    cost: 0.8,
    source: 'pi',
    ms: 14 * MIN,
    project: 'kettle-docs',
    session: 'demo-6',
    inOffice: true,
  },
];

// The longest waits for your reply this week, in hours before now.
/** @type {{ session: string, source: Source, title: string, project: string, ago: number, ms: number }[]} */
const LONG_WAITS = [
  {
    session: 'demo-7',
    source: 'claude',
    title: 'Add offline mode to the shopping list',
    project: 'kettle-mobile',
    ago: 26,
    ms: 27 * MIN,
  },
  {
    session: 'demo-0',
    source: 'claude',
    title: 'Add full-text recipe search',
    project: 'kettle-api',
    ago: 3.9,
    ms: 22 * MIN,
  },
  {
    session: 'demo-4',
    source: 'codex',
    title: 'Add retries to the email digest job',
    project: 'kettle-jobs',
    ago: 1.4,
    ms: 18 * MIN,
  },
  {
    session: 'demo-1',
    source: 'claude',
    title: 'Fix flaky image upload tests',
    project: 'kettle-api',
    ago: 4,
    ms: 16 * MIN,
  },
  {
    session: 'demo-e4',
    source: 'pi',
    title: 'Fix broken links in the docs',
    project: 'kettle-docs',
    ago: 5.2,
    ms: 9 * MIN,
  },
];

// Each source's tools over a week, as shares of its calls and how often they failed.
/** @type {Record<Source, [name: string, share: number, failed: number, denied: number][]>} */
const TOOL_SHARE = {
  claude: [
    ['Bash', 0.42, 0.014, 0.0015],
    ['Read', 0.24, 0.003, 0],
    ['Edit', 0.16, 0.019, 0.0006],
    ['Grep', 0.09, 0.001, 0],
    ['Write', 0.05, 0.02, 0],
    ['WebFetch', 0.02, 0.12, 0],
  ],
  codex: [
    ['exec_command', 0.7, 0.02, 0.001],
    ['apply_patch', 0.25, 0.03, 0],
    ['web_search', 0.05, 0, 0],
  ],
  pi: [
    ['bash', 0.45, 0.02, 0],
    ['read', 0.3, 0.004, 0],
    ['edit', 0.25, 0.025, 0],
  ],
};

/**
 * Everything the dashboard works out for one provider view.
 * @param {number} t
 * @param {ScopeName} scope
 * @param {Live} live
 * @param {Record<Source, number>[]} days each of the last 30 days' spend by source, today last
 * @returns {Insights}
 */
function demoInsights(t, scope, live, days) {
  const sources = sourcesOf(scope);
  const mine = (/** @type {{ source: Source }} */ x) => sources.includes(x.source);
  const rows = live.rows.filter(mine);
  /** @param {Record<Source, number>[]} list @returns {Record<Source, number>} */
  const add = (list) => ({
    claude: sum(list, (d) => (sources.includes('claude') ? d.claude : 0)),
    codex: sum(list, (d) => (sources.includes('codex') ? d.codex : 0)),
    pi: sum(list, (d) => (sources.includes('pi') ? d.pi : 0)),
  });
  const week = add(days.slice(-7));
  const cost7 = sum(SOURCES, (s) => week[s]);
  const allWeek = sum(days.slice(-7), (d) => d.claude + d.codex + d.pi);
  // Counts over the week scale with the view's share of the spend.
  const k = allWeek ? cost7 / allWeek : 0;
  const hours = demoHours(t, live.firstToday, scope);
  const messages7 = sum(hours.dates.slice(-7), (d) => d.messages);
  const today = hours.dates[hours.dates.length - 1];
  const tokensOn = (/** @type {Record<Source, number>} */ c) => sum(sources, (s) => c[s] * perUsd(s));
  const costOn = (/** @type {Record<Source, number>} */ c) => sum(sources, (s) => c[s]);

  // Where today's work happened, by hour of the day and day of the week, as the spend shows it.
  const pieces = spendPieces(t, live.firstToday, days[days.length - 1]);
  const monthAgo = midnightOf(t, 29);
  const byHour = Array.from({ length: 24 }, () => ({ cost: 0, tokens: 0 }));
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const p of pieces) {
    for (let at = Math.max(p.from, monthAgo); at < p.to; ) {
      const d = new Date(at);
      const next = Math.min(p.to, new Date(at).setMinutes(60, 0, 0));
      const cost = (next - at) * sum(sources, (s) => p.rate[s]);
      const tokens = (next - at) * sum(sources, (s) => p.rate[s] * perUsd(s));
      byHour[d.getHours()].cost += cost;
      byHour[d.getHours()].tokens += tokens;
      grid[d.getDay()][d.getHours()] += cost;
      at = next;
    }
  }

  // Average spend per weekday over the last four weeks, from your first real day.
  const last28 = days.slice(-28);
  const firstReal = Math.max(
    0,
    last28.findIndex((d) => costOn(d) >= 1),
  );
  const weekdays = Array.from({ length: 7 }, () => ({ total: 0, tokens: 0, count: 0, activeDays: 0 }));
  for (let i = firstReal; i < 28; i++) {
    const w = weekdays[new Date(midnightOf(t, 27 - i)).getDay()];
    w.total += costOn(last28[i]);
    w.tokens += tokensOn(last28[i]);
    w.count++;
    if (costOn(last28[i]) >= 0.01) w.activeDays++;
  }

  /** @type {Trend} */
  const trend = {
    days: days.map((c, i) => ({
      start: midnightOf(t, 29 - i),
      cost: cents(costOn(c)),
      tokens: Math.round(tokensOn(c)),
    })),
    hours: byHour.map((h) => ({ cost: h.cost, tokens: Math.round(h.tokens) })),
    grid: grid.map((row) => row.map(cents)),
    weekdays: {
      since: midnightOf(t, 27 - firstReal),
      today: { cost: costOn(days[days.length - 1]), tokens: Math.round(tokensOn(days[days.length - 1])) },
      days: weekdays.map((w) => ({
        cost: w.count ? w.total / w.count : 0,
        tokens: w.count ? w.tokens / w.count : 0,
        total: w.total,
        count: w.count,
        activeDays: w.activeDays,
      })),
    },
  };

  // Context: what each request carried this week, and the compactions.
  const requests = Math.round(cost7 * 11);
  /** @type {ContextHealth} */
  const context = {
    buckets: /** @type {[string, number | null, number, number][]} */ ([
      ['Under 50K', 50_000, 0.13, 0.05],
      ['50K–100K', 100_000, 0.31, 0.15],
      ['100K–200K', 200_000, 0.34, 0.31],
      ['200K–400K', 400_000, 0.18, 0.33],
      ['Over 400K', null, 0.04, 0.16],
    ]).map(([label, max, share, costShare]) => ({
      label,
      max,
      messages: Math.round(requests * share),
      cost: cost7 * costShare,
    })),
    messages: requests,
    cost: cost7,
    avgContext: scope === 'codex' ? 96_000 : scope === 'pi' ? 71_000 : 148_000,
    compactions: {
      count: Math.round(6 * k) + (scope === 'pi' ? 0 : live.compactions),
      auto: Math.round(5 * k) + (scope === 'pi' ? 0 : live.compactions),
      avgBefore: scope === 'codex' ? 231_000 : 172_000,
    },
  };

  /** @type {LongContext['sessions']} */
  const longSessions = /** @type {LongContext['sessions']} */ ([
    {
      id: 'demo-0',
      source: 'claude',
      title: 'Add full-text recipe search',
      project: 'kettle-api',
      cost: 21.6,
      surcharge: 0,
      messages: 118,
      peak: 612_000,
    },
    {
      id: 'demo-past-ratings',
      source: 'claude',
      title: 'Write the ratings migration',
      project: 'kettle-api',
      cost: 11.2,
      surcharge: 0,
      messages: 71,
      peak: 408_000,
    },
    {
      id: 'demo-4',
      source: 'codex',
      title: 'Add retries to the email digest job',
      project: 'kettle-jobs',
      cost: 5.6,
      surcharge: 3.1,
      messages: 25,
      peak: 301_000,
    },
  ]).filter(mine);
  /** @type {LongContext} */
  const longContext = {
    since: midnightOf(t, 6),
    spend: cost7,
    cost: sum(longSessions, (s) => s.cost) * 1.1,
    from: 200_000,
    count: longSessions.length + (scope === 'all' || scope === 'claude' ? 1 : 0),
    surcharge: {
      cost: sum(longSessions, (s) => s.surcharge),
      requests: longSessions.some((s) => s.surcharge) ? 22 : 0,
    },
    size: {
      cost: sum(longSessions, (s) => s.cost - s.surcharge) * 1.1,
      messages: sum(longSessions, (s) => s.messages) + 14,
    },
    sessions: longSessions,
  };

  // Tool calls this week: each source's at its own rate, and today's from the live counts.
  const byTool = sources
    .flatMap((s) =>
      TOOL_SHARE[s].map(([name, share, failed, denied]) => {
        const calls = Math.round(week[s] * (s === 'claude' ? 9 : 6) * share);
        return { name, calls, failed: Math.round(calls * failed), denied: Math.round(calls * denied) };
      }),
    )
    .filter((x) => x.calls > 0)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 8);
  /** @type {ToolFailures} */
  const tools = {
    calls: sum(byTool, (x) => x.calls),
    failed: sum(byTool, (x) => x.failed),
    denied: sum(byTool, (x) => x.denied),
    staleEdits: Math.round(5 * k),
    today: {
      calls: sum(sources, (s) => live.counts[s].tools),
      failed: sum(sources, (s) => live.counts[s].failed),
      denied: scope === 'all' || scope === 'claude' ? 1 : 0,
    },
    byTool,
    reasons: [
      { text: 'Tests failed', count: Math.round(17 * k) },
      { text: 'File or folder not found', count: Math.round(11 * k) },
      { text: 'String to replace not found in file.', count: Math.round(7 * k) },
      { text: 'File has not been read yet.', count: Math.round(5 * k) },
    ].filter((r) => r.count > 0),
  };

  // Your messages this week, and what they set off.
  const said = MESSAGES.filter(mine)
    .map(({ ago, ...m }) => ({ ...m, t: t - (ago < 12 ? ago * live.squeeze : ago) * H, partial: false }))
    .filter((m) => m.t >= midnightOf(t, 6));
  const shares = [0.18, 0.43, 0.27, 0.11, 0.01];
  /** @type {MessageStats} */
  const messageStats = {
    count: messages7,
    today: today.messages,
    activeDays: hours.dates.slice(-7).filter((d) => d.messages > 0).length,
    interrupts: Math.round(messages7 * 0.08),
    cost: cost7 * 0.86,
    partial: false,
    medianMs: messages7 ? (scope === 'codex' ? 2.1 : scope === 'pi' ? 1.6 : 3.2) * MIN : null,
    buckets: ['Under 1 min', '1–5 min', '5–15 min', '15–60 min', 'Over 1 hour'].map((label, i) => ({
      label,
      count: Math.round(messages7 * shares[i]),
    })),
    priciest: said.reduce(
      (/** @type {MessageSummary | null} */ best, m) => (!best || m.cost > best.cost ? m : best),
      null,
    ),
    longest: said.reduce((/** @type {MessageSummary | null} */ best, m) => (!best || m.ms > best.ms ? m : best), null),
    top: [...said].sort((a, b) => b.cost - a.cost).slice(0, 3),
  };

  const turns = Math.round(messages7 * 0.93);
  /** @type {TurnPerformance} */
  const turnPerformance = {
    count: turns,
    pending: sum(sources, (s) => live.working[s]),
    interrupted: Math.round(turns * 0.01),
    inferred: Math.round(turns * 0.58),
    medianMs: turns ? (scope === 'codex' ? 110_000 : scope === 'pi' ? 80_000 : 170_000) : null,
    p90Ms: turns ? (scope === 'codex' ? 520_000 : scope === 'pi' ? 400_000 : 840_000) : null,
    maxMs: turns ? (scope === 'codex' ? 1_900_000 : scope === 'pi' ? 1_100_000 : 4_080_000) : null,
    buckets: ['Under 1m', '1–5m', '5–15m', '15–60m', 'Over 1h'].map((label, i) => ({
      label,
      count: Math.round(turns * [0.2, 0.5, 0.2, 0.09, 0.01][i]),
    })),
  };

  // Waiting for your reply: about a minute for each message, by day and project.
  const waitDays = hours.dates.slice(-7).map((d) => ({
    start: d.start,
    ms: Math.round(d.messages * 1.1 * MIN),
    replies: d.messages,
  }));
  const projectWait = /** @type {[string, number][]} */ (
    sources.flatMap((s) => PROJECT_SHARE[s].map(([name, share]) => [name, share * (week[s] / Math.max(1, cost7))]))
  );
  /** @type {Map<string, number>} */
  const byProject = new Map();
  for (const [name, share] of projectWait) byProject.set(name, (byProject.get(name) || 0) + share);
  const waitMs = sum(waitDays, (d) => d.ms);
  const replies = sum(waitDays, (d) => d.replies);
  /** @type {WaitingStats} */
  const waiting = {
    ms: waitMs,
    replies,
    medianMs: replies ? 2.6 * MIN : null,
    away: Math.round(replies * 0.05),
    today: waitDays[waitDays.length - 1],
    days: waitDays,
    projects: [...byProject.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, share]) => ({ name, ms: Math.round(waitMs * share), replies: Math.round(replies * share) })),
    longest: LONG_WAITS.filter(mine).map(({ ago, ...w }) => ({
      ...w,
      t: t - (ago < 12 ? ago * live.squeeze : ago) * H,
    })),
  };

  // How many agents at once: now, today hour by hour, and the busiest moment this week.
  const atWork = live.atWork.filter(mine);
  const mainNow = atWork.filter((a) => a.kind === 'main').length;
  const agentHours = demoAgentHours(t, live.firstToday, scope, atWork.length);
  const calendarToday = agentHours.dates[agentHours.dates.length - 1];
  const hourNow = new Date(t).getHours();
  const todayWork = agentHours.days[agentHours.days.length - 1];
  const todayStretches = 'stretches' in todayWork && todayWork.stretches ? todayWork.stretches : [];
  const hourly = Array.from({ length: 24 }, (_, h) => {
    if (h > hourNow) return { max: 0, agentMs: 0 };
    const start = midnightOf(t) + h * H;
    const wall = totalMs(clip(todayStretches, start, start + H));
    const max =
      h === hourNow ? atWork.length : wall ? Math.max(1, Math.round(atWork.length * (0.35 + noise(h, 13) * 0.5))) : 0;
    return { max, agentMs: wall * Math.max(1, max * 0.6) };
  });
  const week7 = agentHours.dates.slice(-7);
  const busiest = week7.reduce((best, d) => ((d.peak || 0) > (best.peak || 0) ? d : best), week7[0]);
  const peakToday = {
    count: atWork.length,
    main: mainNow,
    sub: atWork.length - mainNow,
    at: atWork.length ? t - 2 * MIN : null,
  };
  const most = busiest.peak || 0;
  /** @type {ParallelWork} */
  const parallel = {
    peak:
      most > atWork.length && busiest.first && busiest.last
        ? {
            count: most,
            main: Math.ceil(most * 0.45),
            sub: most - Math.ceil(most * 0.45),
            at: Math.round((busiest.first + busiest.last) / 2),
          }
        : peakToday,
    peakToday,
    agentMs: sum(week7, (d) => d.agentMs),
    busyMs: sum(week7, (d) => d.wallMs),
    agentMsToday: sum(hourly, (h) => h.agentMs),
    busyMsToday: calendarToday.wallMs,
    hours: hourly,
  };

  return {
    breakdown: { d7: demoBreakdown(week), d30: demoBreakdown(add(days)) },
    trend,
    cache: { d7: demoCache(week), today: demoCache(add(days.slice(-1))) },
    context,
    longContext,
    tools,
    messages: messageStats,
    turnPerformance,
    waiting,
    parallel,
    hours,
    agentHours,
    windows: null,
    topSessions: topSessions(rows),
    timeline: demoTimeline(t, rows, hours, scope),
    skills: demoSkills(t, scope),
    repeats: demoRepeats(t, scope),
    computedAt: t,
  };
}

/**
 * Prompts typed again and again, ready to be commands.
 * @param {number} t
 * @param {ScopeName} scope
 * @returns {RepeatedPrompts}
 */
function demoRepeats(t, scope) {
  /**
   * @param {string} key @param {number} count @param {number} lastH @param {string[]} examples @param {string} body
   * @param {string} name @param {Partial<Record<Source, number>>} sources @param {string[]} projects
   * @returns {RepeatedPrompt}
   */
  const group = (key, count, lastH, examples, body, name, sources, projects) => ({
    key,
    count,
    sessions: count,
    days: count,
    lastAt: t - lastH * H,
    firstAt: t - 20 * DAY,
    words: body.split(' ').length,
    exact: examples.length === 1,
    sources,
    source: /** @type {Source} */ (Object.entries(sources).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0][0]),
    projects,
    examples,
    body,
    argument: body.includes('$ARGUMENTS'),
    name,
    description: examples[0].slice(0, 90),
    exists: { claude: false, codex: false, pi: false },
  });
  const groups = [
    group(
      'error handling naming pull request review tests',
      9,
      5,
      [
        'Review pull request 214: check the tests, naming and error handling, and list anything risky',
        'Review pull request 209: check the tests, naming and error handling, and list anything risky',
      ],
      'Review pull request $ARGUMENTS: check the tests, naming and error handling, and list anything risky',
      'review-pr',
      { claude: 9 },
      ['kettle-api', 'kettle-web'],
    ),
    group(
      'area grouped last merged notes release tag',
      4,
      30,
      ['Write release notes for everything merged since the last tag, grouped by area'],
      'Write release notes for everything merged since the last tag, grouped by area',
      'release-notes',
      { claude: 4 },
      ['kettle-web'],
    ),
    group(
      'expect fails fix run suite tests',
      5,
      52,
      ['Run the test suite and fix what fails, without changing what the tests expect'],
      'Run the test suite and fix what fails, without changing what the tests expect',
      'fix-tests',
      { claude: 3, codex: 2 },
      ['kettle-api', 'kettle-jobs'],
    ),
    group(
      'docs endpoint example missing',
      2,
      28,
      ['Find every endpoint in openapi.yaml without an example and write one'],
      'Find every endpoint in openapi.yaml without an example and write one',
      'missing-examples',
      { pi: 2 },
      ['kettle-docs'],
    ),
  ].filter((g) => scope === 'all' || (g.sources[scope] || 0) > 0);
  return { prompts: scope === 'all' ? 412 : scope === 'claude' ? 344 : scope === 'codex' ? 49 : 19, groups };
}

/**
 * Skills over 30 days: a few used a lot, by you or by the agent, and some never.
 * Pi has none.
 * @param {number} t
 * @param {ScopeName} scope
 * @returns {SkillUsage}
 */
function demoSkills(t, scope) {
  /** @type {UsedSkill[]} */
  const used = [
    {
      name: 'release-notes',
      source: 'claude',
      kind: 'personal',
      about: 'Draft release notes from the pull requests merged since the last tag.',
      uses: 14,
      you: 14,
      agent: 0,
      sessions: 14,
      days: 12,
      projects: ['kettle-web', 'kettle-api'],
      lastAt: t - 5 * H,
    },
    {
      name: 'db-migrations',
      source: 'claude',
      kind: 'project',
      project: 'kettle-api',
      about: 'How migrations are written, reviewed and backfilled in this repo.',
      uses: 9,
      you: 1,
      agent: 8,
      sessions: 6,
      days: 5,
      projects: ['kettle-api'],
      lastAt: t - 26 * H,
    },
    {
      name: 'chrome-devtools-mcp:a11y-debugging',
      source: 'claude',
      kind: 'plugin',
      plugin: 'chrome-devtools-mcp',
      about: 'Find and fix accessibility issues with Chrome DevTools.',
      uses: 6,
      you: 2,
      agent: 4,
      sessions: 3,
      days: 3,
      projects: ['kettle-web'],
      lastAt: t - 50 * H,
    },
    {
      name: 'anthropic-skills:docx',
      source: 'claude',
      kind: 'app',
      about: 'Create and edit Word documents.',
      uses: 3,
      you: 0,
      agent: 3,
      sessions: 2,
      days: 2,
      projects: [],
      lastAt: t - 4 * DAY,
    },
    {
      name: 'openai-docs',
      source: 'codex',
      kind: 'builtin',
      about: 'Up-to-date OpenAI docs with citations.',
      uses: 2,
      you: 0,
      agent: 2,
      sessions: 2,
      days: 2,
      projects: ['kettle-jobs'],
      lastAt: t - 6 * DAY,
    },
  ];
  /** @type {OfferedSkill[]} */
  const unused = [
    { name: 'tidy-imports', source: 'claude', kind: 'personal', about: 'Sort and prune the imports in changed files.' },
    {
      name: 'queue-patterns',
      source: 'claude',
      kind: 'project',
      project: 'kettle-jobs',
      about: 'Queues, retries and idempotency in the jobs worker.',
    },
    {
      name: 'chrome-devtools-mcp:memory-leak-debugging',
      source: 'claude',
      kind: 'plugin',
      plugin: 'chrome-devtools-mcp',
      about: 'Track down memory leaks in a page.',
    },
    { name: 'anthropic-skills:pptx', source: 'claude', kind: 'app', about: 'Create and edit slide decks.' },
    {
      name: 'security-review',
      source: 'claude',
      kind: 'builtin',
      about: 'Review the changes on this branch for security issues.',
    },
    { name: 'imagegen', source: 'codex', kind: 'builtin', about: 'Generate or edit images.' },
  ];
  const mine = used.filter((s) => scope === 'all' || s.source === scope);
  const offered = unused.filter((s) => scope === 'all' || s.source === scope);
  return {
    offered: scope === 'pi' ? null : mine.length + offered.length,
    usedCount: mine.length,
    uses: sum(mine, (s) => s.uses),
    used: mine,
    unused: offered,
  };
}

// ── Days on record, sessions and the digest ────────────────────────────────

/**
 * Seven months of days for the activity heatmap, oldest first: the last 30 as
 * the trend has them, and before that the same pattern a little quieter the
 * further back it goes (kept in ~/.overtime/history.json, as the server keeps
 * days it no longer has transcripts for). The dashboard wraps them as
 * /api/history's `days`.
 * @param {number} t
 * @param {ScopeName} [scope]
 * @returns {HistoryResponse['days']}
 */
export function demoHistory(t, scope = 'all') {
  return Array.from({ length: 210 }, (_, k) => {
    const ago = 209 - k;
    const midnight = midnightOf(t, ago);
    const s = dayStats(midnight, t, scope);
    // Usage grew over the months.
    const ramp = ago < 30 ? 1 : 1 - ((ago - 30) / 180) * 0.45;
    return {
      day: midnight,
      cost: cents(s.cost * ramp),
      tokens: Math.round(s.tokens * ramp),
      partial: false,
      activeMs: Math.round(s.activeMs),
      agentMs: Math.round(s.agentMs),
      messages: s.messages,
      sessions: s.sessions,
      ...(ago >= 30 ? { kept: /** @type {const} */ (true) } : {}),
    };
  });
}

// Finished sessions for the Sessions page, with their projects.
const PAST_TITLES = [
  ['Review open pull requests', 'kettle-web'],
  ['Triage error alerts', 'kettle-api'],
  ['Add pagination to the recipes API', 'kettle-api'],
  ['Write the ratings migration', 'kettle-api'],
  ['Speed up the recipe list query', 'kettle-api'],
  ['Dark mode for the settings page', 'kettle-web'],
  ['Explain the retry backoff', 'kettle-jobs'],
  ['Fix the cups-to-grams rounding', 'kettle-mobile'],
  ['Scheduled dependency audit', 'kettle-api'],
  ['Upgrade to Node 24', 'kettle-web'],
  ['Add a dead-letter queue', 'kettle-jobs'],
  ['Document the webhooks', 'kettle-docs'],
];

/**
 * A month of sessions for the demo's Sessions page, the same each time for a
 * given day: four of the live ones, and 38 finished. The dashboard reads them
 * as /api/sessions's `sessions`. Its numbers are in the golden tests' snapshot
 * (ui/src/lib/golden.test.ts), so the random numbers are drawn in the same order
 * as ever: change what's drawn and the snapshot changes.
 * @param {number} t
 * @returns {NonNullable<SessionsResponse['sessions']>}
 */
export function demoSessions(t) {
  let seed = Math.floor(t / DAY);
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const midnight = new Date(t).setHours(0, 0, 0, 0);
  /** @type {{ id: string, title: string, project: string, source: Source, ago: number }[]} */
  const list = CAST.slice(0, 4).map((x, i) => ({
    id: `demo-${i}`,
    title: x.title,
    project: x.project,
    source: x.source,
    ago: 0,
  }));
  for (let i = 0; i < 38; i++) {
    const [title, project] = PAST_TITLES[Math.floor(rand() * PAST_TITLES.length)];
    const ago = Math.floor(rand() ** 1.6 * 30);
    const r = rand();
    list.push({ title, project, id: `demo-past-${i}`, ago, source: r < 0.2 ? 'codex' : r > 0.86 ? 'pi' : 'claude' });
  }
  return list.map((x) => {
    const start = Math.min(t - 60_000, midnight - x.ago * DAY + (8 + rand() * 12) * H);
    const lastAt = Math.min(t - 30_000, start + (10 + rand() * 200) * MIN);
    const messages = 1 + Math.floor(rand() * 24);
    const cost = Math.round(messages * (0.2 + rand() * 1.4) * 100) / 100;
    const added = rand() < 0.2 ? 0 : Math.floor(rand() * 900);
    const tools = messages * (4 + Math.floor(rand() * 12));
    // Codex's model is the one it always uses; a draw for the others either way.
    const opus = x.source === 'codex' ? false : rand() < 0.7;
    const model =
      x.source === 'codex' ? 'GPT-6.1 Sol' : x.source === 'pi' ? 'Sonnet 5.5' : opus ? 'Opus 5.5' : 'Sonnet 5';
    const second =
      x.source === 'codex' ? 'GPT-6 Luna' : x.source === 'pi' ? 'GPT-6.1 Sol' : opus ? 'Sonnet 5' : 'Haiku 4.5';
    const subagents = rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0;
    // How full its context was at its last reply: mostly roomy, a few close to full.
    const window = windowOf(x.source === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5');
    const used = Math.round(window * (rand() < 0.15 ? 0.82 + rand() * 0.15 : 0.12 + rand() * 0.55));
    return {
      id: x.id,
      source: x.source,
      title: x.title,
      project: x.project,
      model,
      models: [
        { name: model, cost: cents(cost * 0.8), tokens: Math.round(cost * 0.8 * 2e6) },
        { name: second, cost: cents(cost * 0.2), tokens: Math.round(cost * 0.2 * 2e6) },
      ],
      startedAt: start,
      lastAt,
      // Pi has no subagents.
      subagents: x.source === 'pi' ? 0 : subagents,
      context: { used, window, pct: Math.round((used / window) * 100), at: lastAt },
      days: [
        {
          day: new Date(lastAt).setHours(0, 0, 0, 0),
          cost,
          subCost: Math.round(cost * rand() * 0.3 * 100) / 100,
          tokens: Math.round(cost * 2e6),
          messages,
          agentMs: messages * (1 + rand() * 6) * MIN,
          added,
          removed: Math.floor(added * rand() * 0.6),
          tools,
          failed: Math.floor(tools * rand() * 0.06),
          waitMs: messages * rand() * 4 * MIN,
          waits: Math.max(0, messages - 1),
        },
      ],
    };
  });
}

// The sessions a week in review lists, with their share of their source's spend.
/** @type {{ id: string, title: string, project: string, source: Source, share: number, messages: number, agentH: number }[]} */
const WEEK_SESSIONS = [
  {
    id: 'demo-week-1',
    title: 'Add pagination to the recipes API',
    project: 'kettle-api',
    source: 'claude',
    share: 0.15,
    messages: 24,
    agentH: 3.1,
  },
  {
    id: 'demo-week-2',
    title: 'Dark mode for the settings page',
    project: 'kettle-web',
    source: 'claude',
    share: 0.11,
    messages: 19,
    agentH: 2.4,
  },
  {
    id: 'demo-week-3',
    title: 'Add a dead-letter queue',
    project: 'kettle-jobs',
    source: 'codex',
    share: 0.4,
    messages: 11,
    agentH: 1.2,
  },
  {
    id: 'demo-week-4',
    title: 'Fix the cups-to-grams rounding',
    project: 'kettle-mobile',
    source: 'claude',
    share: 0.06,
    messages: 9,
    agentH: 0.9,
  },
];

/**
 * A week in review, in the shape /api/digest sends: last week (1) or this week so
 * far (0), each with the same days of the week before, from the same days as
 * the trend and the heatmap.
 * @param {number} t
 * @param {number} [weeksAgo]
 * @returns {WeeklyDigest}
 */
export function demoDigest(t, weeksAgo = 1) {
  const monday = new Date(t);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * weeksAgo);
  const from = monday.getTime();
  const to = weeksAgo ? new Date(from).setDate(monday.getDate() + 7) : new Date(t).setHours(24, 0, 0, 0);
  const days = Math.round((to - from) / DAY);
  /** @param {number} start @returns {DigestTotals} */
  const week = (start) => {
    const list = Array.from({ length: days }, (_, i) => {
      const midnight = new Date(start).setDate(new Date(start).getDate() + i);
      return { midnight, ...dayStats(midnight, t, 'all') };
    }).filter((d) => d.midnight <= t);
    /** @type {Record<Source, number>} */
    const bySource = {
      claude: cents(sum(list, (d) => d.bySource.claude)),
      codex: cents(sum(list, (d) => d.bySource.codex)),
      pi: cents(sum(list, (d) => d.bySource.pi)),
    };
    const cost = sum(SOURCES, (s) => bySource[s]);
    const agentMs = sum(list, (d) => d.agentMs);
    /** @type {Map<string, number>} */
    const projects = new Map();
    for (const s of SOURCES)
      for (const [name, share] of PROJECT_SHARE[s]) projects.set(name, (projects.get(name) || 0) + bySource[s] * share);
    const sessions = sum(list, (d) => d.sessions);
    const past = list.filter((d) => d.midnight < midnightOf(t));
    const busiest = list.reduce((best, d) => (!best || d.cost > best.cost ? d : best), list[0]);
    return {
      cost,
      partial: false,
      sessions,
      messages: sum(list, (d) => d.messages),
      agentMs,
      waitMs: sum(list, (d) => d.waitMs),
      waits: sum(list, (d) => d.waits),
      added: sum(list, (d) => d.added),
      removed: sum(list, (d) => d.removed),
      tools: sum(list, (d) => d.tools),
      failed: sum(list, (d) => d.failed),
      bySource,
      activeMs: sum(list, (d) => d.activeMs),
      projects: [...projects.entries()]
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, c]) => ({
          name,
          cost: cents(c),
          sessions: Math.max(1, Math.round((sessions * c) / Math.max(1, cost))),
          agentMs: (agentMs * c) / Math.max(1, cost),
        })),
      // The week's own sessions on the days before today, and today's live ones.
      topSessions: [
        ...WEEK_SESSIONS.map((s) => ({
          id: s.id,
          title: s.title,
          project: s.project,
          source: s.source,
          cost: cents(sum(past, (d) => d.bySource[s.source]) * s.share),
          messages: Math.max(1, Math.round((s.messages * past.length) / 7)),
          agentMs: ((s.agentH * past.length) / 7) * H,
        })).filter((s) => s.cost > 0),
        ...(list.length > past.length && liveDay ? liveDay.top : []),
      ]
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 3),
      busiest: busiest && busiest.cost > 0 ? [busiest.midnight, cents(busiest.cost)] : null,
    };
  };
  return {
    from,
    to,
    weeksAgo,
    days,
    ...week(from),
    before: week(from - 7 * DAY),
    // The windows that hit their limit: two last week, none yet this week.
    hits: { claude: weeksAgo ? 2 : 0, codex: 0 },
    computedAt: t,
  };
}

// ── The live simulation ────────────────────────────────────────────────────

/** @typedef {'think' | 'tool' | 'waiting' | 'question' | 'plan' | 'approval' | 'stuck' | 'done'} Phase */
/** @typedef {'read' | 'search' | 'edit' | 'bash' | 'web' | 'plan' | 'delegate' | 'other'} ToolKey */

/**
 * A simulated agent: what the snapshot shows of it, and what moves it on: what
 * it's doing, when it does the next thing, its turns and waits for the lane
 * chart, and what it (and its subagents) has cost, Codex's included.
 * @typedef {Omit<Agent, 'context'> & {
 *   context: Context, phase: Phase, nextAt: number, steps: number, budget: number, tl: TimelineState, failing: boolean,
 *   spent: number, subSpent: number, subTokens: number, ask: string, work: Span[], sub: Span[], waits: Span[],
 *   messages: number[],
 * }} Sim
 */

// Where each kind of tool call happens in the office, as lib/agents.js has it.
/** @type {Record<ToolCategory, { zone: OfficeZone, icon: string, verb: string, tl: TimelineState }>} */
const CATEGORIES = {
  edit: { zone: 'desk', icon: '⌨️', verb: 'Editing', tl: 'edit' },
  read: { zone: 'books', icon: '📖', verb: 'Reading', tl: 'read' },
  search: { zone: 'books', icon: '🔎', verb: 'Searching', tl: 'read' },
  bash: { zone: 'servers', icon: '💻', verb: 'Running', tl: 'bash' },
  web: { zone: 'web', icon: '🌐', verb: 'Browsing', tl: 'web' },
  plan: { zone: 'board', icon: '📝', verb: 'Planning', tl: 'plan' },
  delegate: { zone: 'meeting', icon: '📞', verb: 'Briefing', tl: 'delegate' },
  ask: { zone: 'desk', icon: '❓', verb: 'Asking you', tl: 'wait' },
  handback: { zone: 'desk', icon: '📄', verb: 'Handing in results', tl: 'edit' },
  other: { zone: 'files', icon: '🗂️', verb: 'Using', tl: 'other' },
};

/**
 * A tool call, named and described the way each harness does: Claude Code's
 * tools and Bash descriptions, Codex's exec_command and apply_patch with the
 * command itself, and Pi's lowercase tools.
 * @param {Sim} a @param {ToolKey} key @param {number} t
 * @returns {AgentTool}
 */
function toolCall(a, key, t) {
  const p = projectOf(a.project);
  const file = pick(p.files);
  const [said, command] = pick(p.runs);
  const pattern = pick(p.patterns);
  /** @type {[string, ToolCategory, string]} */
  let call;
  if (a.source === 'codex') {
    call =
      key === 'edit'
        ? ['apply_patch', 'edit', file]
        : key === 'read'
          ? ['exec_command', 'read', `sed -n 1,120p src/${file}`]
          : key === 'search'
            ? ['exec_command', 'search', `rg "${pattern}"`]
            : key === 'web'
              ? ['web_search', 'web', `${pattern} best practices`]
              : key === 'plan'
                ? ['update_plan', 'plan', 'updating the plan']
                : ['exec_command', 'bash', command];
  } else if (a.source === 'pi') {
    call =
      key === 'edit'
        ? ['edit', 'edit', file]
        : key === 'read'
          ? ['read', 'read', file]
          : key === 'search'
            ? ['grep', 'search', `"${pattern}"`]
            : ['bash', 'bash', command];
  } else {
    const [mcp, about] = pick(MCP);
    call =
      key === 'edit'
        ? [Math.random() < 0.2 ? 'Write' : 'Edit', 'edit', file]
        : key === 'read'
          ? ['Read', 'read', file]
          : key === 'search'
            ? ['Grep', 'search', `"${pattern}"`]
            : key === 'web'
              ? ['WebFetch', 'web', pick(HOSTS)]
              : key === 'plan'
                ? ['TodoWrite', 'plan', pick(p.plans)]
                : key === 'delegate'
                  ? ['Agent', 'delegate', pick(p.tasks)]
                  : key === 'other'
                    ? [mcp, 'other', about]
                    : ['Bash', 'bash', said];
  }
  const [name, category, detail] = call;
  const c = CATEGORIES[category];
  return { name, category, icon: c.icon, verb: c.verb, detail, startedAt: t };
}

/** What the agent mostly did in each of the last hour's 30 slots, at random. @returns {(TimelineState | null)[]} */
function pastHour() {
  /** @type {TimelineState} */
  let s = pick(/** @type {TimelineState[]} */ (['read', 'edit', 'bash', 'think', 'wait', 'web', 'plan']));
  return Array.from({ length: 30 }, (_, i) => {
    if (i < 6 && Math.random() < 0.6) return null;
    if (Math.random() < 0.35)
      s = weighted([
        ['read', 3],
        ['edit', 3],
        ['bash', 2],
        ['think', 2],
        ['wait', 2],
        ['web', 1],
        ['plan', 1],
        ['delegate', 0.5],
      ]);
    return s;
  });
}

/**
 * Start the simulation, sending a whole snapshot to `emit` now and every 0.4
 * seconds. The analytics in it are worked out again every 3 seconds; in between
 * they're the same objects, as the server's are between its passes.
 * @param {(snapshot: any) => void} emit called with a Snapshot (left loose so a test can take only the part it reads)
 * @param {{ workdayHour?: () => number }} [options] when your working day starts, if not at 4am
 */
export function startDemo(emit, { workdayHour } = {}) {
  if (workdayHour) dayHour = workdayHour;
  /** @type {Sim[]} */
  const agents = [];
  /** @type {FeedItem[]} */
  const feed = [];
  let feedId = 0;
  let internCount = 0;
  let compactions = 0;
  const now = () => Date.now();
  // Today's tool calls and lines changed before the demo started, by source; the agents add to them.
  /** @type {Record<Source, { tools: number, failed: number, added: number, removed: number }>} */
  const counts = {
    claude: { tools: 520, failed: 7, added: 1840, removed: 690 },
    codex: { tools: 64, failed: 1, added: 210, removed: 80 },
    pi: { tools: 28, failed: 0, added: 160, removed: 40 },
  };

  /** @param {Sim} a @param {string} icon @param {string} text @param {number} [t] */
  function log(a, icon, text, t = now()) {
    a.recent.push({ t, icon, text });
    a.recent.sort((x, y) => x.t - y.t);
    if (a.recent.length > 8) a.recent.shift();
    feed.push({ id: ++feedId, t, agentId: a.id, who: a.nick, seed: a.seed, kind: a.kind, icon, text });
    if (feed.length > 60) feed.shift();
  }

  /**
   * A new agent, with what it has done so far: turns since it started, each
   * followed by a short wait for you, its tokens to match its cost.
   * @param {string} id @param {string} nick @param {number} seed @param {Cast} cast
   * @param {{ kind?: 'main' | 'sub', parentId?: string | null, agentType?: string | null, cwd?: string | null }} [extra]
   * @returns {Sim}
   */
  function base(id, nick, seed, cast, extra = {}) {
    const t = now();
    const window = windowOf(cast.model);
    const startedAt = t - cast.startedH * H;
    /** @type {Span[]} */
    const work = [];
    /** @type {Span[]} */
    const waits = [];
    /** @type {number[]} */
    const messages = [];
    let at = startedAt;
    for (let k = 0; ; k++) {
      const len = (24 + ((seed + k * 13) % 7) * 7) * MIN;
      const wait = (3 + ((seed + k * 7) % 5) * 3) * MIN;
      messages.push(at);
      // This turn is the one going on now.
      if (at + len + wait + 5 * MIN >= t) break;
      work.push([at, at + len]);
      waits.push([at + len, at + len + wait]);
      at += len + wait;
    }
    const [input, output, cacheRead, cacheWrite] = PRICES[cast.model];
    // What it has used so far, in the usual mix, to add up to what it cost.
    const per = cast.cost / (0.9 * cacheRead + 0.06 * cacheWrite + 0.025 * output + 0.015 * input);
    const tokens = {
      input: Math.round(per * 0.015 * 1e6),
      output: Math.round(per * 0.025 * 1e6),
      cacheRead: Math.round(per * 0.9 * 1e6),
      cacheWrite: Math.round(per * 0.06 * 1e6),
      total: 0,
    };
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    const priced = cast.source !== 'codex';
    return {
      id,
      nativeId: id,
      kind: extra.kind || 'main',
      source: cast.source,
      parentId: extra.parentId ?? null,
      nick,
      seed,
      title: cast.title,
      project: cast.project,
      cwd: extra.cwd ?? `~/code/${cast.project}`,
      branch: cast.branch,
      model: cast.model,
      modelName: cast.modelName,
      entrypoint: cast.entrypoint,
      background: cast.entrypoint.startsWith('sdk'),
      agentType: extra.agentType ?? null,
      status: 'thinking',
      zone: 'desk',
      needsYou: null,
      tool: null,
      lastTool: null,
      turnStartedAt: at,
      endedAt: waits.length ? waits[waits.length - 1][0] : 0,
      endReason: waits.length ? 'done' : null,
      startedAt,
      lastActivity: t,
      snippet: waits.length ? pick(projectOf(cast.project).replies) : null,
      counts: {},
      turns: messages.length,
      tokens,
      // Live, Codex reports tokens but not what they cost.
      cost: priced ? cast.cost : null,
      costKnown: priced,
      context: { used: Math.round(window * between(0.12, 0.45)), window, pct: 0 },
      compactions: 0,
      lastCompactAt: 0,
      errors: 0,
      lastErrorAt: 0,
      results: [],
      files: [],
      lines: { added: 0, removed: 0 },
      timeline: pastHour(),
      recent: [],
      present: true,
      internCost: 0,
      resumeCommand: null,
      phase: 'think',
      nextAt: t + between(500, 2500),
      steps: 0,
      budget: 0,
      tl: 'think',
      failing: false,
      spent: cast.cost,
      subSpent: 0,
      subTokens: 0,
      ask: pick(projectOf(cast.project).asks),
      work,
      sub: [],
      waits,
      messages,
    };
  }

  // Today so far, from your first message. Early in the day it's short, so the
  // sessions' past is squeezed into it.
  let first = firstMessageToday(now());
  let firstDay = workDay(now());
  const squeeze = () => Math.max(0.1, Math.min(1, (now() - first - 10 * MIN) / (4.4 * H)));
  const k0 = squeeze();
  CAST.forEach((c, i) => {
    agents.push(base(`demo-${i}`, c.nick, 1000 + i * 7919, { ...c, startedH: c.startedH * k0 }));
  });
  const [grace, linus, katherine, hedy, , audit, , barbara, dennis] = agents;
  const t = now();
  // Linus is nearly out of context, so he compacts soon.
  linus.context.used = 905_000;
  // Katherine has a plan for you to review.
  Object.assign(katherine, {
    status: 'working',
    zone: 'board',
    needsYou: 'plan',
    tool: { ...toolCall(katherine, 'plan', t - 95_000), name: 'ExitPlanMode', detail: 'plan ready for review' },
    phase: 'plan',
    tl: 'plan',
    nextAt: t + between(55_000, 75_000),
  });
  // Hedy finished her turn a few minutes ago.
  hedy.waits.pop();
  Object.assign(hedy, {
    status: 'waiting',
    zone: 'lounge',
    needsYou: 'turn',
    endedAt: t - 260_000,
    endReason: 'done',
    snippet: projectOf(hedy.project).replies[0],
    phase: 'waiting',
    tl: 'wait',
    nextAt: t + between(50_000, 70_000),
  });
  hedy.work.push([/** @type {number} */ (hedy.turnStartedAt), hedy.endedAt]);
  // Barbara asks you something.
  Object.assign(barbara, {
    status: 'working',
    zone: 'desk',
    needsYou: 'question',
    ask: 'Should the list sync as soon as the phone is back online?',
    phase: 'question',
    tl: 'wait',
    nextAt: t + between(40_000, 55_000),
  });
  barbara.tool = {
    name: 'AskUserQuestion',
    category: 'ask',
    icon: '❓',
    verb: 'Asking you',
    detail: barbara.ask,
    startedAt: t - 70_000,
  };
  // Dennis waits for you to approve an edit.
  Object.assign(dennis, {
    status: 'working',
    zone: 'desk',
    needsYou: 'approval',
    tool: { ...toolCall(dennis, 'edit', t - 48_000), name: 'Edit', detail: 'cache.ts' },
    phase: 'approval',
    tl: 'edit',
    nextAt: t + between(30_000, 45_000),
  });
  // And the dependency audit keeps failing the same command, so it shows as stuck.
  const stuckTool = {
    name: 'Bash',
    category: /** @type {ToolCategory} */ ('bash'),
    icon: '💻',
    verb: 'Running',
    detail: 'npm audit fix',
    startedAt: t - 40_000,
  };
  Object.assign(audit, {
    status: 'working',
    zone: 'servers',
    tool: stuckTool,
    phase: 'stuck',
    tl: 'bash',
    nextAt: Infinity,
    errors: 5,
    lastErrorAt: t - 40_000,
    results: [[t - 540_000, 1, 'Read'], ...[430, 330, 230, 140, 40].map((s) => [t - s * 1000, 0, 'Bash'])],
  });
  // What each has done lately, for the office's feed and cards, oldest first.
  /** @type {[Sim, string, string, number][]} */
  const lately = [];
  for (const a of agents) {
    lately.push([a, '💬', 'Got a new task', a.turnStartedAt || t]);
    if (a.tool) {
      a.lastTool = a.tool;
      lately.push([a, a.tool.icon, `${a.tool.verb} ${a.tool.detail}`, a.tool.startedAt]);
    }
  }
  lately.push([hedy, '✅', 'Done, waiting for you', hedy.endedAt]);
  for (const [a, icon, text, at] of lately.sort((x, y) => x[3] - y[3])) log(a, icon, text, at);
  // Grace has two subagents out already.
  spawnIntern(grace, projectOf(grace.project).tasks[0], t - 50_000);
  spawnIntern(grace, projectOf(grace.project).tasks[1], t - 20_000);
  feed.sort((x, y) => x.t - y.t);
  feed.forEach((f, i) => {
    f.id = i + 1;
  });

  /**
   * Tokens and money for one request with `a`'s context, at its model's prices.
   * @param {Sim} a @param {number} [scale]
   */
  function spend(a, scale = 1) {
    const [inP, outP, readP, writeP] = PRICES[a.model || ''] || PRICES['claude-sonnet-5'];
    // A step of the demo is quicker than a real request, so it reads only part of the context.
    const read = Math.round(a.context.used * 0.15 * scale);
    const write = Math.round(between(1000, 5000) * scale);
    const fresh = Math.round(between(80, 300) * scale);
    const out = Math.round(between(150, 700) * scale);
    const cost = (read * readP + write * writeP + fresh * inP + out * outP) / 1e6;
    a.tokens.input += fresh;
    a.tokens.output += out;
    a.tokens.cacheRead += read;
    a.tokens.cacheWrite += write;
    a.tokens.total = a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite;
    a.context.used = Math.min(a.context.window, a.context.used + write + out);
    a.spent += cost;
    if (a.cost != null) a.cost += cost;
    const parent = a.parentId ? agents.find((x) => x.id === a.parentId) : null;
    if (parent) {
      parent.subSpent += cost;
      parent.subTokens += read + write + fresh + out;
    }
    // Close to full: compact back down, as Claude Code does.
    if (a.context.used / a.context.window > 0.93) {
      a.context.used = Math.round(a.context.window * 0.18);
      a.compactions++;
      a.lastCompactAt = now();
      compactions++;
      log(a, '🧹', 'Compacted its context');
    }
  }

  /** @param {Sim} a @param {ToolKey} key */
  function useTool(a, key) {
    const t = now();
    const tool = toolCall(a, key, t);
    a.tool = tool;
    a.lastTool = tool;
    a.status = 'working';
    a.zone = CATEGORIES[tool.category].zone;
    a.tl = CATEGORIES[tool.category].tl;
    a.counts[tool.category] = (a.counts[tool.category] || 0) + 1;
    a.phase = 'tool';
    a.nextAt = t + (key === 'bash' ? between(2500, 6000) : between(1200, 3200));
    counts[a.source].tools++;
    spend(a);
    log(a, tool.icon, key === 'other' ? `Using ${tool.name} · ${tool.detail}` : `${tool.verb} ${tool.detail}`);
    if (key === 'edit') {
      const added = Math.round(between(2, 40));
      const removed = Math.round(between(0, 20));
      const file = a.files.find((f) => f.name === tool.detail) || {
        path: `${a.cwd}/src/${tool.detail}`,
        name: tool.detail,
        edits: 0,
        added: 0,
        removed: 0,
      };
      file.edits++;
      file.added += added;
      file.removed += removed;
      a.files = [file, ...a.files.filter((f) => f !== file)].slice(0, 8);
      a.lines.added += added;
      a.lines.removed += removed;
      counts[a.source].added += added;
      counts[a.source].removed += removed;
    }
    if (key === 'bash' && Math.random() < 0.12) {
      a.failing = true;
      a.errors++;
      a.lastErrorAt = t;
      counts[a.source].failed++;
      log(a, '⚠️', 'A command failed');
    }
    if (key === 'delegate') spawnIntern(a, tool.detail);
    // Now and then an edit or an MCP call waits for your approval.
    if ((key === 'edit' || key === 'other') && a.kind === 'main' && !a.background && a.source === 'claude') {
      if (Math.random() < 0.06)
        Object.assign(a, { needsYou: 'approval', phase: 'approval', nextAt: t + between(9000, 16000) });
    }
  }

  /** @param {Sim} parent @param {string} task @param {number} [t] */
  function spawnIntern(parent, task, t = now()) {
    const active = agents.filter((x) => x.parentId === parent.id && x.status !== 'done').length;
    if (active >= 2 || parent.source !== 'claude') return;
    const n = internCount++;
    const intern = base(
      `demo-intern-${n}`,
      INTERN_NAMES[n % INTERN_NAMES.length],
      5000 + n * 104729,
      {
        ...CAST[0],
        title: task,
        project: parent.project || 'kettle-api',
        branch: parent.branch || 'main',
        entrypoint: parent.entrypoint || 'cli',
        model: 'claude-haiku-4-5',
        modelName: 'Haiku 4.5',
        source: 'claude',
        startedH: (now() - t) / H,
        cost: 0,
      },
      { kind: 'sub', parentId: parent.id, agentType: 'Explore', cwd: parent.cwd },
    );
    Object.assign(intern, {
      budget: 4 + Math.floor(Math.random() * 4),
      timeline: new Array(30).fill(null),
      turns: 1,
      snippet: null,
      endedAt: 0,
      endReason: null,
      context: { used: 12_000, window: 200_000, pct: 6 },
    });
    agents.push(intern);
    log(intern, '💬', 'Got an assignment', t);
  }

  /** @param {Sim} a */
  function endTurn(a) {
    const t = now();
    a.tool = null;
    a.endedAt = t;
    a.endReason = 'done';
    a.tl = 'wait';
    if (a.kind === 'sub') {
      Object.assign(a, { status: 'done', zone: 'desk', needsYou: null, phase: 'done', nextAt: t + 20000 });
      const parent = agents.find((x) => x.id === a.parentId);
      if (parent) parent.sub.push([a.startedAt, t]);
      log(a, '✅', 'Finished the assignment');
      return;
    }
    a.work.push([/** @type {number} */ (a.turnStartedAt), t]);
    a.snippet = pick(projectOf(a.project).replies);
    Object.assign(a, {
      status: 'waiting',
      zone: 'lounge',
      needsYou: 'turn',
      phase: 'waiting',
      nextAt: t + between(18000, 40000),
    });
    log(a, '✅', 'Done, waiting for you');
  }

  /** @param {Sim} a @param {AgentTool} tool @param {'question' | 'plan'} why @param {number} ms */
  function needYou(a, tool, why, ms) {
    a.tool = tool;
    a.lastTool = tool;
    Object.assign(a, {
      status: 'working',
      zone: CATEGORIES[tool.category].zone,
      needsYou: why,
      phase: why,
      tl: why === 'plan' ? 'plan' : 'wait',
      nextAt: now() + ms,
    });
    log(a, tool.icon, `${tool.verb} ${tool.detail}`);
  }

  let lastShift = now();
  /** @type {Snapshot['analytics'] | null} */
  let analytics = null;
  /** @type {LimitsEstimate | null} */
  let limits = null;
  let analyticsAt = 0;

  /**
   * Today's sessions: the agents', with their subagents' cost, and the ones
   * that finished before the demo started.
   * @param {number} t
   * @returns {Row[]}
   */
  function todayRows(t) {
    const from = Math.max(first, t - 8 * H);
    const at = (/** @type {number} */ h) => Math.round(from + (h / 8) * (t - from));
    /** @type {Row[]} */
    const rows = agents
      .filter((a) => a.kind === 'main')
      .map((a) => {
        const open = a.status === 'waiting' ? [] : [/** @type {Span} */ ([a.turnStartedAt || t, t])];
        const subs = agents.filter((x) => x.parentId === a.id && x.status !== 'done');
        return {
          id: a.id,
          source: a.source,
          title: a.title,
          project: a.project || 'kettle-api',
          cost: a.spent + a.subSpent,
          subCost: a.subSpent,
          tokens: a.tokens.total + a.subTokens,
          added: a.lines.added + Math.round(a.spent * 9),
          removed: a.lines.removed + Math.round(a.spent * 3),
          used: a.context.used,
          inOffice: true,
          last: a.lastActivity,
          work: [...a.work, ...open],
          sub: [...a.sub, ...subs.map((x) => /** @type {Span} */ ([x.startedAt, t]))],
          waits: a.status === 'waiting' ? [...a.waits, [a.endedAt, t]] : a.waits,
          messages: a.messages,
        };
      });
    for (const e of EARLIER) {
      const work = e.work.map(([x, y]) => /** @type {Span} */ ([at(x), at(y)]));
      rows.push({
        id: e.id,
        source: e.source,
        title: e.title,
        project: e.project,
        cost: e.cost,
        subCost: e.subCost,
        tokens: Math.round(e.cost * perUsd(e.source)),
        added: e.added,
        removed: e.removed,
        used: e.used,
        inOffice: false,
        last: Math.max(...work.map((x) => x[1])),
        work,
        sub: e.sub.map(([x, y]) => [at(x), at(y)]),
        waits: e.waits.map(([x, y]) => [at(x), at(y)]),
        messages: e.messages.map(at),
      });
    }
    return rows;
  }

  /**
   * Every provider view's analytics and Claude Code's limits, from today's
   * sessions and the days before.
   * @param {number} t
   */
  function workOut(t) {
    // A new working day while the demo runs starts again from its own first message.
    if (workDay(t) !== firstDay) {
      firstDay = workDay(t);
      first = firstMessageToday(t);
    }
    const rows = todayRows(t);
    const earlier = earlierWindow(t);
    const firstToday = first;
    /** @type {Record<Source, number>} */
    const today = { claude: 0, codex: 0, pi: 0 };
    for (const r of rows) today[r.source] += r.cost;
    const days = Array.from({ length: 30 }, (_, i) => (i === 29 ? today : costsOf(dayPlan(midnightOf(t, 29 - i), t))));
    const pieces = spendPieces(t, firstToday, today);
    /** @type {Record<Source, number>} */
    const working = { claude: 0, codex: 0, pi: 0 };
    for (const a of agents) if (a.kind === 'main' && a.phase !== 'waiting') working[a.source]++;
    /** @type {Live} */
    const live = {
      rows,
      firstToday,
      squeeze: squeeze(),
      atWork: agents
        .filter((a) => !a.needsYou && ['thinking', 'working', 'replying'].includes(a.status))
        .map((a) => ({ source: a.source, kind: a.kind })),
      counts,
      compactions,
      working,
    };
    /** @param {ScopeName} scope @returns {AnalyticsView} */
    const view = (scope) => {
      const sources = sourcesOf(scope);
      const mine = rows.filter((r) => sources.includes(r.source));
      /** @type {ActivitySummary} */
      const activity = {
        tokens: sum(mine, (r) => r.tokens),
        cost: sum(mine, (r) => r.cost),
        costPartial: false,
        tools: sum(sources, (s) => counts[s].tools),
        added: sum(sources, (s) => counts[s].added),
        removed: sum(sources, (s) => counts[s].removed),
        sessions: mine.length,
        sessionList: todayList(mine),
      };
      return {
        insights: demoInsights(t, scope, live, days),
        spend: demoSpend(t, sources, today, pieces),
        today: activity,
      };
    };
    const claude = view('claude');
    const all = view('all');
    const claudeSpend = /** @type {SpendSummary} */ (claude.spend);
    limits = demoLimits(t, pieces, claudeSpend, earlier);
    // Only Claude Code's own view has its 5-hour windows, as on the server.
    if (claude.insights)
      claude.insights = {
        ...claude.insights,
        windows: demoWindows(
          t,
          claude.insights.hours,
          limits.session,
          earlier,
          Math.max(12, today.claude - SESSION.used),
        ),
      };
    analytics = { all, claude, codex: view('codex'), pi: view('pi') };
    const hoursToday = all.insights?.hours.dates.at(-1);
    liveDay = {
      cost: today,
      tokens: {
        claude: today.claude * perUsd('claude'),
        codex: today.codex * perUsd('codex'),
        pi: today.pi * perUsd('pi'),
      },
      messages: hoursToday?.messages || 0,
      activeMs: hoursToday?.activeMs || 0,
      agentMs: all.insights?.agentHours.dates.at(-1)?.agentMs || 0,
      sessions: rows.length,
      tools: sum(SOURCES, (s) => counts[s].tools),
      failed: sum(SOURCES, (s) => counts[s].failed),
      added: sum(SOURCES, (s) => counts[s].added),
      removed: sum(SOURCES, (s) => counts[s].removed),
      top: rows.map((r) => ({
        id: r.id,
        title: r.title,
        project: r.project,
        source: r.source,
        cost: cents(r.cost),
        messages: r.messages.length,
        agentMs: totalMs(union(r.work)),
      })),
    };
  }

  /**
   * The agent processes on this Mac: a Claude Code process for each Claude
   * session, Pi's own, and the Codex app running its chats in one process. Plus
   * two older sessions left open and one with no messages yet.
   * @param {number} t
   * @returns {OpenSessions}
   */
  function openSessions(t) {
    /** @param {Sim} a @returns {'needs' | 'working' | 'idle'} */
    const status = (a) =>
      a.needsYou ? 'needs' : ['working', 'thinking', 'replying'].includes(a.status) ? 'working' : 'idle';
    const mains = agents.filter((a) => a.kind === 'main');
    /** @type {OpenSession[]} */
    const sessions = mains
      .filter((a) => a.source !== 'codex' && !a.background)
      .map((a, i) => ({
        pid: (a.source === 'pi' ? 5200 : 4100) + i,
        source: a.source,
        shared: false,
        id: a.id,
        title: a.title,
        project: a.project,
        openedAt: a.startedAt,
        lastActive: a.lastActivity,
        status: status(a),
        inOffice: true,
        memBytes: (210 + i * 23) * 1024 ** 2,
        toolsMemBytes: (a.source === 'pi' ? 40 : 280 + i * 17) * 1024 ** 2,
        tools: a.source === 'pi' ? 1 : 6 + (i % 2),
        cpuPct: 0.6 + i * 0.7,
      }));
    for (const a of mains.filter((x) => x.source === 'codex'))
      sessions.push({
        id: a.id,
        source: a.source,
        title: a.title,
        project: a.project,
        status: status(a),
        openedAt: a.startedAt,
        lastActive: a.lastActivity,
        memBytes: null,
        toolsMemBytes: null,
        cpuPct: null,
        runtimeShared: true,
      });
    /** @type {OpenProcess[]} */
    const old = [
      {
        pid: 4200,
        source: 'claude',
        shared: false,
        id: 'demo-e1',
        title: 'Review open pull requests',
        project: 'kettle-web',
        openedAt: t - 9 * H,
        lastActive: t - 5.5 * H,
        status: 'idle',
        inOffice: false,
        memBytes: 231 * 1024 ** 2,
        toolsMemBytes: 296 * 1024 ** 2,
        tools: 7,
        cpuPct: 0.5,
      },
      {
        pid: 4201,
        source: 'claude',
        shared: false,
        id: 'demo-e2',
        title: 'Triage error alerts',
        project: 'kettle-api',
        openedAt: t - 27 * H,
        lastActive: t - 4.6 * H,
        status: 'idle',
        inOffice: false,
        memBytes: 244 * 1024 ** 2,
        toolsMemBytes: 301 * 1024 ** 2,
        tools: 7,
        cpuPct: 0.9,
      },
      {
        pid: 4202,
        source: 'claude',
        shared: false,
        id: null,
        title: null,
        project: 'kettle-mobile',
        openedAt: t - 40 * MIN,
        lastActive: null,
        status: 'new',
        inOffice: false,
        memBytes: 188 * 1024 ** 2,
        toolsMemBytes: 290 * 1024 ** 2,
        tools: 6,
        cpuPct: 0.4,
      },
    ];
    sessions.push(...old);
    const order = { needs: 0, working: 1, idle: 2, new: 3 };
    sessions.sort(
      (a, b) =>
        order[a.status] - order[b.status] || (b.lastActive || b.openedAt || 0) - (a.lastActive || a.openedAt || 0),
    );
    return {
      sampledAt: t - 4000,
      everyMs: 10_000,
      sessions,
      sharedRuntimes: [
        {
          pid: 3901,
          source: 'codex',
          shared: true,
          id: null,
          title: null,
          project: null,
          openedAt: t - 6 * H,
          lastActive: null,
          status: 'new',
          inOffice: false,
          memBytes: 640 * 1024 ** 2,
          toolsMemBytes: 180 * 1024 ** 2,
          tools: 3,
          cpuPct: 4.2,
        },
      ],
    };
  }

  /** What the snapshot shows of an agent, field by field. @param {Sim} a @returns {Agent} */
  const agentView = (a) => ({
    id: a.id,
    nativeId: a.nativeId,
    kind: a.kind,
    source: a.source,
    parentId: a.parentId,
    nick: a.nick,
    seed: a.seed,
    title: a.title,
    project: a.project,
    cwd: a.cwd,
    branch: a.branch,
    model: a.model,
    modelName: a.modelName,
    entrypoint: a.entrypoint,
    background: a.background,
    agentType: a.agentType,
    status: a.status,
    zone: a.zone,
    needsYou: a.needsYou,
    tool: a.tool && { ...a.tool },
    lastTool: a.lastTool && {
      name: a.lastTool.name,
      icon: a.lastTool.icon,
      verb: a.lastTool.verb,
      detail: a.lastTool.detail,
    },
    turnStartedAt: a.turnStartedAt,
    endedAt: a.endedAt,
    endReason: a.endReason,
    startedAt: a.startedAt,
    lastActivity: a.lastActivity,
    snippet: a.snippet,
    counts: { ...a.counts },
    turns: a.turns,
    tokens: { ...a.tokens },
    cost: a.cost,
    costKnown: a.costKnown,
    context: {
      used: a.context.used,
      window: a.context.window,
      pct: Math.min(100, Math.round((a.context.used / a.context.window) * 100)),
    },
    compactions: a.compactions,
    lastCompactAt: a.lastCompactAt,
    errors: a.errors,
    lastErrorAt: a.lastErrorAt,
    results: [...a.results],
    files: a.files.map((f) => ({ ...f })),
    lines: { ...a.lines },
    timeline: [...a.timeline],
    recent: [...a.recent],
    present: a.present,
    internCost: a.kind === 'main' ? a.subSpent : 0,
    resumeCommand: a.resumeCommand,
  });

  function tick() {
    const t = now();
    const shift = t - lastShift > 120000;
    if (shift) lastShift = t;
    for (const a of [...agents]) {
      if (shift) a.timeline = [...a.timeline.slice(1), a.tl];
      // The stuck one tries its command again every minute and a half, and fails.
      if (a.phase === 'stuck' && a.tool && t - a.tool.startedAt > 90_000) {
        a.results.push([t, 0, 'Bash']);
        if (a.results.length > 12) a.results.shift();
        a.errors++;
        a.lastErrorAt = t;
        a.lastActivity = t;
        a.tool = { ...a.tool, startedAt: t };
        counts.claude.failed++;
        log(a, '⚠️', 'npm audit fix failed again');
      }
      if (t < a.nextAt) continue;
      a.lastActivity = t;
      if (a.phase === 'done') {
        agents.splice(agents.indexOf(a), 1);
        continue;
      }
      if (a.phase === 'waiting') {
        // You replied: a new turn.
        a.waits.push([a.endedAt, t]);
        a.messages.push(t);
        Object.assign(a, {
          status: 'thinking',
          zone: 'desk',
          needsYou: null,
          turnStartedAt: t,
          steps: 0,
          phase: 'think',
          tl: 'think',
          nextAt: t + between(1500, 3000),
        });
        a.turns++;
        log(a, '💬', 'Got a new task');
        continue;
      }
      if (a.phase === 'question' || a.phase === 'plan') {
        // You answered, or approved the plan.
        a.results.push([t, 1, a.tool?.name || 'Tool']);
        if (a.results.length > 12) a.results.shift();
        Object.assign(a, {
          needsYou: null,
          status: 'thinking',
          zone: 'desk',
          tool: null,
          phase: 'think',
          tl: 'think',
          nextAt: t + between(1000, 2000),
        });
        continue;
      }
      if (a.phase === 'approval') {
        // You approved it, so the call goes ahead.
        Object.assign(a, { needsYou: null, phase: 'tool', nextAt: t + between(1200, 2500) });
        continue;
      }
      if (a.phase === 'tool') {
        a.results.push([t, a.failing ? 0 : 1, a.tool?.name || 'Tool']);
        if (a.results.length > 12) a.results.shift();
        a.failing = false;
        a.status = Math.random() < 0.15 ? 'replying' : 'thinking';
        a.tool = null;
        a.phase = 'think';
        a.nextAt = t + between(900, 2600);
        continue;
      }
      a.steps++;
      if (a.kind === 'sub') {
        if (a.steps > a.budget) endTurn(a);
        else
          useTool(
            a,
            weighted([
              ['read', 4],
              ['search', 3],
              ['bash', 1],
            ]),
          );
        continue;
      }
      const asks = a.source === 'claude' && !a.background;
      if (a.steps > 7 && Math.random() < 0.18) {
        endTurn(a);
      } else if (asks && a.steps === 2 && Math.random() < 0.1) {
        // A plan first, for you to review.
        needYou(
          a,
          { ...toolCall(a, 'plan', t), name: 'ExitPlanMode', detail: 'plan ready for review' },
          'plan',
          between(14000, 24000),
        );
      } else if (asks && a.steps > 3 && Math.random() < 0.05) {
        a.ask = pick(projectOf(a.project).asks);
        needYou(
          a,
          { name: 'AskUserQuestion', category: 'ask', icon: '❓', verb: 'Asking you', detail: a.ask, startedAt: t },
          'question',
          between(10000, 20000),
        );
      } else {
        const key = weighted(
          /** @type {[ToolKey, number][]} */ (
            a.source === 'pi'
              ? [
                  ['read', 3],
                  ['search', 2],
                  ['edit', 3],
                  ['bash', 2],
                ]
              : a.source === 'codex'
                ? [
                    ['read', 3],
                    ['search', 2],
                    ['edit', 3],
                    ['bash', 3],
                    ['web', 0.5],
                    ['plan', 0.7],
                  ]
                : [
                    ['read', 3],
                    ['search', 2],
                    ['edit', 3],
                    ['bash', 2],
                    ['web', 1],
                    ['plan', 1],
                    ['delegate', 0.7],
                    ['other', 0.4],
                  ]
          ),
        );
        useTool(a, key);
      }
    }
    for (const a of agents) a.timeline[29] = a.tl;
    if (!analytics || !limits || t - analyticsAt >= 3000) {
      workOut(t);
      analyticsAt = t;
    }
    /** @type {Snapshot} */
    const snapshot = {
      now: t,
      watching: ['demo (simulated agents)'],
      openSessions: openSessions(t),
      limits,
      analytics: /** @type {Snapshot['analytics']} */ (analytics),
      codexLimits: demoCodexLimits(t),
      prefs: { workdayHour: dayHour(), search: true },
      agents: agents.map(agentView),
      feed: [...feed],
    };
    emit(snapshot);
  }

  tick();
  setInterval(tick, 400);
}
