// Client state shared by the office's modules, and a tiny event bus between them.

export const state = {
  agents: new Map(), // id → latest view from the server
  feed: [],
  watching: [],
  selectedId: null,
  filter: null, // project name, or null for everyone
  timeOffset: 0,
  demo: false,
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
}

export function emit(event, ...args) {
  for (const fn of listeners.get(event) || []) fn(...args);
}

export const serverNow = () => Date.now() - state.timeOffset;

export function select(id) {
  state.selectedId = state.selectedId === id ? null : id;
  emit('select', state.selectedId);
}

export function setFilter(project) {
  state.filter = state.filter === project ? null : project;
  try {
    localStorage.setItem('overtime-filter', state.filter || '');
  } catch {}
  emit('filter', state.filter);
}

export function matchesFilter(a) {
  return !state.filter || a?.project === state.filter;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── Your own settings (saved on disk too, see settings.js) ──────────────────
//
// What you call your projects and the colour each one gets, and the currency
// costs show in, as the dashboard's Settings saved them.

const PROJECTS_KEY = 'overtime-projects';
const CURRENCY_KEY = 'overtime-currency';

let projectPrefs = {}; // project folder name → { alias, hue }
function loadProjects() {
  try {
    projectPrefs = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '{}') || {};
  } catch {
    projectPrefs = {};
  }
}
loadProjects();

/** A project's name as you call it: your name for it, else its folder's. */
export function projectName(name) {
  return (name && projectPrefs[name]?.alias) || name;
}

/** A project's colour, as a hue: the one you picked, else one from its name. */
export function projectHue(name) {
  const hue = projectPrefs[name]?.hue;
  return Number.isFinite(hue) ? hue : hashString(name || '') % 360;
}

/**
 * Currencies costs can show in. Prices are in US dollars, so each converts at a
 * rate you set; these are only where it starts, since the page never goes online to look one up.
 */
const CURRENCIES = {
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

/** The currency in use: its code, symbol and rate to the US dollar. */
const currency = { code: 'USD', symbol: '$', rate: 1, locale: 'en-US', whole: false, rates: {} };

function loadCurrency() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CURRENCY_KEY) || '{}') || {};
  } catch {}
  const code = CURRENCIES[saved.code] ? saved.code : 'USD';
  const def = CURRENCIES[code];
  const rates = saved.rates && typeof saved.rates === 'object' ? saved.rates : {};
  const rate = code === 'USD' ? 1 : Number(rates[code]) > 0 ? Number(rates[code]) : def.rate;
  Object.assign(currency, { code, symbol: def.symbol, rate, locale: def.locale || 'en-US', whole: !!def.whole, rates });
}
loadCurrency();

// A change made on the dashboard shows in the office from its next redraw.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === PROJECTS_KEY) loadProjects();
    else if (e.key === CURRENCY_KEY) loadCurrency();
  });
}

/** Text made safe to put in HTML. */
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function compact(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

/** A cost in US dollars, shown in the currency in use. */
export function money(n) {
  if (n == null) return '—';
  const v = n * currency.rate;
  const s = currency.symbol;
  if (v >= 100 || currency.whole) return `${s}${Math.round(v).toLocaleString(currency.locale)}`;
  if (v >= 10) return `${s}${v.toFixed(1)}`;
  return `${s}${v.toFixed(2)}`;
}

export function waitLevel(a) {
  if (!a.needsYou) return 0;
  const since = a.needsYou === 'turn' ? a.endedAt : a.tool?.startedAt || a.endedAt;
  const mins = (serverNow() - (since || serverNow())) / 60000;
  return mins >= 10 ? 3 : mins >= 3 ? 2 : 1;
}
