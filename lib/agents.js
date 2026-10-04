// The agent model shared by every transcript source: what an agent is doing,
// where in the office that happens, and the running totals shown in the UI.

import path from 'node:path';
import { contextWindow } from './pricing.js';
import { modelName } from './models.js';
import { notePrompt } from './titles.js';

export const PRESENT_MS = 30 * 60 * 1000; // idle longer than this and the agent goes home
const SUB_LINGER_MS = 20 * 1000; // finished subagents stay long enough to hand in their work
const STALL_THINKING_MS = 10 * 60 * 1000; // no writes mid-turn for this long: the session was closed
const STALL_TOOL_MS = 45 * 60 * 1000; // long builds and test runs are legitimate, so wait longer
// A read or edit still pending after this is almost always a permission prompt.
// Shell and web tools are excluded: they are often just slow.
const APPROVAL_HINT_MS = 7 * 1000;
const APPROVAL_CATEGORIES = new Set(['edit', 'read', 'search', 'other']);
const RESULTS_KEPT = 12; // recent tool results sent to the page, to spot an agent failing over and over
const TIMELINE_MS = 60 * 60 * 1000;
const TIMELINE_BUCKETS = 30;

const NAMES = [
  'Grace', 'Linus', 'Alan', 'Margaret', 'Dennis', 'Ken', 'Barbara', 'Donald', 'Edsger',
  'Guido', 'Bjarne', 'Katherine', 'Hedy', 'Radia', 'Frances', 'Brendan', 'Anders', 'Yukihiro',
  'Sophie', 'Evelyn', 'Joan', 'Jean', 'Mary', 'Annie', 'Karen', 'Leslie', 'Niklaus', 'Tim', 'Rich',
];

// Tool category → where in the office the work happens.
export const CATEGORIES = {
  edit: { zone: 'desk', icon: '⌨️', verb: 'Editing' },
  read: { zone: 'books', icon: '📖', verb: 'Reading' },
  search: { zone: 'books', icon: '🔎', verb: 'Searching' },
  bash: { zone: 'servers', icon: '💻', verb: 'Running' },
  web: { zone: 'web', icon: '🌐', verb: 'Browsing' },
  plan: { zone: 'board', icon: '📝', verb: 'Planning' },
  delegate: { zone: 'meeting', icon: '📞', verb: 'Briefing' },
  ask: { zone: 'desk', icon: '❓', verb: 'Asking you' },
  handback: { zone: 'desk', icon: '📄', verb: 'Handing in results' },
  other: { zone: 'files', icon: '🗂️', verb: 'Using' },
};

// What the activity timeline records for each category.
const TIMELINE_STATE = { search: 'read', ask: 'wait', handback: 'edit' };

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function oneLine(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return oneLine(url, 40); }
}

/**
 * Where an agent is now (`cwd`), and the folder its session belongs to
 * (`startCwd`): the one it was started in, which names its project and is where
 * it resumes from. Claude Code files a transcript under that folder (its path
 * with every other character turned into '-'), so the cwd whose name the
 * transcript's path holds is it; before one turns up, it's the first cwd seen.
 * An agent that cds into a subfolder stays in its project.
 */
export function noteCwd(a, cwd) {
  if (!cwd) return;
  a.cwd = cwd;
  if (a.rooted) return;
  if (a.file && a.file.split(path.sep).includes(cwd.replace(/[^a-zA-Z0-9]/g, '-'))) {
    a.startCwd = cwd;
    a.rooted = true;
  } else a.startCwd ||= cwd;
}

/** `priced`: whether its harness reports what each request costs as it goes (Codex doesn't). */
export function newAgent(id, { kind = 'main', parentId = null, source = 'claude', file = null, priced = true } = {}) {
  return {
    id, kind, parentId, source, file, priced,
    nick: NAMES[hash(id) % NAMES.length],
    seed: hash(id),
    title: null, agentName: null, firstPrompt: null, description: null, agentType: null,
    cwd: null, startCwd: null, rooted: false, branch: null, model: null, entrypoint: null,
    status: 'idle', // thinking | working | replying | waiting | done | idle
    zone: 'desk',
    needsYou: null, // null | turn | question | plan | approval
    tool: null,
    lastTool: null,
    pending: new Map(),
    turnStartedAt: null,
    turnEnded: false,
    endedAt: 0,
    endReason: null,
    startedAt: 0,
    lastActivity: 0,
    snippet: null,
    counts: {},
    recent: [],
    turns: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    costKnown: true,
    costState: 0,
    context: { used: 0, window: 0 },
    compactions: 0,
    lastCompactAt: 0,
    errors: 0,
    lastErrorAt: 0,
    results: [], // the last few tool calls that finished: [t, ok (1 or 0), tool name]
    files: new Map(), // path → { edits, added, removed, t }
    lines: { added: 0, removed: 0 },
    linesState: null,
    daily: {},
    marks: [],
    seenMessages: new Set(),
    metaLoaded: kind !== 'sub',
  };
}

export function categorize(name) {
  let key;
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': key = 'edit'; break;
    case 'Read': case 'NotebookRead': case 'Skill': key = 'read'; break;
    case 'Grep': case 'Glob': case 'LS': case 'ToolSearch': case 'LSP': key = 'search'; break;
    case 'Bash': case 'BashOutput': case 'KillShell': case 'KillBash': case 'Monitor': case 'TaskStop': key = 'bash'; break;
    case 'WebFetch': case 'WebSearch': key = 'web'; break;
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet':
    case 'EnterPlanMode': case 'ExitPlanMode': key = 'plan'; break;
    case 'Agent': case 'Task': case 'SendMessage': case 'Workflow': key = 'delegate'; break;
    case 'AskUserQuestion': key = 'ask'; break;
    case 'SubagentHandback': key = 'handback'; break;
    default:
      if (/^mcp__terminal__/.test(name)) key = 'bash';
      else if (/browser|chrome|playwright|puppeteer/i.test(name)) key = 'web';
      else if (/mark_chapter/.test(name)) key = 'plan';
      else key = 'other';
  }
  return { key, ...CATEGORIES[key] };
}

export function shortToolName(name) {
  if (!name.startsWith('mcp__')) return name;
  return name.split('__').pop().replace(/_/g, ' ');
}

// ── Bookkeeping ────────────────────────────────────────────────────────────

export function day(a, t) {
  const key = dayKey(t || Date.now());
  return (a.daily[key] ||= { cost: 0, tokens: 0, tools: 0, turns: 0, added: 0, removed: 0 });
}

export function touch(a, t) {
  if (!t) return;
  if (t > a.lastActivity) a.lastActivity = t;
  if (!a.startedAt || t < a.startedAt) a.startedAt = t;
}

export function mark(a, t, state) {
  if (!t) return;
  const last = a.marks[a.marks.length - 1];
  if (last && last.s === state) return;
  if (last && t < last.t) return;
  a.marks.push({ t, s: state });
  // Keep an hour of history plus the state that was active when it began.
  const cutoff = Date.now() - TIMELINE_MS - 60_000;
  while (a.marks.length > 2 && a.marks[1].t < cutoff) a.marks.shift();
}

function isLive(t) {
  return t && Date.now() - t < PRESENT_MS;
}

export function createFeed(max = 60) {
  const items = [];
  return {
    items,
    push(a, t, icon, text) {
      if (!isLive(t)) return;
      items.push({ t, agentId: a.id, who: a.nick, seed: a.seed, kind: a.kind, icon, text });
    },
    trim() {
      items.sort((x, y) => x.t - y.t);
      if (items.length > max) items.splice(0, items.length - max);
    },
  };
}

export function pushRecent(feed, a, t, icon, text) {
  a.recent.push({ t, icon, text });
  if (a.recent.length > 12) a.recent.shift();
  feed.push(a, t, icon, text);
}

// ── State transitions ──────────────────────────────────────────────────────

export function startTurn(feed, a, t, text) {
  a.status = 'thinking';
  a.zone = 'desk';
  a.needsYou = null;
  a.pending.clear();
  a.tool = null;
  a.turnStartedAt = t;
  a.turnEnded = false;
  a.endReason = null;
  a.snippet = null;
  a.turns++;
  day(a, t).turns++;
  if (text) notePrompt(a, oneLine(text, 70));
  mark(a, t, 'think');
  pushRecent(feed, a, t, '💬', a.kind === 'sub' ? 'Got an assignment' : 'Got a new task');
}

/** The agent carried on without a new prompt, e.g. woken by a background task finishing. */
export function resumeTurn(feed, a, t) {
  a.status = 'thinking';
  a.zone = 'desk';
  a.needsYou = null;
  a.turnStartedAt = t;
  a.turnEnded = false;
  a.endReason = null;
  mark(a, t, 'think');
  pushRecent(feed, a, t, '🔄', 'Picked the work back up');
}

export function endTurn(feed, a, t, why = 'done') {
  a.status = a.kind === 'sub' ? 'done' : 'waiting';
  a.zone = a.kind === 'sub' ? 'desk' : 'lounge';
  a.needsYou = a.kind === 'sub' ? null : 'turn';
  a.pending.clear();
  a.tool = null;
  a.endedAt = t || Date.now();
  a.endReason = why;
  mark(a, t, 'wait');
  if (!a.turnEnded) {
    const text = why === 'interrupted' ? 'Stopped by you' : a.kind === 'sub' ? 'Finished the assignment' : 'Done, waiting for you';
    pushRecent(feed, a, t, why === 'interrupted' ? '✋' : '✅', text);
  }
  a.turnEnded = true;
}

/** `edit` is an optional { path, added, removed } applied once the tool succeeds. */
export function startTool(feed, a, { id, name, detail, t, category, edit }) {
  const cat = category ? { key: category, ...CATEGORIES[category] } : categorize(name);
  const tool = {
    id, name: shortToolName(name), category: cat.key,
    icon: cat.icon, verb: cat.verb, detail, startedAt: t || Date.now(), edit,
  };
  a.pending.set(id, tool);
  a.tool = tool;
  a.lastTool = tool;
  a.status = 'working';
  a.zone = cat.zone;
  a.counts[cat.key] = (a.counts[cat.key] || 0) + 1;
  day(a, t).tools++;
  if (name === 'AskUserQuestion') a.needsYou = 'question';
  else if (name === 'ExitPlanMode') a.needsYou = 'plan';
  mark(a, t, TIMELINE_STATE[cat.key] || cat.key);
  const label = cat.key === 'other'
    ? `Using ${tool.name}${detail && detail !== tool.name ? ` · ${detail}` : ''}`
    : `${cat.verb} ${detail}`.trim();
  pushRecent(feed, a, t, cat.icon, label);
}

export function closeTool(a, id, t, { error = false, rejected = false } = {}) {
  const tool = a.pending.get(id);
  a.pending.delete(id);
  if (tool) {
    if (tool.category === 'ask' || tool.name === 'ExitPlanMode') a.needsYou = null;
    if (error && !rejected) {
      a.errors++;
      a.lastErrorAt = t || Date.now();
    }
    // A call you turned down isn't the agent failing, so it doesn't count either way.
    if (!rejected) {
      a.results.push([t || Date.now(), error ? 0 : 1, tool.name]);
      if (a.results.length > RESULTS_KEPT) a.results.shift();
    }
    if (tool.edit && !error) {
      const { path: file, added, removed } = tool.edit;
      const entry = a.files.get(file) || { edits: 0, added: 0, removed: 0, t: 0 };
      entry.edits++;
      entry.added += added;
      entry.removed += removed;
      entry.t = t || Date.now();
      a.files.set(file, entry);
      a.lines.added += added;
      a.lines.removed += removed;
      const d = day(a, t);
      d.added += added;
      d.removed += removed;
    }
  }
  if (a.tool && a.tool.id === id) a.tool = [...a.pending.values()].pop() || null;
  if (!a.pending.size) mark(a, t, 'think');
}

export function addUsage(a, t, tokens, cost) {
  a.tokens.input += tokens.input;
  a.tokens.output += tokens.output;
  a.tokens.cacheRead += tokens.cacheRead;
  a.tokens.cacheWrite += tokens.write5m + tokens.write1h;
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.write5m + tokens.write1h;
  const d = day(a, t);
  d.tokens += total;
  if (cost == null) a.costKnown = false;
  else {
    a.cost += cost;
    d.cost += cost;
  }
}

export function setContext(a, used, window) {
  // A sharp drop means the conversation was compacted even if we missed the marker.
  if (a.context.used > 60_000 && used < a.context.used * 0.4 && Date.now() - a.lastCompactAt > 60_000) a.lastCompactAt = Date.now();
  a.context.used = used;
  a.context.window = window || contextWindow(a.model, used);
}

export function compacted(feed, a, t) {
  a.compactions++;
  a.lastCompactAt = t || Date.now();
  pushRecent(feed, a, t, '🧹', 'Compacted its context');
}

// ── View sent to the browser ───────────────────────────────────────────────

// Claude Code gives each session a scratchpad, /private/tmp/claude-<uid>/<project>/<session>/scratchpad,
// where an agent tries things out, such as a headless `claude -p` to test a plugin.
const SCRATCHPAD = /\/claude-\d+\/[^/]+\/[0-9a-f-]{36}\/scratchpad(?:\/|$)/;

/**
 * The project a folder belongs to: its name, except that every agent's
 * scratchpad is one project, "Agent test runs", and the Claude app's chats
 * without a folder (its scratch workspaces) are "No folder".
 */
export function projectName(cwd) {
  if (!cwd) return null;
  if (SCRATCHPAD.test(cwd)) return 'Agent test runs';
  if (cwd.includes('/scratch-workspaces/')) return 'No folder';
  return path.basename(cwd);
}

function timeline(marks, now) {
  const start = now - TIMELINE_MS;
  const size = TIMELINE_MS / TIMELINE_BUCKETS;
  const out = new Array(TIMELINE_BUCKETS).fill(null);
  if (!marks.length) return out;
  for (let b = 0; b < TIMELINE_BUCKETS; b++) {
    const b0 = start + b * size;
    const b1 = b0 + size;
    const spent = {};
    for (let i = 0; i < marks.length; i++) {
      const s0 = Math.max(marks[i].t, b0);
      const s1 = Math.min(marks[i + 1]?.t ?? now, b1);
      if (s1 > s0) spent[marks[i].s] = (spent[marks[i].s] || 0) + (s1 - s0);
    }
    // Any real work in a slot beats thinking, and thinking beats waiting.
    let best = null;
    let bestScore = 0;
    for (const [s, ms] of Object.entries(spent)) {
      const score = ms * (s === 'wait' ? 0.2 : s === 'think' ? 0.6 : 1);
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
    out[b] = best;
  }
  return out;
}

export function view(a, now) {
  const idle = now - a.lastActivity;
  let { status, zone, needsYou } = a;
  let tool = a.tool;
  if ((status === 'thinking' || status === 'replying') && idle > STALL_THINKING_MS) {
    status = 'idle';
    zone = a.kind === 'sub' ? 'desk' : 'lounge';
  }
  if (status === 'working' && idle > STALL_TOOL_MS) {
    status = 'idle';
    zone = 'lounge';
    tool = null;
  }
  if (status === 'working' && tool && !needsYou && APPROVAL_CATEGORIES.has(tool.category) && now - tool.startedAt > APPROVAL_HINT_MS) {
    needsYou = 'approval';
  }
  const present = a.kind === 'main'
    ? a.lastActivity > 0 && idle < PRESENT_MS
    : status === 'done' ? now - a.endedAt < SUB_LINGER_MS : a.lastActivity > 0 && idle < STALL_THINKING_MS;
  // Its project and folder are where it was started, wherever it has cd'd to since.
  const home = a.startCwd || a.cwd;
  const project = projectName(home);
  const files = [...a.files.entries()]
    .sort((x, y) => y[1].t - x[1].t)
    .slice(0, 8)
    .map(([file, f]) => ({ path: file, name: path.basename(file), edits: f.edits, added: f.added, removed: f.removed }));
  const lines = a.linesState && a.linesState.added + a.linesState.removed > a.lines.added + a.lines.removed ? a.linesState : a.lines;
  const cost = Math.max(a.cost, a.costState || 0);
  return {
    id: a.id,
    nativeId: a.nativeId || a.id,
    kind: a.kind,
    source: a.source,
    parentId: a.parentId,
    nick: a.nick,
    seed: a.seed,
    title: a.agentName || a.title || (a.kind === 'sub' ? a.description : null) || a.firstPrompt || project || 'Untitled session',
    project,
    cwd: home,
    branch: a.branch,
    model: a.model,
    modelName: a.model ? modelName(a.model) : null,
    entrypoint: a.entrypoint,
    background: /^sdk/.test(a.entrypoint || ''),
    agentType: a.agentType,
    status,
    zone,
    needsYou,
    tool: tool && { name: tool.name, category: tool.category, icon: tool.icon, verb: tool.verb, detail: tool.detail, startedAt: tool.startedAt },
    lastTool: a.lastTool && { name: a.lastTool.name, icon: a.lastTool.icon, verb: a.lastTool.verb, detail: a.lastTool.detail },
    turnStartedAt: a.turnStartedAt,
    endedAt: a.endedAt,
    endReason: a.endReason,
    startedAt: a.startedAt,
    lastActivity: a.lastActivity,
    snippet: a.snippet,
    counts: a.counts,
    turns: a.turns,
    tokens: { ...a.tokens, total: a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite },
    cost: cost || (a.priced ? 0 : null),
    costKnown: a.costKnown && a.priced,
    context: a.context.used ? { used: a.context.used, window: a.context.window, pct: Math.min(100, Math.round((a.context.used / a.context.window) * 100)) } : null,
    compactions: a.compactions,
    lastCompactAt: a.lastCompactAt,
    errors: a.errors,
    lastErrorAt: a.lastErrorAt,
    results: a.results.slice(),
    files,
    lines,
    timeline: timeline(a.marks, now),
    recent: a.recent.slice(-8),
    present,
  };
}
