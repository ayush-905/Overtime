// The Projects page's view: every project of the range with its totals, sorted,
// and the remembered range and sort. Built from the same session list as the
// Sessions page, so the two always agree. Its address is #projects?p=shop&range=7.

import { measureOf } from './measure';
import type { Range } from './sessionsView';
import type { SessionInRange } from './sessions';

export const PROJECTS_VIEW_KEY = 'overtime-projects-view';
/** 'cost' sorts by what you compare by, cost or tokens. */
export const PROJECT_SORTS = ['cost', 'agentMs', 'recent'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export type Project = {
  name: string;
  sessions: SessionInRange[];
  cost: number;
  tokens: number;
  partial: boolean;
  messages: number;
  agentMs: number;
  waitMs: number;
  added: number;
  removed: number;
  tools: number;
  failed: number;
  lastAt: number;
  bySource: { claude: { cost: number; tokens: number }; codex: { cost: number; tokens: number } };
};

const SUMS = ['cost', 'tokens', 'messages', 'agentMs', 'waitMs', 'added', 'removed', 'tools', 'failed'] as const;

export function readProjectsView(): { range: Range; sort: ProjectSort } {
  const out: { range: Range; sort: ProjectSort } = { range: '30', sort: 'cost' };
  try {
    const stored = JSON.parse(localStorage.getItem(PROJECTS_VIEW_KEY) || '{}');
    if (['today', '7', '30'].includes(stored.range)) out.range = stored.range;
    if ((PROJECT_SORTS as readonly string[]).includes(stored.sort)) out.sort = stored.sort;
  } catch {}
  return out;
}

export function writeProjectsView(v: { range: Range; sort: ProjectSort }) {
  try {
    localStorage.setItem(PROJECTS_VIEW_KEY, JSON.stringify(v));
  } catch {}
}

/** Each project's sessions and totals, sorted. Sessions without a folder are "Unknown". */
export function projectsOf(sessions: SessionInRange[], sort: ProjectSort): Project[] {
  const map = new Map<string, Project>();
  for (const s of sessions) {
    const name = s.project || 'Unknown';
    let p = map.get(name);
    if (!p) map.set(name, (p = { name, sessions: [], cost: 0, tokens: 0, partial: false, messages: 0, agentMs: 0, waitMs: 0, added: 0, removed: 0, tools: 0, failed: 0, lastAt: 0, bySource: { claude: { cost: 0, tokens: 0 }, codex: { cost: 0, tokens: 0 } } }));
    p.sessions.push(s);
    for (const k of SUMS) p[k] += s[k];
    p.partial ||= s.partial;
    p.lastAt = Math.max(p.lastAt, s.lastAt);
    const by = p.bySource[s.source === 'codex' ? 'codex' : 'claude'];
    by.cost += s.cost;
    by.tokens += s.tokens;
  }
  const value: Record<ProjectSort, (p: Project) => number> = { cost: (p) => measureOf(p), agentMs: (p) => p.agentMs, recent: (p) => p.lastAt };
  return [...map.values()].sort((a, b) => value[sort](b) - value[sort](a) || measureOf(b) - measureOf(a));
}
