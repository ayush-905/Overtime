// What the insight modules share: a session's name, how full its conversation
// is, a tool's name as the cards show it, the top few of a list with the rest
// summed up, and the median.
// @ts-check
/** @import { CostItem, RecordedContext } from '../../types/api.js' */

import { contextWindow } from '../pricing.js';

/** @param {(number | null | undefined)[]} values @returns {number | null} */
export function median(values) {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

/** @param {Map<string, { cost: number, tokens: number }>} map @returns {CostItem[]} */
export function topList(map, limit = 5) {
  const sorted = [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
  /** @type {CostItem[]} */
  const top = sorted.slice(0, limit).map(([name, v]) => ({ name, ...v }));
  const rest = sorted.slice(limit);
  if (rest.length) {
    top.push({
      name: `${rest.length} other${rest.length === 1 ? '' : 's'}`,
      cost: rest.reduce((n, [, v]) => n + v.cost, 0),
      tokens: rest.reduce((n, [, v]) => n + v.tokens, 0),
      other: true,
    });
  }
  return top;
}

export function add(map, key, cost, tokens) {
  const v = map.get(key) || { cost: 0, tokens: 0 };
  v.cost += cost;
  v.tokens += tokens;
  map.set(key, v);
}

/** `mcp__Claude_Browser__computer` → `computer (Claude Browser)`; built-in tools keep their name. */
export function prettyTool(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name || '');
  if (!m) return name || 'Unknown';
  if (/^[0-9a-f-]{16,}$/i.test(m[1])) return m[2];
  return `${m[2]} (${m[1]
    .replace(/^plugin_[^_]+_/, '')
    .replace(/^claude_ai_/, '')
    .replace(/_/g, ' ')})`;
}

/** A session's name: what the live agent shows, else what its transcript says. @returns {string} */
export function sessionTitle(index, agents, id, rec = index.sessionRecord(id)) {
  const live = agents.get(id);
  return (
    live?.agentName ||
    live?.title ||
    rec?.agentName ||
    rec?.title ||
    rec?.firstPrompt ||
    rec?.project ||
    'Untitled session'
  );
}

/**
 * How full a session's conversation is: its last reply's context against its
 * model's window, and when that was. Null before its first reply.
 * @returns {RecordedContext | null}
 */
export function contextOf(rec) {
  for (let i = (rec?.events.length || 0) - 1; i >= 0; i--) {
    const [t, , , model, , d] = rec.events[i];
    if (!(d?.context > 0)) continue;
    const window = rec.contextWindow || contextWindow(model, d.context);
    return { used: d.context, window, pct: Math.min(100, Math.round((d.context / window) * 100)), at: t };
  }
  return null;
}
