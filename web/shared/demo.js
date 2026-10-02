// Simulated agents for /?demo, producing the same snapshot shape as the server.

const SESSIONS = [
  { nick: 'Grace', title: 'Refactor survey scoring service', project: 'thrive-backend', branch: 'feat/scoring', entrypoint: 'claude-desktop', model: 'claude-opus-5-5' },
  { nick: 'Linus', title: 'Fix flaky pulse survey tests', project: 'thrive-backend', branch: 'fix/flaky-tests', entrypoint: 'claude-vscode', model: 'claude-sonnet-5' },
  { nick: 'Ada', title: 'Build member CSV import', project: 'Member-Management', branch: 'main', entrypoint: 'cli', model: 'claude-opus-5-5' },
  { nick: 'Hedy', title: 'Upgrade the web app to React 19', project: 'thrive-web', branch: 'chore/react-19', entrypoint: 'claude-desktop', model: 'claude-opus-5-5' },
  { nick: 'Ken', title: 'Explain the job queue retries', project: 'distributed-job-queue', branch: 'main', entrypoint: 'codex', model: 'gpt-5-codex', source: 'codex' },
  { nick: 'Tim', title: 'Nightly dependency audit', project: 'thrive-backend', branch: 'main', entrypoint: 'sdk-cli', model: 'claude-haiku-4-5' },
];
const INTERN_NAMES = ['Radia', 'Brendan', 'Frances', 'Guido', 'Joan', 'Niklaus'];
const FILES = ['scoring.service.ts', 'pulse.controller.ts', 'users.repo.ts', 'App.tsx', 'schema.prisma', 'import.worker.ts', 'README.md', 'package.json', 'survey.test.ts'];
const COMMANDS = ['Run unit tests', 'Install dependencies', 'Check git status', 'Run database migration', 'Lint the project', 'Build the app'];
const HOSTS = ['docs.nestjs.com', 'react.dev', 'github.com', 'nodejs.org', 'developer.mozilla.org'];
const SEARCHES = ['"calculateScore"', '"TODO"', '**/*.test.ts', '"useEffect"', '"importMembers"'];
const PLANS = ['Map the scoring flow', 'Write the migration', 'Update the tests', 'Check edge cases'];
const TASKS = ['Map the API routes', 'Find every score caller', 'Review test coverage', 'Check CSV edge cases'];
const REPLIES = ['All tests pass now. The flaky one was a shared timer between two suites.', 'The scoring service is split into three smaller functions with the same results.', 'Import now handles empty rows and duplicate emails.'];

const TOOLS = {
  read: { category: 'read', icon: '📖', verb: 'Reading', zone: 'books', name: 'Read', detail: () => pick(FILES), tl: 'read' },
  search: { category: 'search', icon: '🔎', verb: 'Searching', zone: 'books', name: 'Grep', detail: () => pick(SEARCHES), tl: 'read' },
  edit: { category: 'edit', icon: '⌨️', verb: 'Editing', zone: 'desk', name: 'Edit', detail: () => pick(FILES), tl: 'edit' },
  bash: { category: 'bash', icon: '💻', verb: 'Running', zone: 'servers', name: 'Bash', detail: () => pick(COMMANDS), tl: 'bash' },
  web: { category: 'web', icon: '🌐', verb: 'Browsing', zone: 'web', name: 'WebFetch', detail: () => pick(HOSTS), tl: 'web' },
  plan: { category: 'plan', icon: '📝', verb: 'Planning', zone: 'board', name: 'TodoWrite', detail: () => pick(PLANS), tl: 'plan' },
  delegate: { category: 'delegate', icon: '📞', verb: 'Briefing', zone: 'meeting', name: 'Agent', detail: () => pick(TASKS), tl: 'delegate' },
  other: { category: 'other', icon: '🗂️', verb: 'Using', zone: 'files', name: 'jira search', detail: () => 'TEG tickets', tl: 'other' },
};

// Spend on each of the last 30 days, today last: the trend, the heatmap and the month all use it.
const DEMO_COSTS = [0, 12, 48, 0, 0, 96, 131, 64, 22, 0, 0, 58, 143, 77, 91, 40, 0, 12, 118, 176, 52, 197, 32, 0, 0, 84, 210, 64, 47.9, 23.4];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (a, b) => a + Math.random() * (b - a);

function weighted(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) if ((r -= w) <= 0) return key;
  return entries[0][0];
}

function history() {
  const states = ['read', 'edit', 'bash', 'think', 'wait', 'web', 'plan'];
  let s = pick(states);
  return Array.from({ length: 30 }, (_, i) => {
    if (i < 6 && Math.random() < 0.6) return null;
    if (Math.random() < 0.35) s = weighted([['read', 3], ['edit', 3], ['bash', 2], ['think', 2], ['wait', 2], ['web', 1], ['plan', 1], ['delegate', 0.5]]);
    return s;
  });
}

/** Spend in steps for the window chart: bursts of work in the session, working hours in the week. */
function demoUsage(t, sessionStart) {
  const wave = (i, k) => Math.max(0, Math.sin(i * k) + Math.sin(i * k * 2.7 + 1));
  const FIVE = 300_000;
  const fineFrom = Math.floor((t - 5.2 * 3600000) / FIVE) * FIVE;
  const fine = Array.from({ length: Math.ceil((t - fineFrom) / FIVE) }, (_, i) => {
    const at = fineFrom + i * FIVE;
    return at < sessionStart ? 0 : Math.round(wave(i, 0.35) * 0.9 * 100) / 100;
  });
  const hourFrom = Math.floor((t - 169 * 3600000) / 3600000) * 3600000;
  const hourly = Array.from({ length: Math.ceil((t - hourFrom) / 3600000) }, (_, i) => {
    const hour = new Date(hourFrom + i * 3600000).getHours();
    return hour >= 9 && hour <= 23 ? Math.round((2 + wave(i, 0.6) * 4) * 100) / 100 : 0;
  });
  return { fine: { from: fineFrom, step: FIVE, costs: fine }, hourly: { from: hourFrom, step: 3600000, costs: hourly } };
}

function demoLimits(t) {
  // A session window that started a while ago, and a weekly reset next Tuesday morning.
  const start = t - 2.6 * 3600000;
  const tuesday = new Date(t);
  tuesday.setDate(tuesday.getDate() + ((9 - tuesday.getDay()) % 7 || 7));
  tuesday.setHours(9, 0, 0, 0);
  const minutes = (t - start) / 60000;
  return {
    source: 'estimate',
    session: { active: true, start, resetsAt: start + 5 * 3600000, limited: false, used: 96 + minutes * 0.05, pct: Math.min(99, Math.round(58 + minutes * 0.02)), capacity: 170, calibration: { lastHitAt: t - 26 * 3600000, samples: 2 } },
    weekly: { resetsAt: tuesday.getTime(), rolling: false, limited: false, used: 612, pct: 37, capacity: 1650, calibration: { lastHitAt: t - 9 * 86400000, samples: 1 } },
    rates: { cost30m: 16, cost24h: 71, cost7d: 480 },
    usage: demoUsage(t, start),
    spend: {
      today: { cost: 21.4 + minutes * 0.05, tokens: 38_200_000 },
      yesterday: { cost: 47.9, tokens: 91_500_000 },
      yesterdayByNow: { cost: 26.8, tokens: 51_000_000 },
      last7: { cost: 312.6, tokens: 604_000_000 },
      last30: { cost: 1184, tokens: 2_310_000_000 },
      month: (() => {
        const from = new Date(new Date(t).setHours(0, 0, 0, 0)).setDate(1);
        const cost = DEMO_COSTS.slice(-Math.min(30, new Date(t).getDate())).reduce((a, x) => a + x, 0) - 23.4 + 21.4 + minutes * 0.05;
        return { cost, tokens: cost * 1.95e6, from };
      })(),
    },
    computedAt: t,
  };
}

const H = 3_600_000;
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const floor10 = (ms) => Math.floor(ms / 600_000) * 600_000;

/** 4am on the working day `ago` days before the one `t` is in. */
function workDay(t, ago = 0) {
  const d = new Date(t);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - ago);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
}

// Two weeks of working days as [first message, last message] in clock hours (past 24 is after midnight); null is a day off.
const DAY_SHAPES = [null, [9.2, 18.5], [8.8, 23.9], [9.5, 25.1], [10, 19.2], [9.1, 24.6], null, null, [9.4, 19.8], [8.6, 22.4], [9, 25.4], [9.8, 18.9], [9.3, 23.2], null];

function demoHours(t, firstToday) {
  const days = DAY_SHAPES.map((shape, i) => {
    const start = workDay(t, 13 - i);
    const today = i === DAY_SHAPES.length - 1;
    const [a, b] = today ? [firstToday, t] : shape ? shape.map((h) => start + (h - 4) * H) : [];
    if (a == null || b <= a) return { start, messages: 0 };
    const len = b - a;
    const stretches = [[0, 0.1], [0.2, 0.33], [0.5, 0.6], [0.88, 1]].map(([x, y]) => [a + len * x, a + len * y]);
    const activeMs = stretches.reduce((n, [x, y]) => n + y - x, 0);
    return { start, first: a, last: b, messages: Math.max(1, Math.round(activeMs / H * 3.5)), activeMs, stretches, late: b >= new Date(start).setHours(24, 0, 0, 0) };
  });
  const worked = days.filter((d) => d.messages);
  const done = worked.filter((d) => d.start < workDay(t));
  let streak = 0;
  for (let i = days.length - (days[days.length - 1].messages ? 1 : 2); i >= 0 && days[i].messages; i--) streak++;
  const active = (from, to) => days.slice(from, to).reduce((n, d) => n + (d.activeMs || 0), 0);
  const dates = days.map((d) => ({ start: new Date(d.start).setHours(0, 0, 0, 0), activeMs: d.activeMs || 0, messages: d.messages, first: d.first ?? null, last: d.last ?? null }));
  return {
    days,
    dates,
    typicalStart: median(worked.map((d) => d.first - d.start)),
    typicalStop: median(done.map((d) => d.last - d.start)),
    typicalLength: median(done.map((d) => d.last - d.first)),
    typicalActive: median(done.map((d) => d.activeMs)),
    completedDays: done.length,
    lateNights: worked.filter((d) => d.late).length,
    lastLate: [...worked].reverse().find((d) => d.late)?.start ?? null,
    daysOff: days.filter((d, i) => i < days.length - 1 && !d.messages).length,
    streak,
    longestStreak: Math.max(streak, 5),
    week: active(7, 14),
    prevWeek: active(0, 7),
  };
}

/** Agents work a little less than you do, except on late nights, when they carry on after you stop. */
function demoAgentHours(t, hours) {
  const days = hours.days.map((d, i) => {
    if (!d.messages) return { start: d.start, wallMs: 0 };
    const stretches = d.stretches.map(([a, b]) => [a + 4 * 60_000, Math.max(a + 5 * 60_000, b - 6 * 60_000)]);
    let unattendedMs = 0;
    if (d.late && d.start < workDay(t)) {
      stretches.push([d.last + 10 * 60_000, d.last + 100 * 60_000]);
      unattendedMs = 90 * 60_000;
    }
    const wallMs = stretches.reduce((n, [a, b]) => n + b - a, 0);
    return {
      start: d.start, first: stretches[0][0], last: stretches[stretches.length - 1][1], wallMs, agentMs: wallMs * (1.4 + (i % 3) * 0.3),
      peak: 2 + (i % 4), sessions: 3 + (i % 3), subagents: 2 + (i % 5), late: d.late, unattendedMs, stretches,
    };
  });
  const worked = days.filter((d) => d.wallMs);
  const done = worked.filter((d) => d.start < workDay(t));
  const sum = (from, to, key) => days.slice(from, to).reduce((n, d) => n + (d[key] || 0), 0);
  const longestDay = worked.reduce((best, d) => (d.wallMs > best.wallMs ? d : best), worked[0]);
  return {
    days,
    dates: days.map(({ stretches, late, ...d }) => ({ ...d, start: new Date(d.start).setHours(0, 0, 0, 0) })),
    typicalStart: median(worked.map((d) => d.first - d.start)),
    typicalStop: median(done.map((d) => d.last - d.start)),
    week: sum(7, 14, 'wallMs'), prevWeek: sum(0, 7, 'wallMs'), weekAgentMs: sum(7, 14, 'agentMs'), prevWeekAgentMs: sum(0, 7, 'agentMs'), weekUnattendedMs: sum(7, 14, 'unattendedMs'),
    lateNights: worked.filter((d) => d.late).length,
    lastLate: [...worked].reverse().find((d) => d.late)?.start ?? null,
    longest: { ms: 105 * 60_000, from: longestDay.first, to: longestDay.first + 105 * 60_000 },
  };
}

/** Windows chained through each past day, and today's leading up to the one the limit cards show. */
function demoWindows(t, hours, current, earlierToday) {
  const since = new Date(workDay(t, 6)).setHours(0, 0, 0, 0);
  const costs = [46, 118, 71, 152, 170, 64, 98, 131, 22, 88, 170, 57, 109, 35];
  const windows = [];
  let k = 0;
  for (const d of hours.days.slice(7, 13)) {
    if (!d.messages) continue;
    for (let start = floor10(d.first); start < d.last; start += 5 * H + 20 * 60_000) {
      const cost = costs[k++ % costs.length];
      windows.push({ start, end: start + 5 * H, cost, hitAt: cost >= 170 ? start + 3.4 * H : null });
    }
  }
  if (earlierToday != null) windows.push({ start: earlierToday, end: earlierToday + 5 * H, cost: 83, hitAt: null });
  windows.push({ start: current.start, end: current.resetsAt, cost: current.used, hitAt: null });
  const hit = windows.filter((w) => w.hitAt);
  const days = new Set(windows.map((w) => workDay(w.start)));
  const { typicalStart: start, typicalStop: stop } = hours;
  const useful = Math.floor((stop - start - H) / (5 * H)) + 1;
  const by = floor10(stop - H - useful * 5 * H);
  return {
    since,
    windows,
    perDay: windows.length / days.size,
    today: earlierToday != null ? 2 : 1,
    hits: hit.length,
    lockedMs: hit.reduce((n, w) => n + w.end - w.hitAt, 0),
    plan: { start, stop, useful, by, lead: start - by, resets: Array.from({ length: useful }, (_, i) => by + (i + 1) * 5 * H) },
  };
}

function demoInsights(t) {
  const day = (ago) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ago); return d.getTime(); };
  const costs = DEMO_COSTS;
  const hourShape = [0, 0, 0, 0, 0, 0, 1, 3, 6, 8, 7, 5, 3, 6, 8, 9, 7, 6, 10, 8, 4, 2, 1, 0];
  const hourSum = hourShape.reduce((a, b) => a + b, 0);
  const total30 = costs.reduce((a, b) => a + b, 0);
  // Today started with the window before the one the limit cards show, when there was room for it.
  const session = demoLimits(t).session;
  const earlier = session.start - 5.5 * H >= workDay(t) + H ? session.start - 5.5 * H : null;
  const hours = demoHours(t, Math.max(workDay(t) + 5 * 60_000, (earlier ?? session.start) + 3 * 60_000));
  const windows = demoWindows(t, hours, session, earlier);
  const b = (cost) => ({
    cost, tokens: cost * 1_950_000,
    models: [{ name: 'Opus 5.5', cost: cost * 0.64, tokens: cost * 1.2e6 }, { name: 'Opus 5', cost: cost * 0.28, tokens: cost * 5e5 }, { name: 'Sonnet 5', cost: cost * 0.07, tokens: cost * 2e5 }, { name: 'Haiku 4.5', cost: cost * 0.01, tokens: cost * 5e4 }],
    agents: [{ name: 'Main agents', cost: cost * 0.66, tokens: cost * 1.3e6 }, { name: 'Subagents', cost: cost * 0.34, tokens: cost * 6.5e5 }],
    projects: [{ name: 'thrive-backend', cost: cost * 0.52, tokens: cost * 1e6 }, { name: 'Member-Management', cost: cost * 0.24, tokens: cost * 4.6e5 }, { name: 'thrive-web', cost: cost * 0.17, tokens: cost * 3.3e5 }, { name: 'distributed-job-queue', cost: cost * 0.07, tokens: cost * 1.4e5 }],
    types: [
      { key: 'cacheRead', name: 'Cache reads', cost: cost * 0.52, tokens: cost * 1.8e6 },
      { key: 'output', name: 'Output (incl. thinking)', cost: cost * 0.27, tokens: cost * 1.2e4 },
      { key: 'cacheWrite', name: 'Cache writes', cost: cost * 0.2, tokens: cost * 4e4 },
      { key: 'input', name: 'Fresh input', cost: cost * 0.01, tokens: cost * 900 },
    ],
  });
  return {
    breakdown: { d7: b(costs.slice(-7).reduce((a, x) => a + x, 0)), d30: b(total30) },
    trend: {
      days: costs.map((cost, i) => ({ start: day(29 - i), cost, tokens: cost * 1_950_000 })),
      hours: hourShape.map((v) => ({ cost: (v / hourSum) * total30, tokens: (v / hourSum) * total30 * 1.95e6 })),
      // Weekdays busier than weekends, with the same shape through the day.
      grid: [0.2, 1.1, 1.4, 1.3, 1.2, 0.9, 0.3].map((w) => hourShape.map((v) => Math.round((v / hourSum) * total30 * (w / 6.4) * 100) / 100)),
      // Sunday first, like Date.getDay().
      weekdays: { since: day(28), days: [4, 52, 71, 64, 58, 43, 9].map((cost) => ({ cost, tokens: cost * 1.95e6, total: cost * 4, count: 4, activeDays: cost > 5 ? 4 : 1 })) },
    },
    cache: {
      d7: { cost: 312.6, saved: 2890, hitRate: 0.962, rebuilds: 38, rebuildCost: 41.2, afterPause: 27, afterPauseCost: 33.8 },
      today: { cost: 23.4, saved: 211, hitRate: 0.955, rebuilds: 5, rebuildCost: 4.1, afterPause: 3, afterPauseCost: 2.9 },
    },
    turnPerformance: {
      count: 200, pending: 4, interrupted: 2, inferred: 122,
      medianMs: 170000, p90Ms: 840000, maxMs: 4080000,
      buckets: [{ label: 'Under 1m', count: 40 }, { label: '1–5m', count: 100 }, { label: '5–15m', count: 40 }, { label: '15–60m', count: 18 }, { label: 'Over 1h', count: 2 }],
    },
    messages: {
      count: 214, today: 19, activeDays: 6, interrupts: 21, cost: 268.4, medianMs: 3.2 * 60000,
      buckets: [['Under 1 min', 38], ['1–5 min', 92], ['5–15 min', 57], ['15–60 min', 24], ['Over 1 hour', 3]].map(([label, count]) => ({ label, count })),
      priciest: { text: 'Refactor survey scoring service to use the new rules engine', t: t - 30 * 3600000, cost: 14.6, ms: 48 * 60000, project: 'thrive-backend', session: 'demo-0', inOffice: true },
      longest: { text: 'Build member CSV import with validation and a dry-run mode', t: t - 52 * 3600000, cost: 11.2, ms: 74 * 60000, project: 'Member-Management', session: 'demo-2', inOffice: true },
    },
    waiting: (() => {
      const mins = [42, 18, 0, 64, 37, 51, 22];
      const days = mins.map((m, i) => ({ start: day(6 - i), ms: m * 60000, replies: m ? Math.round(m / 3) : 0 }));
      return {
        ms: mins.reduce((a, m) => a + m, 0) * 60000, replies: days.reduce((a, d) => a + d.replies, 0), medianMs: 2.6 * 60000, away: 9,
        today: days[6], days,
        projects: [{ name: 'thrive-backend', ms: 118 * 60000, replies: 38 }, { name: 'Member-Management', ms: 71 * 60000, replies: 22 }, { name: 'thrive-web', ms: 45 * 60000, replies: 15 }],
        longest: [
          { session: 'demo-2', source: 'claude', title: 'Build member CSV import', project: 'Member-Management', t: t - 26 * 3600000, ms: 27 * 60000 },
          { session: 'demo-0', source: 'claude', title: 'Refactor survey scoring service', project: 'thrive-backend', t: t - 50 * 3600000, ms: 22 * 60000 },
          { session: 'demo-1', source: 'claude', title: 'Fix flaky pulse survey tests', project: 'thrive-backend', t: t - 4 * 3600000, ms: 16 * 60000 },
        ],
      };
    })(),
    tools: {
      calls: 4210, failed: 63, denied: 7, staleEdits: 5, today: { calls: 388, failed: 6, denied: 1 },
      byTool: [{ name: 'Bash', calls: 2900, failed: 41, denied: 6 }, { name: 'Edit', calls: 610, failed: 12, denied: 1 }, { name: 'WebFetch', calls: 48, failed: 6, denied: 0 }, { name: 'Write', calls: 190, failed: 4, denied: 0 }],
      reasons: [{ text: 'Tests failed', count: 17 }, { text: 'File or folder not found', count: 11 }, { text: 'String to replace not found in file.', count: 7 }, { text: 'File has not been read yet.', count: 5 }],
    },
    parallel: (() => {
      const hourNow = new Date(t).getHours();
      const shape = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 3, 2, 3, 5, 6, 4, 3, 2, 1, 1, 0, 0, 0];
      const hours = shape.map((max, i) => (i > hourNow ? { max: 0, agentMs: 0 } : { max, agentMs: max * 0.6 * 3_600_000 }));
      return {
        peak: { count: 9, main: 4, sub: 5, at: t - 2 * 86400000 },
        peakToday: { count: Math.max(...hours.map((h) => h.max)), main: 3, sub: 2, at: t - 2 * 3600000 },
        agentMs: 61 * 3_600_000, busyMs: 23 * 3_600_000,
        agentMsToday: hours.reduce((n, h) => n + h.agentMs, 0), busyMsToday: 6 * 3_600_000, hours,
      };
    })(),
    context: {
      buckets: [['Under 50K', 50_000, 610, 14.2], ['50K–100K', 100_000, 1480, 47.5], ['100K–200K', 200_000, 1620, 96.3], ['200K–400K', 400_000, 820, 104.8], ['Over 400K', null, 190, 49.8]]
        .map(([label, max, messages, cost]) => ({ label, max, messages, cost })),
      messages: 4720, cost: 312.6, avgContext: 148_000,
      compactions: { count: 6, auto: 5, avgBefore: 172_000 },
    },
    longContext: {
      since: day(6), spend: 312.6, cost: 38.4, from: 200_000, count: 4,
      surcharge: { cost: 3.1, requests: 22 }, size: { cost: 35.3, messages: 214 },
      sessions: [
        { id: 'demo-0', source: 'claude', title: 'Refactor survey scoring service', project: 'thrive-backend', cost: 21.6, surcharge: 0, messages: 118, peak: 612_000 },
        { id: 'demo-2', source: 'claude', title: 'Build member CSV import', project: 'Member-Management', cost: 11.2, surcharge: 0, messages: 71, peak: 408_000 },
        { id: 'demo-4', source: 'codex', title: 'Explain the job queue retries', project: 'distributed-job-queue', cost: 5.6, surcharge: 3.1, messages: 25, peak: 301_000 },
      ],
    },
    topSessions: [
      { id: 'demo-0', title: 'Refactor survey scoring service', project: 'thrive-backend', cost: 9.8, subCost: 2.1, tokens: 1.9e7, added: 412, removed: 180, linesPerDollar: 60, inOffice: true },
      { id: 'demo-2', title: 'Build member CSV import', project: 'Member-Management', cost: 6.4, subCost: 1.3, tokens: 1.2e7, added: 690, removed: 44, linesPerDollar: 115, inOffice: true },
      { id: 'demo-1', title: 'Fix flaky pulse survey tests', project: 'thrive-backend', cost: 4.1, subCost: 0, tokens: 8e6, added: 38, removed: 21, linesPerDollar: 14, inOffice: true },
      { id: 'demo-x', title: 'Morning code review', project: 'thrive-web', cost: 1.2, subCost: 0, tokens: 2.4e6, added: 0, removed: 0, linesPerDollar: null, inOffice: false },
    ],
    hours,
    agentHours: demoAgentHours(t, hours),
    windows,
    timeline: demoTimeline(t),
    skills: demoSkills(t),
    repeats: demoRepeats(t),
    computedAt: t,
  };
}

/** Prompts typed again and again, ready to be commands. */
function demoRepeats(t) {
  const H = 3_600_000;
  const group = (key, count, sessions, lastH, examples, body, name, extra = {}) => ({
    key, count, sessions, days: count, lastAt: t - lastH * H, firstAt: t - 20 * 24 * H, words: body.split(' ').length, exact: examples.length === 1,
    sources: { claude: count }, source: 'claude', projects: ['thrive-web'], examples, body, argument: body.includes('$ARGUMENTS'), name,
    description: examples[0].slice(0, 90), exists: { claude: false, codex: false }, ...extra,
  });
  return {
    prompts: 412,
    groups: [
      group('comments pr review style', 9, 9, 5, ['Review PR 1482 and leave comments on naming, tests and anything risky', 'Review PR 1479 and leave comments on naming, tests and anything risky'], 'Review PR $ARGUMENTS and leave comments on naming, tests and anything risky', 'review-pr'),
      group('changelog release summarize week', 4, 4, 30, ['Summarize what we merged this week as release notes, grouped by feature, with links'], 'Summarize what we merged this week as release notes, grouped by feature, with links', 'summarize-merged'),
      group('failing fix run tests', 3, 3, 52, ['Run the tests, and fix whatever is failing without changing what the tests expect'], 'Run the tests, and fix whatever is failing without changing what the tests expect', 'run-tests', { sources: { claude: 2, codex: 1 } }),
    ],
  };
}

/** Skills over 30 days: a few used a lot, by you or the agent, and some never. */
function demoSkills(t) {
  const H = 3_600_000;
  const used = [
    { name: 'standup', source: 'claude', kind: 'personal', about: 'Write my daily standup from git commits, PRs and Jira.', uses: 21, you: 21, agent: 0, sessions: 21, days: 21, projects: ['thrive-web'], lastAt: t - 5 * H },
    { name: 'migration-best-practices', source: 'claude', kind: 'project', project: 'thrive-backend', about: 'How to write and review database migrations here.', uses: 9, you: 1, agent: 8, sessions: 6, days: 5, projects: ['thrive-backend'], lastAt: t - 26 * H },
    { name: 'chrome-devtools-mcp:a11y-debugging', source: 'claude', kind: 'plugin', plugin: 'chrome-devtools-mcp', about: 'Find and fix accessibility issues with Chrome DevTools.', uses: 6, you: 2, agent: 4, sessions: 3, days: 3, projects: ['thrive-web'], lastAt: t - 50 * H },
    { name: 'anthropic-skills:docx', source: 'claude', kind: 'app', about: 'Create and edit Word documents.', uses: 3, you: 0, agent: 3, sessions: 2, days: 2, projects: [], lastAt: t - 4 * 24 * H },
    { name: 'openai-docs', source: 'codex', kind: 'builtin', about: 'Up-to-date OpenAI docs with citations.', uses: 2, you: 0, agent: 2, sessions: 2, days: 2, projects: ['overtime'], lastAt: t - 6 * 24 * H },
  ];
  const unused = [
    { name: 'learn', source: 'claude', kind: 'personal', about: 'Daily learning coach with spaced repetition.' },
    { name: 'queue-best-practices', source: 'claude', kind: 'project', project: 'thrive-backend', about: 'Queues, retries and idempotency here.' },
    { name: 'chrome-devtools-mcp:memory-leak-debugging', source: 'claude', kind: 'plugin', plugin: 'chrome-devtools-mcp', about: 'Track down memory leaks in a page.' },
    { name: 'anthropic-skills:pptx', source: 'claude', kind: 'app', about: 'Create and edit slide decks.' },
    { name: 'security-review', source: 'claude', kind: 'builtin', about: 'Review the changes on this branch for security issues.' },
    { name: 'imagegen', source: 'codex', kind: 'builtin', about: 'Generate or edit images.' },
  ];
  return { since: t - 30 * 24 * H, offered: used.length + unused.length, usedCount: used.length, uses: used.reduce((n, s) => n + s.uses, 0), used, unused };
}

/** Today's lanes for the timeline: a morning review, a few sessions through the day, one Codex. */
function demoTimeline(t) {
  const midnight = new Date(t).setHours(0, 0, 0, 0);
  const base = Math.max(midnight, t - 8 * H);
  const at = (h) => Math.min(t, base + h * H);
  const spans = (list) => list.map(([a, b]) => [at(a), b == null ? t : at(b)]).filter(([a, b]) => b > a);
  const lane = (id, source, title, project, cost, work, sub, waits, messages) => ({
    id, source, title, project, cost, partial: false,
    work: spans(work), sub: spans(sub), waits: spans(waits), messages: messages.map(at).filter((x) => x < t),
  });
  const lanes = [
    lane('demo-x', 'claude', 'Morning code review', 'thrive-web', 1.2, [[0, 0.55]], [], [[0.25, 0.32]], [0, 0.32]),
    lane('demo-2', 'claude', 'Build member CSV import', 'Member-Management', 6.4, [[0.2, 1.1], [1.4, 2.6], [3.9, 5.2]], [[0.5, 0.9]], [[1.1, 1.4]], [0.2, 1.4, 3.9]),
    lane('demo-0', 'claude', 'Refactor survey scoring service', 'thrive-backend', 9.8, [[1, 1.8], [2, 4.5], [5, null]], [[2.3, 2.9], [3.4, 3.7]], [[1.8, 2], [4.5, 5]], [1, 2, 5]),
    lane('demo-1', 'claude', 'Fix flaky pulse survey tests', 'thrive-backend', 4.1, [[2.5, 3.2], [6.4, 7.9]], [], [[3.2, 3.5]], [2.5, 3.5, 6.4]),
    lane('demo-4', 'codex', 'Explain the job queue retries', 'distributed-job-queue', 0, [[4.2, 4.9], [7.1, null]], [], [], [4.2, 7.1]),
    lane('demo-3', 'claude', 'Upgrade the web app to React 19', 'thrive-web', 3.3, [[5.5, 7.6]], [[6, 6.6]], [], [5.5]),
  ].filter((l) => l.work.length || l.messages.length);
  for (const l of lanes) l.first = Math.min(...l.work.map((x) => x[0]), ...l.messages);
  return {
    from: midnight,
    you: spans([[0, 2.1], [2.4, 5.3], [5.9, null]]),
    // Usually on from about 9:30 to 7, quieter over lunch, and some evenings.
    usual: { days: 11, slots: Array.from({ length: 96 }, (_, k) => { const h = k / 4; return h >= 9.5 && h < 13 ? 0.82 : h >= 13 && h < 14 ? 0.36 : h >= 14 && h < 19 ? 0.73 : h >= 19 && h < 23 ? 0.27 : 0; }) },
    lanes: lanes.sort((a, b) => a.first - b.first),
    others: { sessions: 2, busyMs: 18 * 60000, cost: 0.9 },
  };
}

/** Seven months of days for the heatmap: busy weekdays, quiet weekends, the odd day off. */
export function demoHistory(t) {
  const out = [];
  const today = new Date(t).setHours(0, 0, 0, 0);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 209; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const wd = d.getDay();
    const r = rand();
    // The last 30 days follow the trend chart; before that, a made-up but steady pattern.
    let cost = i < 30 ? DEMO_COSTS[29 - i] : wd === 0 || wd === 6 ? (r < 0.7 ? 0 : r * 40) : r < 0.12 ? 0 : 20 + r * 150 * (1 + (209 - i) / 300);
    if (i === 0) cost = 23.4;
    const busy = cost > 0 ? Math.min(1, cost / 180) : 0;
    out.push({
      day: d.getTime(), cost: Math.round(cost * 100) / 100, tokens: Math.round(cost * 1.95e6), partial: false,
      activeMs: cost > 0 ? Math.round((1.2 + busy * 7.5) * H) : 0,
      agentMs: cost > 0 ? Math.round((0.8 + busy * 9) * H) : 0,
      messages: cost > 0 ? Math.round(8 + busy * 70) : 0,
      sessions: cost > 0 ? Math.max(1, Math.round(1 + busy * 12)) : 0,
      kept: i >= 30,
    });
  }
  return out;
}

const PAST_TITLES = [
  ['Morning code review', 'thrive-web'], ['Triage Sentry alerts', 'thrive-backend'], ['Add pagination to the members API', 'Member-Management'],
  ['Write the Q3 migration', 'thrive-backend'], ['Speed up the survey list query', 'thrive-backend'], ['Dark mode for the settings page', 'thrive-web'],
  ['Explain the retry backoff', 'distributed-job-queue'], ['Fix the CSV date parsing', 'Member-Management'], ['Nightly dependency audit', 'thrive-backend'],
  ['Upgrade to Node 24', 'thrive-web'], ['Add a dead-letter queue', 'distributed-job-queue'], ['Clean up unused feature flags', 'thrive-web'],
];

/** A month of finished sessions for the demo's Sessions page: the same each time for a given day. */
export function demoSessions(t) {
  let seed = Math.floor(t / 86_400_000);
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const midnight = new Date(t).setHours(0, 0, 0, 0);
  const list = SESSIONS.slice(0, 4).map((x, i) => ({ ...x, id: `demo-${i}`, ago: 0 }));
  for (let i = 0; i < 38; i++) {
    const [title, project] = PAST_TITLES[Math.floor(rand() * PAST_TITLES.length)];
    list.push({ title, project, id: `demo-past-${i}`, ago: Math.floor(rand() ** 1.6 * 30), source: rand() < 0.2 ? 'codex' : 'claude' });
  }
  return list.map((x) => {
    const start = Math.min(t - 60_000, midnight - x.ago * 86_400_000 + (8 + rand() * 12) * 3_600_000);
    const lastAt = Math.min(t - 30_000, start + (10 + rand() * 200) * 60_000);
    const messages = 1 + Math.floor(rand() * 24);
    const cost = Math.round(messages * (0.2 + rand() * 1.4) * 100) / 100;
    const added = rand() < 0.2 ? 0 : Math.floor(rand() * 900);
    const tools = messages * (4 + Math.floor(rand() * 12));
    return {
      id: x.id,
      source: x.source || 'claude',
      title: x.title,
      project: x.project,
      model: x.source === 'codex' ? 'GPT-6 Sol' : rand() < 0.7 ? 'Opus 5.5' : 'Sonnet 5',
      startedAt: start,
      lastAt,
      subagents: rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0,
      // How full its context was at its last reply: mostly roomy, a few close to full.
      context: (() => {
        const window = x.source === 'codex' ? 258_400 : 200_000;
        const used = Math.round(window * (rand() < 0.15 ? 0.82 + rand() * 0.15 : 0.12 + rand() * 0.55));
        return { used, window, pct: Math.round((used / window) * 100), at: lastAt };
      })(),
      days: [{
        day: new Date(lastAt).setHours(0, 0, 0, 0),
        cost,
        subCost: Math.round(cost * rand() * 0.3 * 100) / 100,
        tokens: Math.round(cost * 2e6),
        messages,
        agentMs: messages * (1 + rand() * 6) * 60_000,
        added,
        removed: Math.floor(added * rand() * 0.6),
        tools,
        failed: Math.floor(tools * rand() * 0.06),
        waitMs: messages * rand() * 4 * 60_000,
        waits: Math.max(0, messages - 1),
      }],
      models: [{ name: x.source === 'codex' ? 'GPT-6 Sol' : 'Opus 5.5', cost: cost * 0.8 }, { name: x.source === 'codex' ? 'GPT-6 Luna' : 'Sonnet 5', cost: cost * 0.2 }],
    };
  });
}

/** A week in review for the demo, in the shape /api/digest sends. */
export function demoDigest(t, weeksAgo = 1) {
  const monday = new Date(t);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * weeksAgo);
  const from = monday.getTime();
  const to = weeksAgo ? from + 7 * 86_400_000 : new Date(t).setHours(24, 0, 0, 0);
  const days = Math.round((to - from) / 86_400_000);
  const k = days / 7;
  const week = (cost) => ({
    cost, partial: false, sessions: Math.round(38 * k), messages: Math.round(214 * k), agentMs: 31 * k * 3_600_000, waitMs: 4.6 * k * 3_600_000, waits: Math.round(120 * k),
    added: Math.round(9200 * k), removed: Math.round(2100 * k), tools: Math.round(4210 * k), failed: Math.round(63 * k), activeMs: 27 * k * 3_600_000,
    bySource: { claude: cost * 0.93, codex: cost * 0.07 },
  });
  const cost = 612.4 * k;
  return {
    from, to, weeksAgo, days, ...week(cost),
    projects: [['thrive-backend', 0.52, 19], ['Member-Management', 0.24, 8], ['thrive-web', 0.17, 7], ['distributed-job-queue', 0.07, 4]].map(([name, share, sessions]) => ({ name, cost: cost * share, sessions: Math.round(sessions * k) || 1, agentMs: share * 31 * k * 3_600_000 })),
    topSessions: [
      { id: 'demo-0', title: 'Refactor survey scoring service', project: 'thrive-backend', source: 'claude', cost: cost * 0.14, messages: 24, agentMs: 3.1 * 3_600_000 },
      { id: 'demo-2', title: 'Build member CSV import', project: 'Member-Management', source: 'claude', cost: cost * 0.11, messages: 19, agentMs: 2.4 * 3_600_000 },
      { id: 'demo-1', title: 'Fix flaky pulse survey tests', project: 'thrive-backend', source: 'claude', cost: cost * 0.06, messages: 11, agentMs: 1.2 * 3_600_000 },
    ],
    busiest: [from + Math.min(days - 1, 2) * 86_400_000, cost * 0.26],
    before: week(cost / 1.34),
    hits: { claude: weeksAgo ? 2 : 0, codex: 0 },
    computedAt: t,
  };
}

export function startDemo(emit) {
  const agents = [];
  const feed = [];
  let internCount = 0;
  const now = () => Date.now();
  const dayBase = { cost: 21.4, tokens: 38_200_000, tools: 612, turns: 41, added: 2310, removed: 880, sessions: 9 };

  function log(a, icon, text) {
    const t = now();
    a.recent.push({ t, icon, text });
    if (a.recent.length > 8) a.recent.shift();
    feed.push({ t, agentId: a.id, who: a.nick, seed: a.seed, kind: a.kind, icon, text });
    if (feed.length > 60) feed.shift();
  }

  function base(id, nick, seed, extra) {
    const window = extra.model?.includes('haiku') ? 200_000 : extra.source === 'codex' ? 272_000 : 1_000_000;
    return {
      id, nick, seed, kind: 'main', parentId: null, source: 'claude', agentType: null, background: false,
      status: 'thinking', zone: 'desk', needsYou: null, tool: null, lastTool: null,
      turnStartedAt: now(), endedAt: 0, endReason: null, startedAt: now() - between(5, 90) * 60000, lastActivity: now(),
      snippet: null, counts: {}, recent: [], turns: 1,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: between(0.4, 6), costKnown: true, internCost: 0,
      context: { used: Math.round(window * between(0.1, 0.6)), window, pct: 0 },
      compactions: 0, lastCompactAt: 0, errors: 0, lastErrorAt: 0, results: [],
      files: [], lines: { added: 0, removed: 0 }, timeline: history(),
      present: true, steps: 0, nextAt: now() + between(500, 2500), phase: 'think', tl: 'think',
      ...extra,
    };
  }

  SESSIONS.forEach((s, i) => {
    agents.push(base(`demo-${i}`, s.nick, 1000 + i * 7919, { ...s, cwd: `~/code/${s.project}`, background: s.entrypoint === 'sdk-cli' }));
  });
  // One agent starts out already waiting in the lounge, one nearly out of context.
  Object.assign(agents[3], { status: 'waiting', zone: 'lounge', needsYou: 'turn', endedAt: now() - 260000, endReason: 'done', nextAt: now() + 14000, phase: 'waiting', tl: 'wait' });
  agents[1].context.used = 880_000;
  // And the nightly audit keeps failing the same command, so it shows as stuck.
  const audit = agents[5];
  const stuckTool = { name: 'Bash', category: 'bash', icon: '💻', verb: 'Running', detail: 'npm audit fix', startedAt: now() - 40_000 };
  Object.assign(audit, { status: 'working', zone: 'servers', tool: stuckTool, lastTool: stuckTool, phase: 'stuck', tl: 'bash', nextAt: Infinity, errors: 5, lastErrorAt: now() - 40_000,
    results: [[now() - 540_000, 1, 'Read'], ...[430, 330, 230, 140, 40].map((s) => [now() - s * 1000, 0, 'Bash'])] });
  if (agents[4].source === 'codex') agents[4].cost = null;

  function grow(a, tokens, cost) {
    a.context.used = Math.min(a.context.window, a.context.used + tokens);
    a.tokens.input += Math.round(tokens * 0.05);
    a.tokens.cacheRead += Math.round(tokens * 0.9);
    a.tokens.output += Math.round(tokens * 0.05);
    a.tokens.total = a.tokens.input + a.tokens.cacheRead + a.tokens.output + a.tokens.cacheWrite;
    dayBase.tokens += tokens;
    if (a.cost != null) {
      a.cost += cost;
      dayBase.cost += cost;
    }
    // Close to full: compact back down, like Claude Code does.
    if (a.context.used / a.context.window > 0.93) {
      a.context.used = Math.round(a.context.window * 0.18);
      a.compactions++;
      a.lastCompactAt = now();
      log(a, '🧹', 'Compacted its context');
    }
  }

  function useTool(a, key) {
    const def = TOOLS[key];
    const tool = { name: def.name, category: def.category, icon: def.icon, verb: def.verb, detail: def.detail(), startedAt: now() };
    a.tool = tool;
    a.lastTool = tool;
    a.status = 'working';
    a.zone = def.zone;
    a.tl = def.tl;
    a.counts[def.category] = (a.counts[def.category] || 0) + 1;
    a.phase = 'tool';
    a.nextAt = now() + (key === 'bash' ? between(2500, 6000) : between(1200, 3200));
    dayBase.tools++;
    grow(a, Math.round(between(4000, 14000) * (a.context.window / 1_000_000 + 0.3)), between(0.01, 0.09));
    log(a, def.icon, key === 'other' ? `Using ${def.name} · ${tool.detail}` : `${def.verb} ${tool.detail}`);
    if (key === 'edit') {
      const added = Math.round(between(2, 40));
      const removed = Math.round(between(0, 20));
      const file = a.files.find((f) => f.name === tool.detail) || { path: `${a.cwd}/src/${tool.detail}`, name: tool.detail, edits: 0, added: 0, removed: 0 };
      file.edits++;
      file.added += added;
      file.removed += removed;
      a.files = [file, ...a.files.filter((f) => f !== file)].slice(0, 8);
      a.lines.added += added;
      a.lines.removed += removed;
      dayBase.added += added;
      dayBase.removed += removed;
    }
    if (key === 'bash' && Math.random() < 0.12) {
      a.failing = true;
      a.errors++;
      a.lastErrorAt = now();
      log(a, '⚠️', 'A command failed');
    }
    if (key === 'delegate') spawnIntern(a, tool.detail);
  }

  function spawnIntern(parent, task) {
    const active = agents.filter((x) => x.parentId === parent.id && x.status !== 'done').length;
    if (active >= 2 || parent.source === 'codex') return;
    const n = internCount++;
    const intern = base(`demo-intern-${n}`, INTERN_NAMES[n % INTERN_NAMES.length], 5000 + n * 104729, {
      kind: 'sub', parentId: parent.id, agentType: 'Explore', title: task, project: parent.project,
      branch: parent.branch, entrypoint: parent.entrypoint, model: 'claude-haiku-4-5', cwd: parent.cwd,
      budget: 4 + Math.floor(Math.random() * 4), cost: 0, timeline: new Array(30).fill(null),
    });
    intern.context = { used: 12_000, window: 200_000, pct: 6 };
    agents.push(intern);
    log(intern, '💬', 'Got an assignment');
  }

  function endTurn(a) {
    a.tool = null;
    a.endedAt = now();
    a.endReason = 'done';
    a.tl = 'wait';
    if (a.kind === 'sub') {
      Object.assign(a, { status: 'done', zone: 'desk', needsYou: null, phase: 'done', nextAt: now() + 20000 });
      log(a, '✅', 'Finished the assignment');
    } else {
      a.snippet = pick(REPLIES);
      Object.assign(a, { status: 'waiting', zone: 'lounge', needsYou: 'turn', phase: 'waiting', nextAt: now() + between(12000, 26000) });
      log(a, '✅', 'Done, waiting for you');
    }
  }

  let lastShift = now();
  function tick() {
    const t = now();
    const shift = t - lastShift > 120000;
    if (shift) lastShift = t;
    for (const a of [...agents]) {
      if (shift) a.timeline = [...a.timeline.slice(1), a.tl];
      // The stuck one tries its command again every minute and a half, and fails.
      if (a.phase === 'stuck' && t - a.tool.startedAt > 90_000) {
        a.results.push([t, 0, 'Bash']);
        if (a.results.length > 12) a.results.shift();
        a.errors++;
        a.lastErrorAt = t;
        a.lastActivity = t;
        a.tool = { ...a.tool, startedAt: t };
        log(a, '⚠️', 'npm audit fix failed again');
      }
      if (t < a.nextAt) continue;
      a.lastActivity = t;
      if (a.phase === 'done') {
        agents.splice(agents.indexOf(a), 1);
        continue;
      }
      if (a.phase === 'waiting') {
        Object.assign(a, { status: 'thinking', zone: 'desk', needsYou: null, turnStartedAt: t, steps: 0, phase: 'think', tl: 'think', nextAt: t + between(1500, 3000) });
        a.turns++;
        dayBase.turns++;
        log(a, '💬', 'Got a new task');
        continue;
      }
      if (a.phase === 'question') {
        Object.assign(a, { needsYou: null, status: 'thinking', tool: null, phase: 'think', tl: 'think', nextAt: t + between(1000, 2000) });
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
        else useTool(a, weighted([['read', 4], ['search', 3], ['bash', 1]]));
        continue;
      }
      if (a.steps > 7 && Math.random() < 0.18) {
        endTurn(a);
      } else if (a.steps > 3 && Math.random() < 0.05 && a.source !== 'codex') {
        a.tool = { name: 'AskUserQuestion', category: 'ask', icon: '❓', verb: 'Asking you', detail: 'Should imports skip duplicate emails?', startedAt: t };
        Object.assign(a, { status: 'working', zone: 'desk', needsYou: 'question', phase: 'question', tl: 'wait', nextAt: t + between(6000, 9000) });
        log(a, '❓', 'Asking you: Should imports skip duplicate emails?');
      } else {
        useTool(a, weighted([['read', 3], ['search', 2], ['edit', 3], ['bash', 2], ['web', 1], ['plan', 1], ['delegate', 0.7], ['other', 0.4]]));
      }
    }
    for (const a of agents) {
      a.context.pct = Math.min(100, Math.round((a.context.used / a.context.window) * 100));
      a.timeline[29] = a.tl;
      if (a.kind === 'main') a.internCost = agents.filter((x) => x.parentId === a.id).reduce((n, x) => n + (x.cost || 0), 0);
    }
    const limits = demoLimits(t);
    const today = {
        ...dayBase,
        costPartial: true,
        sessionList: [
          ...agents.filter((a) => a.kind === 'main').map((a) => ({ title: a.title, project: a.project, cost: a.cost || 0, background: a.background, source: a.source })),
          { title: 'Morning code review', project: 'thrive-web', cost: 1.2, background: false, source: 'claude' },
          { title: 'Learning coach reminder', project: 'thrive-backend', cost: 0.3, background: true, source: 'claude' },
          { title: 'Triage Sentry alerts', project: 'thrive-backend', cost: 2.6, background: false, source: 'claude' },
        ].sort((x, y) => y.cost - x.cost),
    };
    // Every provider view shows the same simulated history.
    const view = { insights: demoInsights(t), spend: limits.spend, today };
    emit({
      now: t,
      watching: ['demo (simulated agents)'],
      limits,
      analytics: { all: view, claude: view, codex: view },
      codexLimits: {
        provider: 'codex', accountId: 'demo', status: 'ok', source: 'recorded', observedAt: t - 25 * 60000,
        windows: [
          { provider: 'codex', accountId: 'demo', bucketId: 'codex', kind: 'primary', id: 'demo:codex:primary', bucketName: 'codex', durationMs: 5 * 3600000, usedPercent: 23, resetsAt: t + 3.2 * 3600000, plan: 'plus',
            pace: { rate: 9 / 3600000, basis: 'over the last hour', start: t - 1.8 * 3600000, history: [[t - 95 * 60000, 3], [t - 70 * 60000, 8], [t - 52 * 60000, 12], [t - 30 * 60000, 17], [t - 12 * 60000, 21], [t - 25 * 60000 + 20 * 60000, 23]] } },
          { provider: 'codex', accountId: 'demo', bucketId: 'codex', kind: 'secondary', id: 'demo:codex:secondary', bucketName: 'codex', durationMs: 7 * 86400000, usedPercent: 41, resetsAt: t + 4.5 * 86400000, plan: 'plus',
            pace: { rate: 0.55 / 3600000, basis: 'over the last day', start: t - 2.5 * 86400000, history: [[t - 2.3 * 86400000, 6], [t - 1.9 * 86400000, 17], [t - 1.2 * 86400000, 26], [t - 0.8 * 86400000, 33], [t - 0.2 * 86400000, 39], [t - 25 * 60000, 41]] } },
        ],
      },
      openSessions: {
        sampledAt: t - 4000, everyMs: 10_000,
        sessions: [
          ...agents.filter((a) => a.kind === 'main' && a.source !== 'codex').map((a, i) => ({
            pid: 4100 + i, source: 'claude', id: a.id, title: a.title, project: a.project, openedAt: a.startedAt, lastActive: a.lastActivity,
            status: a.needsYou ? 'needs' : ['working', 'thinking', 'replying'].includes(a.status) ? 'working' : 'idle', inOffice: true,
            memBytes: (210 + i * 23) * 1024 ** 2, toolsMemBytes: (280 + i * 17) * 1024 ** 2, tools: 6 + (i % 2), cpuPct: 0.6 + i * 0.7,
          })),
          { pid: 4200, source: 'claude', id: 'demo-old-1', title: 'Morning code review', project: 'thrive-web', openedAt: t - 9 * 3600000, lastActive: t - 5.5 * 3600000, status: 'idle', inOffice: false, memBytes: 231 * 1024 ** 2, toolsMemBytes: 296 * 1024 ** 2, tools: 7, cpuPct: 0.5 },
          { pid: 4201, source: 'claude', id: 'demo-old-2', title: 'Triage Sentry alerts', project: 'thrive-backend', openedAt: t - 27 * 3600000, lastActive: t - 20 * 3600000, status: 'idle', inOffice: false, memBytes: 244 * 1024 ** 2, toolsMemBytes: 301 * 1024 ** 2, tools: 7, cpuPct: 0.9 },
          { pid: 4202, source: 'claude', id: null, title: null, project: 'Member-Management', openedAt: t - 40 * 60000, lastActive: null, status: 'new', inOffice: false, memBytes: 188 * 1024 ** 2, toolsMemBytes: 290 * 1024 ** 2, tools: 6, cpuPct: 0.4 },
        ],
      },
      agents: agents.map(({ steps, nextAt, phase, budget, tl, failing, ...view }) => ({
        ...view, recent: [...view.recent], counts: { ...view.counts }, timeline: [...view.timeline], files: [...view.files], results: [...view.results],
        context: { ...view.context }, tokens: { ...view.tokens }, lines: { ...view.lines },
      })),
      feed: [...feed],
    });
  }

  tick();
  setInterval(tick, 400);
}
