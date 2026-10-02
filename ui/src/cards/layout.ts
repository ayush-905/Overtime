// Which cards the Overview shows under its band, and in what order, which you
// choose with Customize. Each card has its own designed width (no free
// resizing, so the page always reads as designed). Saved with your settings,
// as overtime-overview-cards.
// Cards from Cost, Agents and You are optional additions.

import { changed } from '@/lib/bus';

const KEY = 'overtime-overview-cards';

export type OverviewCard = { id: string; name: string; span: 5 | 6 | 7 | 12; shown: boolean; section?: 'Cost' | 'Agents' | 'You' };

/** The cards, as the Overview ships: `shown` is whether it's on the page by default. */
export const CATALOG: OverviewCard[] = [
  { id: 'today', name: 'Today', span: 12, shown: true },
  { id: 'turn-duration', name: 'Turn duration', span: 12, shown: true },
  { id: 'timeline', name: "Today's timeline", span: 12, shown: true },
  { id: 'top-sessions', name: 'Top sessions today', span: 7, shown: true },
  { id: 'where-today', name: 'Where today went', span: 5, shown: true },
  { id: 'open-sessions', name: 'Open agent sessions', span: 12, shown: false },
  { id: 'plan', name: 'What your plans are worth', span: 12, shown: false, section: 'Cost' },
  { id: 'trend', name: 'Daily cost', span: 12, shown: false, section: 'Cost' },
  { id: 'money', name: 'Where the money goes', span: 6, shown: false, section: 'Cost' },
  { id: 'sessions', name: 'Priciest sessions', span: 6, shown: false, section: 'Cost' },
  { id: 'cache', name: 'Cache savings', span: 6, shown: false, section: 'Cost' },
  { id: 'context', name: 'Context size', span: 6, shown: false, section: 'Cost' },
  { id: 'longctx', name: 'Long-context premium', span: 12, shown: false, section: 'Cost' },
  { id: 'agenthours', name: 'Agent hours', span: 6, shown: false, section: 'Agents' },
  { id: 'agenttotal', name: 'Total agent time', span: 6, shown: false, section: 'Agents' },
  { id: 'agentwork', name: 'When your agents worked', span: 12, shown: false, section: 'Agents' },
  { id: 'parallel', name: 'Agents at once', span: 6, shown: false, section: 'Agents' },
  { id: 'tools', name: 'Tool failures', span: 6, shown: false, section: 'Agents' },
  { id: 'skills', name: 'Skills', span: 12, shown: false, section: 'Agents' },
  { id: 'heatmap', name: 'Activity', span: 12, shown: false, section: 'You' },
  { id: 'activehours', name: 'Your active hours', span: 6, shown: false, section: 'You' },
  { id: 'messages', name: 'Your messages', span: 6, shown: false, section: 'You' },
  { id: 'repeats', name: 'Prompts you repeat', span: 12, shown: false, section: 'You' },
  { id: 'waiting', name: 'Waiting for you', span: 6, shown: false, section: 'You' },
  { id: 'waiting-where', name: 'Who waited', span: 6, shown: false, section: 'You' },
  { id: 'workhours', name: 'Your working hours', span: 12, shown: false, section: 'You' },
  { id: 'hours', name: 'When you work', span: 6, shown: false, section: 'You' },
  { id: 'weekdays', name: 'Which days you work', span: 6, shown: false, section: 'You' },
];

export type Layout = { order: string[]; hidden: string[] };

export const usualLayout = (): Layout => ({ order: CATALOG.map((c) => c.id), hidden: CATALOG.filter((c) => !c.shown).map((c) => c.id) });

export function readLayout(): Layout {
  const known = new Set(CATALOG.map((c) => c.id));
  let saved: Partial<Layout> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const order = (Array.isArray(saved.order) ? saved.order : []).filter((id) => known.has(id));
  // Cards added since you saved come in where they'd normally be, as they ship.
  const usual = usualLayout();
  for (const id of usual.order) if (!order.includes(id)) order.splice(Math.min(usual.order.indexOf(id), order.length), 0, id);
  const hidden = Array.isArray(saved.hidden) ? saved.hidden.filter((id) => known.has(id)) : usual.hidden;
  // Existing custom layouts opt into new widgets; never silently add a visible card.
  for (const c of CATALOG) if (!saved.order?.includes(c.id) && Array.isArray(saved.order) && !hidden.includes(c.id)) hidden.push(c.id);
  return { order, hidden };
}

const same = (a: Layout, b: Layout) => a.order.join() === b.order.join() && [...a.hidden].sort().join() === [...b.hidden].sort().join();

export function saveLayout(layout: Layout) {
  try {
    if (same(layout, usualLayout())) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {}
  changed('layout');
}

/** The cards on the page, in order. */
export const shownCards = (layout: Layout) => layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => CATALOG.find((c) => c.id === id)!);
