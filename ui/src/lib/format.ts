// Times, durations, money and counts, as every card writes them: 2:05pm (or 14:05),
// 3h 20m, Tue 12 Sept, ₹1,78,721, 229.5M (golden tests in golden.test.ts hold
// them). A working day starts at the hour set in Settings.

import { env, serverNow } from './env';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const workdayHour = () => env.workdayHour;

export const hourLabel = (h: number) => (env.clock24 ? `${String(h).padStart(2, '0')}:00` : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`);

export const dayLabel = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

export const weekday = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short' });

export function clock(t: number) {
  const d = new Date(t);
  const m = String(d.getMinutes()).padStart(2, '0');
  return env.clock24 ? `${String(d.getHours()).padStart(2, '0')}:${m}` : `${d.getHours() % 12 || 12}:${m}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

export function whenText(t: number | null | undefined) {
  if (!t) return '';
  return new Date(t).toDateString() === new Date().toDateString() ? clock(t) : `${weekday(t)} ${clock(t)}`;
}

/** The start (4am, unless you changed it) of the working day `t` belongs to, moved by `days`. */
export function workDay(t: number, days = 0) {
  const hour = workdayHour();
  const d = new Date(t);
  if (d.getHours() < hour) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** How a working day reads in a note: "from 4am to 4am", or "midnight to midnight". */
export const dayRuns = () => (workdayHour() ? `from ${hourLabel(workdayHour())} to ${hourLabel(workdayHour())}` : 'from midnight to midnight');

/** A label under each day of a run: its initial for two weeks or less; for more, the date every fifth day back from today. */
export function dayTicks(starts: number[]) {
  if (starts.length <= 14) return starts.map((t) => new Date(t).toLocaleDateString([], { weekday: 'narrow' }));
  return starts.map((t, i) => ((starts.length - 1 - i) % 5 === 0 ? String(new Date(t).getDate()) : ''));
}

/** Midnight on the day `t` falls on, moved by `days`. */
export function calendarDay(t: number, days = 0) {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A time of day sent as ms after the working day's start, e.g. a typical start. */
export const atOffset = (ms: number) => clock(workDay(serverNow()) + ms);

export function listText(items: string[]) {
  return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function duration(ms: number | null | undefined) {
  if (ms == null) return '—';
  const m = Math.round(ms / MINUTE);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const pctText = (v: number) => (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)));

export function nextMidnight(t: number) {
  const d = new Date(t);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function hoursText(ms: number) {
  const h = ms / HOUR;
  if (h >= 10) return `${Math.round(h)}h`;
  if (h >= 1) return `${h.toFixed(1).replace(/\.0$/, '')}h`;
  return `${Math.round(ms / MINUTE)}m`;
}

/** How a stretch of time compares with the one before, once both are an hour or more: "↑ 12%". */
export const change = (now: number, before: number) => {
  if (!(before >= HOUR)) return '';
  const pct = Math.round(((now - before) / before) * 100);
  return Math.abs(pct) >= 5 ? `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%` : '';
};

export const pctOf = (n: number, d: number) => {
  const v = d ? (n / d) * 100 : 0;
  return v > 0 && v < 1 ? v.toFixed(1) : String(Math.round(v));
};

export const longDate = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Hours with one decimal under 10, whole hours from there: 4.3, 12. */
export const hoursShort = (ms: number) => {
  const h = ms / HOUR;
  return h >= 9.95 ? String(Math.round(h)) : h.toFixed(1);
};

export function bytesText(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export const cpuText = (pct: number | null | undefined) => (pct == null ? '—' : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`);

type Hours = { days?: { stretches?: [number, number][] }[] } | null | undefined;

/** Active time between two moments, from the working-hours stretches. */
export function activeBetween(hours: Hours, from: number, to: number) {
  let ms = 0;
  for (const d of hours?.days || []) for (const [a, b] of d.stretches || []) ms += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return ms;
}

// ── Text and counts ────────────────────────────────────────────────────────

export function clip(text: unknown, max: number) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function compact(n: number | null | undefined) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

// ── Money: US dollars, shown in the currency you picked ──────────────────────

/** A cost in US dollars, shown in the currency in use. */
export function money(n: number | null | undefined) {
  if (n == null) return '—';
  const { rate, symbol, whole, locale } = env.currency;
  const v = n * rate;
  if (v >= 100 || whole) return `${symbol}${Math.round(v).toLocaleString(locale)}`;
  if (v >= 10) return `${symbol}${v.toFixed(1)}`;
  return `${symbol}${v.toFixed(2)}`;
}

/** Costs for a column of them: always with cents below 1,000, so the figures line up. */
export function moneyCol(n: number | null | undefined) {
  if (n == null) return '—';
  const { rate, symbol, whole, locale } = env.currency;
  const v = n * rate;
  return v >= 1000 || whole ? `${symbol}${Math.round(v).toLocaleString(locale)}` : `${symbol}${v.toFixed(2)}`;
}

/** A cost with "+" when some prices were missing, so it's what the rest cost. */
export const costText = (cost: number | null | undefined, partial?: boolean) => (cost == null ? '—' : `${money(cost)}${partial ? '+' : ''}`);

export const costCol = (cost: number | null | undefined, partial?: boolean) => `${moneyCol(cost)}${partial ? '+' : ''}`;

export const toUsd = (value: number) => value / env.currency.rate;

/** Lines changed per unit of the currency in use: "60 lines / $", "0.7 lines / ₹". */
export function linesPer(perDollar: number) {
  const v = perDollar / env.currency.rate;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} lines / ${env.currency.symbol.trim()}`;
}
export const fromUsd = (usd: number) => usd * env.currency.rate;

// ── Projects: your names and colours for them ─────────────────────────────────

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A project's name as you call it: your name for it, else its folder's. */
export function projectName(name: string | null | undefined) {
  return (name && env.projects[name]?.alias) || name || '';
}

/** A project's colour, as a hue: the one you picked, else one from its name. */
export function projectHue(name: string | null | undefined) {
  const hue = name ? env.projects[name]?.hue : undefined;
  return Number.isFinite(hue) ? (hue as number) : hashString(name || '') % 360;
}

/** A project's colour, for its dot and its bars. */
export const projectColor = (name: string | null | undefined) => `hsl(${projectHue(name)} 55% 50%)`;
