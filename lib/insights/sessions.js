// Sessions: today's priciest, every session of the last 30 days (for the
// Sessions and Projects pages), the weekly digest built from them, one session in
// full for its panel, and one of your messages with what it led to.
// @ts-check
/** @import { DigestProject, DigestSession, DigestTotals, SessionDay, SessionDetail, SessionListItem, Source, SpendSeries, TopSession, TurnCommand, TurnDetail, TurnFile, WeeklyDigest } from '../../types/api.js' */

import { PRESENT_MS } from '../agents.js';
import { modelName } from '../models.js';
import { SOURCES, harness } from '../harnesses/index.js';
import { DAY, HOUR, MINUTE, clip, dayStart, daysAfter, totalMs, weekStart } from './time.js';
import { add, contextOf, prettyTool, sessionTitle, topList } from './common.js';
import { settleTurns, turns, waited } from './turns.js';
import { yourTime } from './you.js';

/** Today's sessions, priciest first: what each cost (its subagents' too), its tokens, the lines it changed and how full it is. @returns {TopSession[]} */
export function topSessions(index, agents, now) {
  const since = dayStart(now);
  /** @typedef {{ source: Source, cost: number, unpriced?: boolean, tokens: number, subCost: number, added: number, removed: number, first: number, last: number }} TopRow */
  /** @type {Map<string, TopRow>} */
  const sessions = new Map();
  for (const [t, c, n, , rec, d] of index.events()) {
    if (t < since) continue;
    // Every record of a session (its subagents' too) is its harness's, so any says which.
    const s =
      sessions.get(rec.session) ||
      /** @type {TopRow} */ ({
        source: rec.source,
        cost: 0,
        tokens: 0,
        subCost: 0,
        added: 0,
        removed: 0,
        first: t,
        last: t,
      });
    s.cost += c;
    s.unpriced ||= d?.costKnown === false;
    s.tokens += n;
    if (rec.sub) s.subCost += c;
    s.last = Math.max(s.last, t);
    sessions.set(rec.session, s);
  }
  for (const [t, added, removed, rec] of index.edits()) {
    if (t < since) continue;
    const s = sessions.get(rec.session);
    if (!s) continue;
    s.added += added;
    s.removed += removed;
  }
  // The priciest, and the ones that used the most tokens (a model with no known price costs nothing here).
  const all = [...sessions.entries()];
  const top = (key) => [...all].sort((a, b) => b[1][key] - a[1][key]).slice(0, 12);
  return [...new Set([...top('cost'), ...top('tokens')])]
    .sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens)
    .map(([id, s]) => {
      const rec = index.sessionRecord(id);
      const live = agents.get(id);
      return {
        id,
        source: s.source,
        title: sessionTitle(index, agents, id),
        project: rec ? index.projectOf(rec) : null,
        cost: s.cost,
        partial: !!s.unpriced,
        subCost: s.subCost,
        tokens: s.tokens,
        added: s.added,
        removed: s.removed,
        linesPerDollar: s.cost > 0.05 ? (s.added + s.removed) / s.cost : null,
        inOffice: !!live && now - live.lastActivity < PRESENT_MS,
        last: s.last,
        context: contextOf(rec),
      };
    });
}

const LIST_DAYS = 30;

/**
 * Every session of the last 30 days, for the Sessions and Projects pages, newest
 * first: the models it used, when it started and was last active, and what it
 * did on each day it ran (cost with subagents, your messages, how long the agent
 * worked on them and waited for you, lines changed, tool calls), so any range
 * adds up exactly. A session that never got a reply (no tokens, no tool calls),
 * like a test run that couldn't sign in, is left out, unless it's still waiting
 * for its first.
 * @returns {SessionListItem[]}
 */
export function sessionList(index, agents, now = Date.now()) {
  const since = dayStart(now, LIST_DAYS - 1);
  /** @typedef {{ source: Source, rec: any, days: Map<number, SessionDay>, subs: Set<any>, models: Map<string, { cost: number, tokens: number }>, lastAt: number }} ListRow */
  /** @type {Map<string, ListRow>} */
  const rows = new Map();
  /** @param {ListRow} s @param {number} t */
  const dayOf = (s, t) => {
    const key = dayStart(t);
    let d = s.days.get(key);
    if (!d)
      s.days.set(
        key,
        (d = {
          day: key,
          cost: 0,
          subCost: 0,
          tokens: 0,
          messages: 0,
          agentMs: 0,
          waitMs: 0,
          waits: 0,
          added: 0,
          removed: 0,
          tools: 0,
          failed: 0,
        }),
      );
    s.lastAt = Math.max(s.lastAt, t);
    return d;
  };
  // Every record of a session (its subagents' too) is its harness's, so the first says which.
  const row = (rec) => {
    let s = rows.get(rec.session);
    if (!s)
      rows.set(
        rec.session,
        (s = { source: rec.source, rec: null, days: new Map(), subs: new Set(), models: new Map(), lastAt: 0 }),
      );
    if (!rec.sub) s.rec ||= rec;
    return s;
  };
  for (const [t, c, n, model, rec, d] of index.events()) {
    if (t < since) continue;
    const s = row(rec);
    const day = dayOf(s, t);
    day.cost += c;
    day.tokens += n;
    if (d?.costKnown === false) day.partial = true;
    if (rec.sub) {
      day.subCost += c;
      s.subs.add(rec);
    }
    add(s.models, modelName(model), c, n);
  }
  for (const x of turns(index, since)) {
    if (x.kind !== 'human') continue;
    const day = dayOf(row(x.rec), x.t);
    day.messages++;
    day.agentMs += x.end - x.t;
    if (waited(x)) {
      day.waitMs += x.waitMs;
      day.waits++;
    }
  }
  for (const [t, added, removed, rec] of index.edits()) {
    const s = t >= since && rows.get(rec.session);
    if (!s) continue;
    const day = dayOf(s, t);
    day.added += added;
    day.removed += removed;
  }
  for (const c of index.calls()) {
    const s = c.t >= since && rows.get(c.rec.session);
    if (!s) continue;
    const day = dayOf(s, c.t);
    day.tools++;
    if (c.status === 'error') day.failed++;
  }
  const replied = (s) => [...s.days.values()].some((d) => d.tokens > 0 || d.tools > 0);
  const waiting = (id) => {
    const a = agents?.get(id);
    return !!a && !a.turnEnded && now - a.lastActivity < PRESENT_MS;
  };
  return [...rows.entries()]
    .filter(([id, s]) => replied(s) || waiting(id))
    .map(([id, s]) => {
      const rec = s.rec || index.sessionRecord(id);
      const models = [...s.models.entries()].filter(([name]) => name !== 'unknown');
      const model = [...models].sort((a, b) => b[1].tokens - a[1].tokens)[0]?.[0];
      return {
        id,
        source: s.source,
        title: sessionTitle(index, agents, id, rec),
        project: rec ? index.projectOf(rec) : null,
        model: model || null,
        models: models
          .sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens)
          .slice(0, 3)
          .map(([name, v]) => ({ name, cost: v.cost, tokens: v.tokens })),
        // When it began, even if that was before the last 30 days.
        startedAt: Math.min(rec?.prompts[0]?.[0] ?? Infinity, rec?.events[0]?.[0] ?? Infinity, s.lastAt),
        lastAt: s.lastAt,
        subagents: s.subs.size,
        context: contextOf(rec),
        days: [...s.days.values()].sort((a, b) => a.day - b.day),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * A week in review, Monday to Sunday: last week (`weeksAgo` 1) or this one so far
 * (0), with the same days of the week before for comparison. Built from the
 * session list, so it matches the Sessions and Projects pages; your active time
 * and limit hits come from the same index.
 * @returns {WeeklyDigest}
 */
export function weeklyDigest(index, agents, now = Date.now(), weeksAgo = 1) {
  const from = weekStart(now, -weeksAgo);
  const to = weeksAgo ? weekStart(now, 1 - weeksAgo) : daysAfter(now, 1);
  const days = Math.round((to - from) / DAY);
  const before = [weekStart(now, -weeksAgo - 1), daysAfter(weekStart(now, -weeksAgo - 1), days)];
  const list = sessionList(index, agents, now);
  const mine = yourTime(index, now);

  /** @returns {DigestTotals} */
  function totals(a, b) {
    const t = /** @type {DigestTotals} */ ({
      cost: 0,
      partial: false,
      sessions: 0,
      messages: 0,
      agentMs: 0,
      waitMs: 0,
      waits: 0,
      added: 0,
      removed: 0,
      tools: 0,
      failed: 0,
      bySource: Object.fromEntries(SOURCES.map((s) => [s, 0])),
    });
    /** @type {Map<string | null, DigestProject>} */
    const projects = new Map();
    /** @type {Map<number, number>} */
    const perDay = new Map();
    /** @type {DigestSession[]} */
    const sessions = [];
    for (const s of list) {
      const own = s.days.filter((d) => d.day >= a && d.day < b);
      if (!own.length) continue;
      const x = { id: s.id, title: s.title, project: s.project, source: s.source, cost: 0, messages: 0, agentMs: 0 };
      for (const d of own) {
        for (const k of ['cost', 'messages', 'agentMs', 'waitMs', 'waits', 'added', 'removed', 'tools', 'failed'])
          t[k] += d[k] || 0;
        t.partial ||= !!d.partial;
        x.cost += d.cost;
        x.messages += d.messages;
        x.agentMs += d.agentMs;
        perDay.set(d.day, (perDay.get(d.day) || 0) + d.cost);
      }
      t.sessions++;
      t.bySource[s.source] = (t.bySource[s.source] || 0) + x.cost;
      sessions.push(x);
      const p = projects.get(s.project) || { name: s.project || 'Unknown', cost: 0, sessions: 0, agentMs: 0 };
      p.cost += x.cost;
      p.sessions++;
      p.agentMs += x.agentMs;
      projects.set(s.project, p);
    }
    t.activeMs = totalMs(clip(mine.stretches, a, Math.min(b, now)));
    t.projects = [...projects.values()].sort((x, y) => y.cost - x.cost).slice(0, 5);
    t.topSessions = sessions.sort((x, y) => y.cost - x.cost).slice(0, 5);
    t.busiest = [...perDay.entries()].sort((x, y) => y[1] - x[1])[0] || null;
    return t;
  }

  // Limits you ran into: Claude's as Claude Code recorded them; Codex's as the
  // windows whose readings reached 100%.
  const inWeek = (t) => t >= from && t < to;
  const codexHit = new Set();
  for (const [t, bucket, kind, used, reset] of index.quotaLog?.() || [])
    if (used >= 100 && inWeek(t)) codexHit.add(`${bucket}:${kind}:${Math.round(reset / 600_000)}`);
  return {
    from,
    to,
    weeksAgo,
    days,
    ...totals(from, to),
    before: totals(...before),
    // Claude Code notes a hit on every retry; each window counts once.
    hits: {
      claude: new Set(
        index
          .hits()
          .filter((h) => inWeek(h.t))
          .map((h) => `${h.type}:${Math.round(h.resetsAt / 600_000)}`),
      ).size,
      codex: codexHit.size,
    },
    computedAt: now,
  };
}

/**
 * One session in full, from the index: when it ran, what it cost and on what,
 * your messages with what each one set off, its subagents, edits and tool calls,
 * and its cost over time. For the dashboard's session panel.
 * @returns {SessionDetail | null}
 */
export function sessionDetail(index, id) {
  const recs = index.recordsOf(id);
  if (!recs.length) return null;
  const main = recs.find((r) => !r.sub) || null;
  const subs = recs.filter((r) => r.sub);
  const events = recs.flatMap((r) => r.events).sort((a, b) => a[0] - b[0]);
  const tokens = { fresh: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Map();
  let cost = 0;
  let subCost = 0;
  let saved = 0;
  for (const [, c, n, model, rec, d] of events) {
    cost += c;
    if (rec.sub) subCost += c;
    tokens.fresh += d.fresh;
    tokens.output += d.output;
    tokens.cacheRead += d.read;
    tokens.cacheWrite += d.write;
    saved += d.saved || 0;
    add(models, modelName(model), c, n);
  }
  const edits = recs.flatMap((r) => r.edits);
  const calls = recs.flatMap((r) => r.calls);
  /** @type {Map<string, number>} */
  const byTool = new Map();
  for (const c of calls) byTool.set(prettyTool(c.name), (byTool.get(prettyTool(c.name)) || 0) + 1);

  // Your messages, and what each one set off, as in the Your messages card.
  const turnList = settleTurns(
    [...(main?.prompts || [])].sort((a, b) => a[0] - b[0]),
    events,
  );
  const mine = turnList.filter((x) => x.kind === 'human');
  const partial = events.some((e) => e[5]?.costKnown === false);

  // Both lists are in time order, so their ends are the session's.
  const ends = [
    events[0]?.[0],
    events[events.length - 1]?.[0],
    turnList[0]?.t,
    turnList[turnList.length - 1]?.t,
  ].filter((t) => t != null);
  const firstAt = ends.length ? Math.min(...ends) : null;
  const lastAt = ends.length ? Math.max(...ends) : null;
  // Cost over time, in steps that suit how long the session ran.
  /** @type {SpendSeries | null} */
  let timeline = null;
  if (firstAt != null) {
    // Both ends come from the same list, so there's a last when there's a first.
    const last = /** @type {number} */ (lastAt);
    const span = last - firstAt;
    const step = span <= 6 * HOUR ? 10 * MINUTE : span <= 2 * DAY ? HOUR : DAY;
    const from = step === DAY ? dayStart(firstAt) : Math.floor(firstAt / step) * step;
    const costs = new Array(Math.floor((last - from) / step) + 1).fill(0);
    for (const [t, c] of events) costs[Math.floor((t - from) / step)] += c;
    timeline = { from, step, costs };
  }
  const subInfo = subs.map((r) => ({
    title: r.agentName || r.firstPrompt || 'Subagent',
    cost: r.events.reduce((n, e) => n + e[1], 0),
    partial: r.events.some((e) => e[5]?.costKnown === false),
    firstAt: r.events[0]?.[0] ?? r.prompts[0]?.[0] ?? null,
    lastAt: r.events[r.events.length - 1]?.[0] ?? null,
    calls: r.calls.length,
  }));
  return {
    id,
    nativeId: main?.nativeId || id,
    source: main?.source || recs[0].source,
    title: main?.agentName || main?.title || main?.firstPrompt || null,
    project: index.projectOf(main || recs[0]),
    cwd: main?.cwd || null,
    firstAt,
    lastAt,
    cost,
    partial,
    subCost,
    saved,
    tokens: { ...tokens, total: tokens.fresh + tokens.output + tokens.cacheRead + tokens.cacheWrite },
    models: topList(models, 3),
    lines: { added: edits.reduce((n, e) => n + e[1], 0), removed: edits.reduce((n, e) => n + e[2], 0) },
    tools: {
      calls: calls.length,
      failed: calls.filter((c) => c.status === 'error').length,
      denied: calls.filter((c) => c.status === 'denied').length,
      top: [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    },
    compactions: recs.reduce((n, r) => n + r.compactions.length, 0),
    context: contextOf(main),
    // How long the agent worked on your messages, and waited for you, as the Sessions page counts them.
    agentMs: mine.reduce((n, x) => n + (x.end - x.t), 0),
    waitMs: mine.filter(waited).reduce((n, x) => n + x.waitMs, 0),
    messages: {
      count: mine.length,
      interrupts: turnList.filter((x) => x.kind === 'interrupt').length,
      list: mine
        .slice(-40)
        .reverse()
        .map((x) => ({ t: x.t, text: x.text, cost: x.cost, partial: x.unpriced, ms: x.end - x.t })),
    },
    subagents: { count: subs.length, list: subInfo.sort((a, b) => b.cost - a.cost).slice(0, 8) },
    timeline,
  };
}

/**
 * One of your messages in a session, with what it led to: the message itself,
 * the agent's replies to it (while search keeps the text), the files it read
 * and changed, the commands it ran, and what it cost. `at` is any moment in it,
 * like the time of a search's match: the message is the one you sent last by
 * then, and it runs until your next.
 * @returns {TurnDetail | null}
 */
export function turnDetail(index, id, at) {
  const recs = index.recordsOf(id);
  const main = recs.find((r) => !r.sub);
  if (!main) return null;
  const human = main.prompts.filter((p) => p[2] === 'human').sort((a, b) => a[0] - b[0]);
  const start = human.filter((p) => p[0] <= at + 1000).pop() || human[0];
  if (!start) return null;
  const next = human.find((p) => p[0] > start[0]);
  const from = start[0];
  const to = next ? next[0] : Infinity;
  const inTurn = (t) => t >= from && t < to;
  /** @type {Map<string, TurnFile>} */
  const files = new Map();
  const file = (p) =>
    /** @type {TurnFile} */ (
      files.get(p) || files.set(p, { path: p, reads: 0, edits: 0, added: 0, removed: 0 }).get(p)
    );
  /** @type {TurnCommand[]} */
  const commands = [];
  /** @type {Map<string, number>} */
  const tools = new Map();
  let failed = 0;
  let denied = 0;
  let subagents = 0;
  for (const r of recs) {
    for (const c of r.calls) {
      if (!inTurn(c.t)) continue;
      tools.set(prettyTool(c.name), (tools.get(prettyTool(c.name)) || 0) + 1);
      if (c.status === 'error') failed++;
      if (c.status === 'denied') denied++;
      // Each harness says which of its tools read and write files, run commands and brief subagents.
      const kinds = harness(r.source).tools;
      if (kinds.delegate(c.name)) subagents++;
      if (c.file && kinds.reads.has(c.name)) file(c.file).reads++;
      if (c.file && kinds.writes.has(c.name)) file(c.file).edits++;
      if (c.what && kinds.command(c.name))
        commands.push({ t: c.t, text: c.what, status: c.status, reason: c.reason, sub: !!r.sub });
    }
    for (const [t, added, removed, , p] of r.edits) {
      if (!inTurn(t) || !p) continue;
      const f = file(p);
      f.added += added;
      f.removed += removed;
      f.edits ||= 1;
    }
  }
  let cost = 0;
  let tokens = 0;
  let last = from;
  let partial = false;
  for (const r of recs) {
    for (const [t, c, n, , , d] of r.events) {
      if (!inTurn(t)) continue;
      cost += c;
      tokens += n;
      last = Math.max(last, t);
      partial ||= d?.costKnown === false;
    }
  }
  const replies = (main.texts || [])
    .filter(([t, who]) => who === 'agent' && inTurn(t))
    .map(([t, , text]) => ({ t, text }));
  const own = index.youTextAt(main, from);
  return {
    id,
    cwd: main.cwd || null,
    t: from,
    next: next ? next[0] : null,
    text: own || start[3] || '',
    whole: !!own,
    searchOn: index.searchOn(),
    replies: replies.length > 24 ? [...replies.slice(0, 4), ...replies.slice(-20)] : replies,
    moreReplies: Math.max(0, replies.length - 24),
    files: [...files.values()]
      .sort(
        (a, b) =>
          /** @type {any} */ (b.edits > 0) - /** @type {any} */ (a.edits > 0) ||
          b.added + b.removed - (a.added + a.removed) ||
          b.reads - a.reads,
      )
      .slice(0, 40),
    moreFiles: Math.max(0, files.size - 40),
    commands: commands.slice(-30),
    moreCommands: Math.max(0, commands.length - 30),
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    failed,
    denied,
    subagents,
    cost,
    partial,
    tokens,
    ms: last - from,
  };
}
