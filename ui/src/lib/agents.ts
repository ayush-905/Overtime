// How a live agent reads: what it's doing in a few words, since when, whether
// it's working, needs you or is idle, and which agents are waiting for you.
// Golden tests (limits.test.ts) hold the words.

export const WORKING = ['thinking', 'working', 'replying'];

export type LiveAgent = {
  id: string;
  kind: 'main' | 'sub';
  parentId?: string | null;
  source: 'claude' | 'codex';
  title: string;
  project: string | null;
  status: string;
  needsYou: string | null;
  endReason?: string | null;
  tool: { name: string; category?: string; verb?: string; detail?: string; startedAt?: number } | null;
  turnStartedAt: number | null;
  endedAt: number | null;
  lastActivity: number;
  results?: [number, number, string][];
  context?: { used: number; window: number; pct: number } | null;
};

/** When what an agent is doing now started, for its "how long" counter. */
export function sinceFor(a: LiveAgent) {
  if (a.needsYou === 'turn' || a.status === 'done') return a.endedAt;
  if (a.needsYou) return a.tool?.startedAt || a.endedAt;
  if (a.status === 'working' && a.tool) return a.tool.startedAt ?? null;
  if (a.turnStartedAt && (a.status === 'thinking' || a.status === 'replying')) return a.turnStartedAt;
  return a.lastActivity;
}

/** What an agent is doing, in a few words. */
export function doingText(a: LiveAgent) {
  switch (a.needsYou) {
    case 'turn': return a.endReason === 'interrupted' ? 'Stopped, waiting for you' : 'Done, waiting for you';
    case 'question': return 'Has a question for you';
    case 'plan': return 'Plan ready for your review';
    case 'approval': return 'Waiting for your approval';
  }
  const tool = a.tool;
  if (a.status === 'working' && tool) return tool.category === 'other' ? `Using ${tool.name}` : `${tool.verb} ${tool.detail || ''}`.trim();
  return ({ thinking: 'Thinking', replying: 'Writing a reply', done: 'Finished' } as Record<string, string>)[a.status] || 'Idle';
}

export type LiveState = 'needs' | 'working' | 'idle';

/** Needs you, working, or open and idle. */
export const liveStateOf = (a: LiveAgent): LiveState => (a.needsYou ? 'needs' : WORKING.includes(a.status) ? 'working' : 'idle');

/** Agents waiting for you right now, longest first. */
export function waitingNow(agents: LiveAgent[], now: number) {
  return agents
    .filter((a) => a.kind === 'main' && a.needsYou && sinceFor(a))
    .map((a) => ({ a, ms: Math.max(0, now - (sinceFor(a) as number)) }))
    .sort((x, y) => y.ms - x.ms);
}
