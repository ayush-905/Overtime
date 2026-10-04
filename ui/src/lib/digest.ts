// The weekly digest's words: which week, how it compares with the week before,
// the few things worth knowing, and the whole digest as text to paste into a
// note. Last week's is "ready" early in the week, until you've opened it.

import { duration, money, plural, projectName } from './format';
import { titleFor } from './labels';
import { SOURCE, SOURCES, andList, type Source } from '@/lib/sources';

const SEEN_KEY = 'overtime-digest-seen';
const DAY = 86_400_000;

export type Digest = {
  from: number;
  to: number;
  cost: number;
  partial?: boolean;
  sessions: number;
  messages: number;
  activeMs: number;
  agentMs: number;
  waitMs: number;
  waits: number;
  added: number;
  removed: number;
  tools: number;
  failed: number;
  days: number;
  busiest: [number, number] | null;
  hits: { claude: number; codex: number };
  bySource: Partial<Record<Source, number>>;
  projects: { name: string; cost: number; sessions: number }[];
  topSessions: { id: string; source: Source; title: string; project: string; cost: number; messages: number }[];
  before: { cost: number; activeMs: number; agentMs: number; waitMs: number };
};

/** Midnight on the Monday of the week `t` falls in. */
export function weekStartOf(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Early in the week, until you've opened it: last week's digest, waiting for you. */
export function digestReady(now = Date.now()) {
  const weekday = new Date(now).getDay();
  if (weekday < 1 || weekday > 3) return null;
  const week = weekStartOf(now);
  let seen = 0;
  try { seen = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch {}
  return seen >= week ? null : { from: weekStartOf(week - DAY), to: week };
}

export function markDigestSeen() {
  try { localStorage.setItem(SEEN_KEY, String(weekStartOf(Date.now()))); } catch {}
}

/** The days a digest covers: "22 – 28 Sept", or one day. */
export const span = (d: { from: number; to: number }) => {
  const last = d.to - DAY;
  const end = new Date(last).toLocaleDateString([], { day: 'numeric', month: 'short' });
  if (new Date(d.from).toDateString() === new Date(last).toDateString()) return end;
  const from = new Date(d.from).toLocaleDateString([], { day: 'numeric', month: new Date(d.from).getMonth() === new Date(last).getMonth() ? undefined : 'short' });
  return `${from} – ${end}`;
};

const longDay = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'long' });
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** How this week compares with the one before, in a few words. */
export function change(now: number, before: number) {
  if (!before) return now ? 'none the week before' : '';
  const ratio = now / before;
  if (ratio >= 1.9) return `${ratio.toFixed(1)}× the week before`;
  const diff = Math.round((ratio - 1) * 100);
  if (Math.abs(diff) < 5) return 'about the same as the week before';
  return `${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)}% on the week before`;
}

/** The few things worth knowing about the week. */
export function digestNotes(d: Digest) {
  const out: string[] = [];
  const top = d.projects[0];
  if (top && d.cost > 1 && top.cost / d.cost >= 0.4 && d.projects.length > 1) out.push(`${projectName(top.name)} took ${pct(top.cost, d.cost)}% of the cost (≈ ${money(top.cost)}).`);
  if (d.busiest && d.days > 1) out.push(`Your busiest day was ${longDay(d.busiest[0])}, at ≈ ${money(d.busiest[1])}.`);
  if (d.waitMs >= 30 * 60_000) out.push(`Agents waited ${duration(d.waitMs)} for your replies${d.waits ? `, about ${duration(d.waitMs / d.waits)} a reply` : ''}.`);
  if (d.agentMs > d.activeMs && d.activeMs > 0) out.push(`Your agents worked ${duration(d.agentMs)}, more than your own ${duration(d.activeMs)} of active time.`);
  const hits = [d.hits.claude && `Claude Code's limit ${d.hits.claude === 1 ? 'once' : `${d.hits.claude} times`}`, d.hits.codex && `Codex's ${d.hits.codex === 1 ? 'once' : `${d.hits.codex} times`}`].filter(Boolean);
  if (hits.length) out.push(`You hit ${hits.join(' and ')}.`);
  // Each provider's share of the cost, when more than one did some of the work.
  const shares = SOURCES.filter((s) => (d.bySource[s] || 0) > 0.005).sort((a, b) => (d.bySource[b] || 0) - (d.bySource[a] || 0));
  if (shares.length === 2) out.push(`${SOURCE[shares[1]].name} was ${pct(d.bySource[shares[1]]!, d.cost)}% of the cost, ${SOURCE[shares[0]].name} the rest.`);
  else if (shares.length > 2) out.push(`Of the cost, ${andList(shares.map((s) => `${SOURCE[s].name} was ${pct(d.bySource[s]!, d.cost)}%`))}.`);
  if (d.tools >= 50 && d.failed / d.tools >= 0.05) out.push(`${pct(d.failed, d.tools)}% of tool calls failed; Tool failures on the Agents page shows why.`);
  return out;
}

/** The digest as plain text, to paste into a note or a message. `last` is last week, else this one so far. */
export function digestText(d: Digest, last: boolean) {
  const title = `${last ? 'Week of' : 'This week so far,'} ${span(d)}`;
  const lines = [
    `Overtime · ${title}`,
    '',
    `Cost: ≈ ${money(d.cost)}${d.partial ? '+' : ''} (${change(d.cost, d.before.cost)})`,
    `Sessions: ${d.sessions} · your messages: ${d.messages}`,
    `Your active time: ${duration(d.activeMs)} · agent time: ${duration(d.agentMs)} · waited for you: ${duration(d.waitMs)}`,
    `Lines changed: +${d.added} −${d.removed}`,
  ];
  if (d.projects.length) lines.push('', 'Top projects:', ...d.projects.slice(0, 3).map((p) => `- ${projectName(p.name)}: ≈ ${money(p.cost)} (${pct(p.cost, d.cost)}%), ${plural(p.sessions, 'session')}`));
  if (d.topSessions.length) lines.push('', 'Priciest sessions:', ...d.topSessions.slice(0, 3).map((s) => `- ${titleFor(s.id, s.title)} (${projectName(s.project)}): ≈ ${money(s.cost)}`));
  const n = digestNotes(d);
  if (n.length) lines.push('', ...n.map((x) => `- ${x}`));
  lines.push('', 'Costs at API list prices.');
  return lines.join('\n');
}

