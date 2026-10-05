// Insights for the dashboard: where the money goes, the 30-day trend, the
// hour-of-day and weekday patterns, what caching saved, how context size drives
// cost, how many agents worked at once, which tool calls failed, the messages
// you sent (how long each kept an agent busy and what it cost), your working
// hours, how long your agents waited for you, how you use the 5-hour session
// windows, the most expensive sessions today, today as a timeline of sessions,
// the skills used and not, the prompts you repeat, a summary of each of the last 30 days, every session
// of the last 30 days and a weekly digest. Costs are at API list prices.
//
// Each is worked out in lib/insights/: time.js (days, the working day and
// stretches of time), common.js (what the others share), spend.js (where the
// money goes), turns.js (stretches of work and your messages), you.js (your time
// and your agents') and sessions.js (sessions, one at a time and all of them).
// This module puts them together.
// @ts-check
/** @import { ActivitySummary, ComputedInsights, TodaySession } from '../types/api.js' */

import { skillUsage } from './skills.js';
import { repeatedPrompts } from './prompts.js';
import { turnPerformance } from './turn-performance.js';
import { dayStart } from './insights/time.js';
import { contextOf, sessionTitle } from './insights/common.js';
import {
  breakdown,
  cacheStats,
  contextHealth,
  longContextStats,
  toolFailures,
  trend,
  weekdays,
} from './insights/spend.js';
import { messageStats, parallelWork, turns, waitingStats } from './insights/turns.js';
import { agentHours, dailyTotals, sessionPlan, todayTimeline, workingHours, yourTime } from './insights/you.js';
import { topSessions } from './insights/sessions.js';

export { setWorkdayHour } from './insights/time.js';
export { sessionDetail, sessionList, turnDetail, weeklyDigest } from './insights/sessions.js';

/** @returns {ComputedInsights | null} */
export function computeInsights({ index, agents, now = Date.now() }) {
  if (!index.ready()) return null;
  const events = index.events();
  const mine = yourTime(index, now);
  const hours = workingHours(now, mine);
  const recent = turns(index, dayStart(now, 6));
  const projectOf = (rec) => index.projectOf(rec);
  return {
    breakdown: {
      d7: breakdown(events, dayStart(now, 6), projectOf),
      d30: breakdown(events, dayStart(now, 29), projectOf),
    },
    trend: { ...trend(events, now), weekdays: weekdays(events, now) },
    cache: { d7: cacheStats(events, dayStart(now, 6)), today: cacheStats(events, dayStart(now)) },
    context: contextHealth(index, events, dayStart(now, 6)),
    longContext: longContextStats(index, agents, events, dayStart(now, 6)),
    tools: toolFailures(index, now),
    messages: messageStats(index, agents, now, recent),
    turnPerformance: turnPerformance(recent, agents, now),
    waiting: waitingStats(index, agents, now, recent),
    parallel: parallelWork(index, now),
    hours,
    agentHours: agentHours(index, now, mine),
    // Only Claude Code's 5-hour windows are rebuilt from its usage (Codex records its own).
    windows: index.source === 'claude' ? sessionPlan(index, now, hours) : null,
    topSessions: topSessions(index, agents, now),
    timeline: todayTimeline(index, agents, now, mine),
    skills: skillUsage(index, now),
    repeats: repeatedPrompts(index, now, index.youTextAt),
    // For the heatmap's history; the server keeps it and serves it on its own.
    daily: dailyTotals(index, now, mine),
    computedAt: now,
  };
}

/**
 * Today's totals for the Today's activity card, from the same provider-filtered
 * index as the charts: tokens, cost, tool calls, lines changed, and the sessions
 * that did some work, priciest first.
 * @returns {ActivitySummary}
 */
export function activitySummary(index, agents, now = Date.now()) {
  const start = dayStart(now);
  const totals = /** @type {ActivitySummary} */ ({
    tokens: 0,
    cost: 0,
    costPartial: false,
    tools: 0,
    added: 0,
    removed: 0,
    sessions: 0,
    sessionList: [],
  });
  /** @type {Map<string, TodaySession>} */
  const sessions = new Map();
  for (const [t, cost, tokens, , rec, d] of index.events()) {
    if (t < start || t > now) continue;
    totals.tokens += tokens;
    totals.cost += cost;
    totals.costPartial ||= d?.costKnown === false;
    let row = sessions.get(rec.session);
    if (!row)
      sessions.set(
        rec.session,
        (row = {
          id: rec.session,
          source: rec.source,
          title: sessionTitle(index, agents, rec.session),
          project: index.projectOf(rec),
          cost: 0,
          tokens: 0,
          partial: false,
          context: contextOf(index.sessionRecord(rec.session)),
        }),
      );
    row.cost += cost;
    row.tokens += tokens;
    row.partial ||= d?.costKnown === false;
  }
  for (const [t, added, removed] of index.edits()) {
    if (t < start || t > now) continue;
    totals.added += added;
    totals.removed += removed;
  }
  totals.tools = index.calls().filter((c) => c.t >= start && c.t <= now).length;
  totals.sessions = sessions.size;
  totals.sessionList = [...sessions.values()].sort((a, b) => b.cost - a.cost);
  return totals;
}
