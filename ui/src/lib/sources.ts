// The agents Overtime reads, in the order they're shown, and how each one is
// named, coloured and drawn. A source's sessions only show up once its folder
// is on this Mac; the server says which are (the views in the snapshot).

import claudeMark from '@/assets/claude.svg';
import codexMark from '@/assets/codex.png';
import piMark from '@/assets/pi.svg';

export const SOURCES = ['claude', 'codex', 'pi'] as const;
export type Source = (typeof SOURCES)[number];

type Info = {
  /** Its full name, as in "Claude Code only". */
  name: string;
  /** A word for a narrow place, like the sidebar's switch. */
  short: string;
  /** Its colour as a CSS value, and as a background class (spelled out, so Tailwind finds it). */
  color: string;
  bg: string;
  mark: string;
  /** The command that picks a session back up, given its id. */
  resume: string;
};

export const SOURCE: Record<Source, Info> = {
  claude: { name: 'Claude Code', short: 'Claude', color: 'var(--claude)', bg: 'bg-claude', mark: claudeMark, resume: 'claude --resume' },
  codex: { name: 'Codex', short: 'Codex', color: 'var(--codex)', bg: 'bg-codex', mark: codexMark, resume: 'codex resume' },
  pi: { name: 'Pi', short: 'Pi', color: 'var(--pi)', bg: 'bg-pi', mark: piMark, resume: 'pi --session' },
};

/** What we know about a source; an unknown one is treated as Claude Code, as the server does. */
export const sourceInfo = (source: string | null | undefined): Info => SOURCE[(source || 'claude') as Source] || SOURCE.claude;

export const isSource = (v: unknown): v is Source => (SOURCES as readonly unknown[]).includes(v);

/** The sources with plan limits Overtime reads. Pi has none of its own: it uses whichever provider you sign it in to. */
export const PLAN_SOURCES = ['claude', 'codex'] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];
export const hasPlan = (s: string): s is PlanSource => (PLAN_SOURCES as readonly string[]).includes(s);

/** The plans in view: every one on this Mac when they're all in view, else the one in view's, if it has one. */
export const plansIn = (provider: string, sources: Source[]): PlanSource[] => (provider === 'all' ? sources.filter(hasPlan) : hasPlan(provider) ? [provider] : []);

/** Something for each source: { claude, codex, pi }. */
export const bySourceOf = <T,>(make: (s: Source) => T) => Object.fromEntries(SOURCES.map((s) => [s, make(s)])) as Record<Source, T>;

/** "A", "A and B", "A, B and C". */
export const andList = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '');

/** The sources whose views the server sent, in order: the ones with a folder on this Mac. */
export function sourcesIn(analytics: Record<string, unknown> | null | undefined): Source[] {
  const here = SOURCES.filter((s) => analytics?.[s]);
  return here.length ? here : ['claude'];
}
