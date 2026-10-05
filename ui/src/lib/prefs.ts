// Your settings, kept in the browser's storage under overtime-* keys (through
// lib/storage.ts, and synced to ~/.overtime/settings.json by @shared/settings.js),
// which the pixel office reads too: the clock, currency,
// project names and colours, light or dark, the provider filter, the sidebar
// (folded, its width, its order and hidden sections) and the exact-limit checks.
// A change says so on the bus, and another tab's change is read back in.

import { env, type Currency, type ProjectPref } from './env';
import { changed } from './bus';
import { readMeasure } from './measure';
import { loadLabels, LABEL_KEYS } from './labels';
import { SOURCES } from './sources';
import { onOtherTab, readJson, readSetting, removeSetting, writeJson, writeSetting } from './storage';

// ── The clock ──────────────────────────────────────────────────────────────

const CLOCK_KEY = 'clock';

export function setClock24(on: boolean) {
  env.clock24 = on;
  writeSetting(CLOCK_KEY, on ? '24' : '12', 'prefs');
}

// ── Currency ───────────────────────────────────────────────────────────────

const CURRENCY_KEY = 'currency';

/** Currencies costs can show in. Prices are in US dollars, so each converts at a rate you set; these are where it starts. */
export const CURRENCIES: Record<
  string,
  { name: string; symbol: string; rate: number; locale?: string; whole?: boolean }
> = {
  USD: { name: 'US dollar', symbol: '$', rate: 1 },
  INR: { name: 'Indian rupee', symbol: '₹', rate: 88, locale: 'en-IN' },
  EUR: { name: 'Euro', symbol: '€', rate: 0.86 },
  GBP: { name: 'British pound', symbol: '£', rate: 0.75 },
  JPY: { name: 'Japanese yen', symbol: '¥', rate: 148, whole: true },
  CAD: { name: 'Canadian dollar', symbol: 'CA$', rate: 1.38 },
  AUD: { name: 'Australian dollar', symbol: 'A$', rate: 1.52 },
  SGD: { name: 'Singapore dollar', symbol: 'S$', rate: 1.29 },
  AED: { name: 'UAE dirham', symbol: 'AED ', rate: 3.67 },
  BRL: { name: 'Brazilian real', symbol: 'R$', rate: 5.4 },
};

type SavedCurrency = { code?: string; rates?: Record<string, number> };

function currencyFrom(saved: SavedCurrency): Currency {
  const code = saved.code && CURRENCIES[saved.code] ? saved.code : 'USD';
  const def = CURRENCIES[code];
  const rates = saved.rates && typeof saved.rates === 'object' ? saved.rates : {};
  const rate = code === 'USD' ? 1 : Number(rates[code]) > 0 ? Number(rates[code]) : def.rate;
  return { code, symbol: def.symbol, rate, locale: def.locale || 'en-US', whole: !!def.whole, rates };
}

/** Show costs in `code`, at `rate` of it to a US dollar (or the rate last used for it). */
export function setCurrency(code: string, rate?: number) {
  if (!CURRENCIES[code]) return;
  const rates = { ...env.currency.rates };
  if (code !== 'USD' && Number(rate) > 0) rates[code] = Number(rate);
  env.currency = currencyFrom({ code, rates });
  writeJson(CURRENCY_KEY, { code, rates }, 'prefs');
}

// ── Projects: your names and colours for them ───────────────────────────────

const PROJECTS_KEY = 'projects';

export const projectPref = (name: string): ProjectPref => ({ ...env.projects[name] });
export const customizedProjects = () => Object.keys(env.projects);

/**
 * Give a project a name and colour of your own; an empty name and no hue go back
 * to its own. What `pref` leaves out stays as it is; a hue given as null or
 * undefined means none (Auto), so undoing a colour picked on Auto takes it off.
 */
export function setProjectPref(name: string, pref: ProjectPref = {}) {
  const alias = 'alias' in pref ? pref.alias : env.projects[name]?.alias;
  const hue = 'hue' in pref ? pref.hue : env.projects[name]?.hue;
  const clean = String(alias || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const next: ProjectPref = {
    ...(clean && clean !== name ? { alias: clean } : {}),
    ...(Number.isFinite(hue) ? { hue } : {}),
  };
  const projects = { ...env.projects };
  if (Object.keys(next).length) projects[name] = next;
  else delete projects[name];
  env.projects = projects;
  writeJson(PROJECTS_KEY, projects, 'labels');
}

export function resetProjectPrefs() {
  env.projects = {};
  removeSetting(PROJECTS_KEY, 'labels');
}

// ── Light, dark, or like the Mac ─────────────────────────────────────────────

const THEME_KEY = 'theme';
export type ThemeChoice = 'light' | 'dark' | 'auto';
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export const themeChoice = (): ThemeChoice => readSetting<ThemeChoice>(THEME_KEY, 'auto', ['light', 'dark']);

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice) {
  applyTheme(choice);
  writeSetting(THEME_KEY, choice === 'auto' ? null : choice, 'appearance');
}

/** What's on screen: light or dark, whichever way it was chosen. */
export const shownTheme = () => {
  const c = themeChoice();
  return c === 'auto' ? (darkQuery?.matches ? 'dark' : 'light') : c;
};

/** Switch between light and dark; from auto, to the opposite of what's showing. */
export const toggleTheme = () => setTheme(shownTheme() === 'dark' ? 'light' : 'dark');

// ── The provider filter ──────────────────────────────────────────────────────

export const PROVIDER_KEY = 'provider';
export const PROVIDERS = ['all', ...SOURCES] as const;
export type Provider = (typeof PROVIDERS)[number];

export const readProvider = (): Provider => readSetting<Provider>(PROVIDER_KEY, 'all', PROVIDERS);

export const saveProvider = (p: Provider) => writeSetting(PROVIDER_KEY, p);

// ── The sidebar ──────────────────────────────────────────────────────────────

const SIDE_KEY = 'sidebar';
export const SIDE_W_KEY = 'sidebar-width';
export const SIDE = { usual: 236, min: 208, max: 400, fold: 150 };

export const savedFolded = () => readSetting(SIDE_KEY) === 'collapsed';
export const saveFolded = (on: boolean) => writeSetting(SIDE_KEY, on ? 'collapsed' : 'expanded');

export function readSideWidth() {
  const v = Number(readSetting(SIDE_W_KEY));
  return Number.isFinite(v) && v >= SIDE.min && v <= SIDE.max ? v : SIDE.usual;
}

export function saveSideWidth(w: number) {
  writeSetting(SIDE_W_KEY, Math.round(w) === SIDE.usual ? null : String(Math.round(w)));
}

// ── The sidebar's order and hidden sections (see lib/nav.ts) ──────────────────

export const NAV_KEY = 'nav';
export const readNav = () => readJson<{ order?: string[]; hidden?: string[] }>(NAV_KEY, {});
export const saveNav = (value: { order: string[]; hidden: string[] } | null) => writeJson(NAV_KEY, value, 'nav');

// ── Exact plan limits: Claude Code's on unless turned off, Codex's live check off unless turned on ──

export const EXACT_KEY = 'exact-limits';
export const CODEX_EXACT_KEY = 'codex-exact-limits';
export const readExactOn = () => readSetting(EXACT_KEY) !== '0';
export const readCodexExactOn = () => readSetting(CODEX_EXACT_KEY) === '1';
export const saveExactOn = (on: boolean) => writeSetting(EXACT_KEY, on ? '1' : '0');
export const saveCodexExactOn = (on: boolean) => writeSetting(CODEX_EXACT_KEY, on ? '1' : '0');

// ── Reading them all in ───────────────────────────────────────────────────────

export function loadPrefs() {
  env.clock24 = readSetting(CLOCK_KEY) === '24';
  env.currency = currencyFrom(readJson<SavedCurrency>(CURRENCY_KEY, {}));
  env.projects = readJson<Record<string, ProjectPref>>(PROJECTS_KEY, {});
  env.measure = readMeasure();
}
loadPrefs();

// Another tab changed a setting: read it back in, and redraw what shows it.
onOtherTab((key) => {
  loadPrefs();
  if (LABEL_KEYS.includes(key)) {
    loadLabels();
    changed('labels');
  } else if (key === THEME_KEY) {
    applyTheme(themeChoice());
    changed('appearance');
  } else if (key === NAV_KEY) changed('nav');
  else changed('prefs');
});
