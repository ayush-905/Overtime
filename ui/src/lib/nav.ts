// The sections, and the sidebar in your order: sections sit in groups under a
// heading each (Work, Plans & cost, Activity), and a section moves only within
// its group, so a heading always names what's under it. You can hide the ones
// you don't use (at least one stays); a hidden one is still in ⌘K and its links
// still work. Settings stays at the foot.

import { readNav, saveNav } from './prefs';

export const PAGES = ['overview', 'sessions', 'projects', 'usage', 'cost', 'agents', 'you', 'settings'] as const;
export type Page = (typeof PAGES)[number];

export const TITLES: Record<Page, string> = {
  overview: 'Overview',
  sessions: 'Sessions',
  projects: 'Projects',
  usage: 'Usage',
  cost: 'Cost',
  agents: 'Agents',
  you: 'You',
  settings: 'Settings',
};

/** A section's group heading; Overview stands on its own at the top. */
export const GROUPS: Partial<Record<Page, string>> = {
  sessions: 'Work',
  projects: 'Work',
  usage: 'Plans & cost',
  cost: 'Plans & cost',
  agents: 'Activity',
  you: 'Activity',
};

/** The sections the sidebar can order and hide: all but Settings. */
export const ORDERABLE = PAGES.filter((p) => p !== 'settings') as Exclude<Page, 'settings'>[];

const groupOf = (id: string) => GROUPS[id as Page] || '';
const groupRank = (id: string) => [...new Set(ORDERABLE.map(groupOf))].indexOf(groupOf(id));

/** Your order within each group, the groups as they always are. */
const grouped = (list: string[]) => [...list].sort((a, b) => groupRank(a) - groupRank(b));

export type NavState = { order: Page[]; hidden: Set<Page> };

/** The order and hidden sections as saved, with any section added since coming in where it usually would. */
export function readNavState(saved = readNav()): NavState {
  const known = new Set<string>(ORDERABLE);
  let order = (Array.isArray(saved.order) ? saved.order : []).filter((id) => known.has(id));
  for (const id of ORDERABLE)
    if (!order.includes(id)) order.splice(Math.min(ORDERABLE.indexOf(id), order.length), 0, id);
  order = grouped(order);
  const hidden = new Set((Array.isArray(saved.hidden) ? saved.hidden : []).filter((id) => known.has(id)) as Page[]);
  return { order: order as Page[], hidden };
}

const usual = (order: string[]) => order.every((id, i) => id === ORDERABLE[i]);

export function writeNavState({ order, hidden }: NavState) {
  const clean = grouped(order) as Page[];
  // Saving it says so on the bus ('nav'), and the sidebar redraws.
  saveNav(usual(clean) && !hidden.size ? null : { order: clean, hidden: [...hidden] });
}

/** Move a section one place up (-1) or down (1) among the shown ones of its group. False if it can't go. */
export function moveSection(state: NavState, id: Page, step: number): NavState | null {
  const shown = state.order.filter((x) => !state.hidden.has(x));
  const i = shown.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= shown.length || groupOf(shown[j]) !== groupOf(shown[i])) return null;
  const order = [...state.order];
  const from = order.indexOf(shown[i]);
  const to = order.indexOf(shown[j]);
  [order[from], order[to]] = [order[to], order[from]];
  return { order, hidden: state.hidden };
}

/** Put `id` where `over` is, if they share a group (a drag in the sidebar). */
export function placeSection(state: NavState, id: Page, over: Page): NavState | null {
  if (id === over || groupOf(id) !== groupOf(over)) return null;
  const order = state.order.filter((x) => x !== id);
  const at = order.indexOf(over);
  const before = state.order.indexOf(id) > state.order.indexOf(over);
  order.splice(before ? at : at + 1, 0, id);
  return { order: grouped(order) as Page[], hidden: state.hidden };
}

/** Show or hide a section; the last one shown stays. */
export function toggleHidden(state: NavState, id: Page): NavState | null {
  const hidden = new Set(state.hidden);
  if (hidden.has(id)) hidden.delete(id);
  else if (state.order.filter((x) => !hidden.has(x)).length > 1) hidden.add(id);
  else return null;
  return { order: state.order, hidden };
}

export { groupOf };
