import { doingText, sinceFor, WORKING, type LiveAgent } from './agents';
import { stuckState, stuckText } from './limits';

export type AttentionItem = { agent: LiveAgent; label: string; detail: string; action: string; tone: 'warn' | 'bad'; since: number; priority: number };
export type WorkingItem = { agent: LiveAgent; doing: string; since: number; subagents: number };

/** One actionable row per main session; a stuck subagent belongs to its parent. */
export function attentionItems(agents: LiveAgent[], now: number, stuckMinutes: number): AttentionItem[] {
  const labels: Record<string, [string, string]> = {
    approval: ['Approval needed', 'Open approval'], question: ['Has a question', 'Open question'],
    plan: ['Plan ready', 'Review plan'], turn: ['Turn finished', 'Open session'],
  };
  return agents.filter((a) => a.kind === 'main').flatMap<AttentionItem>((agent) => {
    const since = sinceFor(agent) ?? agent.lastActivity;
    if (agent.needsYou) {
      const [label, action] = labels[agent.needsYou] || ['Needs you', 'Open session'];
      return [{ agent, label: agent.endReason === 'interrupted' && agent.needsYou === 'turn' ? 'Turn interrupted' : label, detail: 'Waiting for you', action, tone: 'warn' as const, since, priority: agent.needsYou === 'turn' ? 2 : 0 }];
    }
    if (!WORKING.includes(agent.status)) return [];
    const own = stuckState(agent, now, stuckMinutes);
    const sub = agents.find((a) => a.kind === 'sub' && a.parentId === agent.id && stuckState(a, now, stuckMinutes));
    const stuck = own || (sub && stuckState(sub, now, stuckMinutes));
    return stuck ? [{ agent, label: 'May be stuck', detail: `${own ? '' : 'Subagent: '}${stuckText(stuck, now)}`, action: 'Inspect session', tone: 'bad' as const, since: stuck.since, priority: 1 }] : [];
  }).sort((a, b) => a.priority - b.priority || a.since - b.since || a.agent.id.localeCompare(b.agent.id));
}

/**
 * The main sessions working now that the inbox doesn't already list (a stuck one is there), longest-running turn first,
 * so rows don't jump about as their tools change. Working subagents are counted on their parent's row.
 */
export function workingItems(agents: LiveAgent[], attention: AttentionItem[]): WorkingItem[] {
  const listed = new Set(attention.map((item) => item.agent.id));
  const turnStart = (a: LiveAgent) => a.turnStartedAt ?? a.lastActivity;
  return agents
    .filter((a) => a.kind === 'main' && !a.needsYou && WORKING.includes(a.status) && !listed.has(a.id))
    .map((agent) => ({
      agent,
      doing: doingText(agent),
      since: sinceFor(agent) ?? agent.lastActivity,
      subagents: agents.filter((s) => s.kind === 'sub' && s.parentId === agent.id && WORKING.includes(s.status)).length,
    }))
    .sort((a, b) => turnStart(a.agent) - turnStart(b.agent) || a.agent.id.localeCompare(b.agent.id));
}
