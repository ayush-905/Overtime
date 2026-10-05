// Your settings, kept in the browser's storage under overtime-* keys (and
// synced to ~/.overtime/settings.json by @shared/settings.js), which the pixel
// office reads too: the clock, currency,
// project names and colours, light or dark, the provider filter, the sidebar
// (folded, its width, its order and hidden sections) and the exact-limit checks.
// A change says so on the bus, and another tab's change is read back in.

import { env, type Currency, type ProjectPref } from './env';
import { changed } from './bus';
import { readMeasure } from './measure';
import { loadLabels, LABEL_KEYS } from './labels';
import { SOURCES } from './sources';

const get = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const put = (key: string, value: string | null) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};
const json = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(get(key) || 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
};

// ── The clock ──────────────────────────────────────────────────────────────

const CLOCK_KEY = 'overtime-clock';

export function setClock24(on: boolean) {
  env.clock24 = on;
  put(CLOCK_KEY, on ? '24' : '12');
  changed('prefs');
}

// ── Currency ───────────────────────────────────────────────────────────────

const CURRENCY_KEY = 'overtime-currency';

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

function loadCurrency(): Currency {
  const saved = json<{ code?: string; rates?: Record<string, number> }>(CURRENCY_KEY, {});
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
  put(CURRENCY_KEY, JSON.stringify({ code, rates }));
  env.currency = loadCurrency();
  changed('prefs');
}

// ── Projects: your names and colours for them ───────────────────────────────

const PROJECTS_KEY = 'overtime-projects';

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
  put(PROJECTS_KEY, JSON.stringify(projects));
  changed('labels');
}

export function resetProjectPrefs() {
  env.projects = {};
  put(PROJECTS_KEY, null);
  changed('labels');
}

// ── Light, dark, or like the Mac ─────────────────────────────────────────────

const THEME_KEY = 'overtime-theme';
export type ThemeChoice = 'light' | 'dark' | 'auto';
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function themeChoice(): ThemeChoice {
  const t = get(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : 'auto';
}

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice) {
  put(THEME_KEY, choice === 'auto' ? null : choice);
  applyTheme(choice);
  changed('appearance');
}

/** What's on screen: light or dark, whichever way it was chosen. */
export const shownTheme = () => {
  const c = themeChoice();
  return c === 'auto' ? (darkQuery?.matches ? 'dark' : 'light') : c;
};

/** Switch between light and dark; from auto, to the opposite of what's showing. */
export const toggleTheme = () => setTheme(shownTheme() === 'dark' ? 'light' : 'dark');

// ── The provider filter ──────────────────────────────────────────────────────

const PROVIDER_KEY = 'overtime-provider';
export const PROVIDERS = ['all', ...SOURCES] as const;
export type Provider = (typeof PROVIDERS)[number];

export function readProvider(): Provider {
  const v = get(PROVIDER_KEY);
  return (PROVIDERS as readonly string[]).includes(v || '') ? (v as Provider) : 'all';
}

export function saveProvider(p: Provider) {
  put(PROVIDER_KEY, p);
}

// ── The sidebar ──────────────────────────────────────────────────────────────

const SIDE_KEY = 'overtime-sidebar';
const SIDE_W_KEY = 'overtime-sidebar-width';
export const SIDE = { usual: 236, min: 208, max: 400, fold: 150 };

export const savedFolded = () => get(SIDE_KEY) === 'collapsed';
export const saveFolded = (on: boolean) => put(SIDE_KEY, on ? 'collapsed' : 'expanded');

export function readSideWidth() {
  const v = Number(get(SIDE_W_KEY));
  return Number.isFinite(v) && v >= SIDE.min && v <= SIDE.max ? v : SIDE.usual;
}

export function saveSideWidth(w: number) {
  put(SIDE_W_KEY, Math.round(w) === SIDE.usual ? null : String(Math.round(w)));
}

// ── The sidebar's order and hidden sections (see lib/nav.ts) ──────────────────

export const NAV_KEY = 'overtime-nav';
export const readNav = () => json<{ order?: string[]; hidden?: string[] }>(NAV_KEY, {});
export const saveNav = (value: { order: string[]; hidden: string[] } | null) =>
  put(NAV_KEY, value ? JSON.stringify(value) : null);

// ── Exact plan limits: Claude Code's on unless turned off, Codex's live check off unless turned on ──

export const EXACT_KEY = 'overtime-exact-limits';
export const CODEX_EXACT_KEY = 'overtime-codex-exact-limits';
export const readExactOn = () => get(EXACT_KEY) !== '0';
export const readCodexExactOn = () => get(CODEX_EXACT_KEY) === '1';

// ── Reading them all in ───────────────────────────────────────────────────────

export function loadPrefs() {
  env.clock24 = get(CLOCK_KEY) === '24';
  env.currency = loadCurrency();
  env.projects = json<Record<string, ProjectPref>>(PROJECTS_KEY, {}) || {};
  env.measure = readMeasure();
}
loadPrefs();

// Another tab changed a setting: read it back in, and redraw what shows it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith('overtime-')) return;
    loadPrefs();
    if (LABEL_KEYS.includes(e.key)) {
      loadLabels();
      changed('labels');
    } else if (e.key === THEME_KEY) {
      applyTheme(themeChoice());
      changed('appearance');
    } else if (e.key === NAV_KEY) changed('nav');
    else changed('prefs');
  });
}
