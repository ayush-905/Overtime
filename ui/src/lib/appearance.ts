// How the dashboard looks beyond light and dark: a colour theme, the size of the
// text, and how tightly cards and rows are packed. The pixel office follows the
// theme too.
//
// A theme has three colours, each with a light and a dark version: the accent
// (focus, what's selected, a switch that's on), the sidebar's tint, and a chart
// colour for the office's context meters. The dashboard's charts keep Claude Code's
// and Codex's own colours. Red, green and amber keep their meaning whatever the theme.

import { changed } from './bus';
import { onOtherTab, readJson, readSetting, writeJson, writeSetting } from './storage';

const KEYS = { palette: 'palette', text: 'text', density: 'density' } as const;

type Colors = { accent: string; chart: string; side: string };
export type Theme = { id: string; name: string; note?: string; light: Colors; dark: Colors };
export type Palette = { theme: string; accent?: string; chart?: string };

/** The presets. Classic is how the dashboard has always looked. */
export const THEMES: Theme[] = [
  {
    id: 'classic',
    name: 'Classic',
    light: { accent: '#c8671d', chart: '#2a78d6', side: '#ebe6db' },
    dark: { accent: '#f0a35e', chart: '#3987e5', side: '#111316' },
  },
  {
    id: 'aubergine',
    name: 'Aubergine',
    light: { accent: '#b0306a', chart: '#6b3fa0', side: '#ece3ee' },
    dark: { accent: '#f06ea9', chart: '#b18ae6', side: '#1b1320' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    light: { accent: '#0e7490', chart: '#2563eb', side: '#e3ebf0' },
    dark: { accent: '#22c3e6', chart: '#60a5fa', side: '#0e161c' },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: { accent: '#9a3412', chart: '#15803d', side: '#e5ebe1' },
    dark: { accent: '#fb923c', chart: '#4ade80', side: '#101a12' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    light: { accent: '#ea580c', chart: '#c026d3', side: '#f3e6e0' },
    dark: { accent: '#fb923c', chart: '#e879f9', side: '#1c1412' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    light: { accent: '#1f2937', chart: '#475569', side: '#e6e6e3' },
    dark: { accent: '#f3f4f6', chart: '#cbd5e1', side: '#121314' },
  },
  {
    id: 'clear',
    name: 'Colour-blind safe',
    note: 'Vermillion and blue, which stay apart for most kinds of colour blindness',
    light: { accent: '#d55e00', chart: '#0072b2', side: '#ebe6db' },
    dark: { accent: '#f28b3c', chart: '#56b4e9', side: '#111316' },
  },
];

/** What Custom picks from: no red, green or amber, which mean something already. */
export const SWATCHES: [string, string][] = [
  ['#4f46e5', 'Indigo'],
  ['#2563eb', 'Blue'],
  ['#0284c7', 'Sky'],
  ['#0e7490', 'Cyan'],
  ['#0d9488', 'Teal'],
  ['#7c3aed', 'Violet'],
  ['#9333ea', 'Purple'],
  ['#c026d3', 'Fuchsia'],
  ['#db2777', 'Pink'],
  ['#c2410c', 'Rust'],
  ['#475569', 'Slate'],
  ['#1f2937', 'Ink'],
];
const ROLES = ['accent', 'chart'] as const;

export const TEXT_SIZES: [string, string][] = [
  ['small', 'Small'],
  ['default', 'Default'],
  ['large', 'Large'],
  ['larger', 'Larger'],
];
export const DENSITIES: [string, string][] = [
  ['comfortable', 'Comfortable'],
  ['compact', 'Compact'],
];
const DEFAULTS = { text: 'default', density: 'comfortable' } as const;
const ALLOWED = { text: TEXT_SIZES.map((t) => t[0]), density: DENSITIES.map((d) => d[0]) };

const current = { text: 'default', density: 'comfortable', palette: { theme: 'classic' } as Palette };

// ── Colour sums ──────────────────────────────────────────────────────────────

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const mix = (a: string, b: string, t: number) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

function luminance(color: string) {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black, whichever has more contrast on `color`. */
function textOn(color: string) {
  const l = luminance(color);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0569 ? '#ffffff' : '#141414';
}

/** A custom colour's dark-theme version: lighter, so it reads on a dark page. */
const forDark = (color: string) => mix(color, '#ffffff', luminance(color) < 0.08 ? 0.45 : 0.3);

/** A theme's colours, as the variables the stylesheets read (light and dark). */
export function resolve(palette: Palette): Record<string, string> {
  let light: Colors;
  let dark: Colors;
  if (palette.theme === 'custom') {
    const base = THEMES[0];
    light = { accent: palette.accent!, chart: palette.chart!, side: mix(base.light.side, palette.accent!, 0.07) };
    dark = {
      accent: forDark(palette.accent!),
      chart: forDark(palette.chart!),
      side: mix(base.dark.side, palette.accent!, 0.08),
    };
  } else {
    const t = THEMES.find((x) => x.id === palette.theme) || THEMES[0];
    ({ light, dark } = t);
  }
  return {
    '--p-accent': light.accent,
    '--p-accent-d': dark.accent,
    '--p-on-accent': textOn(light.accent),
    '--p-on-accent-d': textOn(dark.accent),
    '--p-chart': light.chart,
    '--p-chart-d': dark.chart,
    '--p-side': light.side,
    '--p-side-d': dark.side,
  };
}

// ── Keeping and applying ─────────────────────────────────────────────────────

const isColor = (c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

export function loadAppearance() {
  for (const what of ['text', 'density'] as const)
    current[what] = readSetting<string>(KEYS[what], DEFAULTS[what], ALLOWED[what]);
  const saved = readJson<Palette | null>(KEYS.palette, null);
  if (saved?.theme === 'custom' && isColor(saved.accent) && isColor(saved.chart))
    current.palette = { theme: 'custom', accent: saved.accent, chart: saved.chart };
  else if (THEMES.some((t) => t.id === saved?.theme)) current.palette = { theme: saved!.theme };
  else current.palette = { theme: 'classic' };
}

/** Put the colour theme on the page, and save it (with its colours, for the office); Classic is saved as nothing at all. */
function showPalette() {
  applyAppearance();
  writeJson(
    KEYS.palette,
    current.palette.theme === 'classic' ? null : { ...current.palette, vars: resolve(current.palette) },
    'appearance',
  );
}

/** Put the look on the page. Classic sets nothing: the tokens' own accent is Classic's. */
export function applyAppearance() {
  const root = document.documentElement;
  for (const what of ['text', 'density'] as const) {
    if (current[what] === DEFAULTS[what]) delete root.dataset[what];
    else root.dataset[what] = current[what];
  }
  const vars = resolve(current.palette);
  if (current.palette.theme === 'classic') {
    delete root.dataset.palette;
    for (const k of Object.keys(vars)) root.style.removeProperty(k);
  } else {
    root.dataset.palette = current.palette.theme;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }
}

export const appearance = (what: 'text' | 'density' | 'palette') =>
  what === 'palette' ? current.palette.theme : current[what];
export const palette = () => ({ ...current.palette });

/** Change the text size or density, and save it; the default is saved as nothing at all. */
export function setAppearance(what: 'text' | 'density', value: string) {
  if (!ALLOWED[what].includes(value)) return;
  current[what] = value;
  applyAppearance();
  writeSetting(KEYS[what], value === DEFAULTS[what] ? null : value, 'appearance');
}

/** Switch to a preset, or to Custom (starting from the theme in use, so nothing jumps). */
export function setPaletteTheme(id: string) {
  if (id === 'custom') {
    if (current.palette.theme === 'custom') return;
    const from = THEMES.find((t) => t.id === current.palette.theme) || THEMES[0];
    current.palette = { theme: 'custom', accent: from.light.accent, chart: from.light.chart };
  } else if (THEMES.some((t) => t.id === id)) current.palette = { theme: id };
  else return;
  showPalette();
}

/** One of Custom's colours. A colour another role already has isn't allowed. */
export function setCustomColor(role: (typeof ROLES)[number], color: string) {
  if (current.palette.theme !== 'custom' || !SWATCHES.some(([c]) => c === color)) return;
  if (ROLES.some((r) => r !== role && current.palette[r] === color)) return;
  current.palette = { ...current.palette, [role]: color };
  showPalette();
}

/** The next one along, for ⌘K's actions. */
export function stepAppearance(what: 'text' | 'density' | 'palette', by: number) {
  if (what === 'palette') {
    const ids = THEMES.map((t) => t.id);
    setPaletteTheme(ids[(Math.max(0, ids.indexOf(current.palette.theme)) + by + ids.length) % ids.length]);
    return;
  }
  const list = ALLOWED[what];
  const i = Math.max(0, Math.min(list.length - 1, list.indexOf(current[what]) + by));
  setAppearance(what, list[i]);
}

loadAppearance();

// Another tab changed the look.
onOtherTab((key) => {
  if (!(Object.values(KEYS) as string[]).includes(key)) return;
  loadAppearance();
  applyAppearance();
  changed('appearance');
});
