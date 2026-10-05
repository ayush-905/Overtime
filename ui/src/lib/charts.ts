// The style each chart card is drawn in: bars, a line, an area, a heat strip or a
// table of the numbers behind it (and, for parts of a whole, a list or a donut).
// You pick one per card with the switch in its corner, and a default for all of
// them in Settings. Both are saved with your settings.

import { changed } from './bus';
import { onOtherTab, readJson, readSetting, writeJson, writeSetting } from './storage';

const CHART_KEY = 'charts';
const CHART_DEFAULT_KEY = 'chart-default';

export type ChartKind = 'bars' | 'line' | 'area' | 'heat' | 'list' | 'donut' | 'table';

export const CHART_KINDS: Record<ChartKind, string> = {
  bars: 'Bars',
  line: 'Line',
  area: 'Area',
  heat: 'Heatmap',
  list: 'List',
  donut: 'Donut',
  table: 'Table',
};
/** Values over time: every style. */
export const SERIES: ChartKind[] = ['bars', 'line', 'area', 'heat', 'table'];
/** Parts of a whole: a list with bars, or a ring. */
export const SHARE_KINDS: ChartKind[] = ['list', 'donut'];
/** What Settings offers as the default. */
export const DEFAULT_KINDS: ChartKind[] = ['bars', 'line', 'area'];

let choices: Record<string, ChartKind> = {};
let fallback: ChartKind = 'bars';

function load() {
  choices = readJson(CHART_KEY, {});
  fallback = readSetting<ChartKind>(CHART_DEFAULT_KEY, 'bars', DEFAULT_KINDS);
}
load();

function store() {
  writeJson(CHART_KEY, Object.keys(choices).length ? choices : null);
  writeSetting(CHART_DEFAULT_KEY, fallback === 'bars' ? null : fallback, 'charts');
}

/** The style a chart is drawn in: the one picked for it, else the default, if it suits the card. */
export function chartKind(id: string, kinds: ChartKind[] = SERIES): ChartKind {
  if (kinds.includes(choices[id])) return choices[id];
  return kinds.includes(fallback) ? fallback : kinds[0];
}

/** Pick a card's style; picking the card's default makes it follow the default from then on. */
export function setChartKind(id: string, kind: ChartKind, kinds: ChartKind[] = SERIES) {
  if (kind === (kinds.includes(fallback) ? fallback : kinds[0])) delete choices[id];
  else choices[id] = kind;
  store();
}

/** The style every card starts in. Picking it clears the cards that chose it too (with `all`, every card's choice). */
export function setChartDefault(kind: ChartKind, { all = false } = {}) {
  fallback = kind;
  for (const [id, k] of Object.entries(choices)) if (all || k === kind) delete choices[id];
  store();
}

export const chartDefault = () => fallback;
export const chartsCustomized = () => Object.keys(choices).length;

onOtherTab((key) => {
  if (key !== CHART_KEY && key !== CHART_DEFAULT_KEY) return;
  load();
  changed('charts');
});

/** A value's level on a heat scale of 0–4, on a square root so one big day doesn't wash out the rest. */
export const heatLevel = (value: number, max: number) =>
  value <= 0 || !max ? 0 : Math.min(4, Math.ceil(Math.sqrt(value / max) * 4));

const csvCell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/** Rows of cells as CSV. */
export const toCsv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => csvCell(String(c).trim().replace(/\s+/g, ' '))).join(',')).join('\n');
