// What sessions, projects and days are compared by: what they'd cost at API list
// prices, or the tokens they used. Tokens suit a subscription, where the list
// price isn't what you pay, and models with no known price, whose cost is only
// $0.00+. The Cost page always counts money.

import { env } from './env';
import { compact, costCol, costText, money } from './format';
import { readSetting, writeSetting } from './storage';

export const MEASURE_KEY = 'measure';
export const MEASURES: [string, string][] = [
  ['cost', 'Cost'],
  ['tokens', 'Tokens'],
];

export const readMeasure = () => readSetting<'cost' | 'tokens'>(MEASURE_KEY, 'cost', ['cost', 'tokens']);

export function setMeasure(next: string) {
  const m = next === 'tokens' ? 'tokens' : 'cost';
  if (m === env.measure) return;
  env.measure = m;
  writeSetting(MEASURE_KEY, m === 'cost' ? null : m, 'prefs');
}

type Measured = { cost?: number | null; tokens?: number | null; partial?: boolean };

/** Whether things are compared by tokens here. The Cost page is always in money. */
export const byTokens = () => env.measure === 'tokens' && env.page !== 'cost';

/** Its figure by the measure: US dollars, or tokens. */
export const measureOf = (x: Measured | null | undefined) => (byTokens() ? x?.tokens || 0 : x?.cost || 0);

/** Whether a figure by the measure is more than nothing (a cost under half a cent is nothing). */
export const something = (v: number) => (byTokens() ? v > 0 : v > 0.005);

/** Its figure in a column: $1.20+, or 1.2M. */
export const measureCol = (x: Measured) =>
  byTokens() ? (x.tokens ? compact(x.tokens) : '—') : costCol(x.cost, x.partial);

/** Its figure on its own: $1.20+, or 1.2M tokens. */
export const measureText = (x: Measured) =>
  byTokens() ? `${compact(x.tokens || 0)} tokens` : costText(x.cost, x.partial);

/** A bare figure by the measure, like a chart's: ≈ $1.20, or 1.2M tokens. */
export const valueText = (v: number) => (byTokens() ? `${compact(v)} tokens` : `≈ ${money(v)}`);

/** A chart's gridline: $1.20, or 1.2M. */
export const valueShort = (v: number) => (byTokens() ? compact(v) : money(v));

/** The figure it isn't compared by, for a tooltip: ≈ $1.20, or 1.2M tokens. */
export const otherText = (x: Measured) =>
  byTokens() ? `≈ ${costText(x.cost || 0, x.partial)}` : `${compact(x.tokens || 0)} tokens`;
