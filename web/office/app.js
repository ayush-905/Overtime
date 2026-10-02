// The pixel office: its own page, fed by the same server as the dashboard.

import { startSettingsSync } from '/shared/settings.js';
import { createMerger } from '/shared/live.js';
import { state, on, select } from '/shared/state.js';
import { initTooltip } from '/shared/tooltip.js';
import { initTheme, toggleTheme, isThemeKey } from '/shared/theme.js';
import { initFloor, syncFloor, floorIsEmpty, refit, setFloorActive } from './floor.js';
import { initPanel, renderPanel, tickElapsed, scrollToCard } from './panel.js';

const $ = (id) => document.getElementById(id);
startSettingsSync();
state.demo = new URLSearchParams(location.search).has('demo');
try { state.filter = localStorage.getItem('overtime-filter') || null; } catch {}

initTooltip($('tip'));
initTheme($('theme'));
initFloor({ canvas: $('office'), stage: $('stage'), wrap: $('wrap'), labelsEl: $('labels') });
initPanel({ chips: $('chips'), list: $('agents'), feed: $('feed'), summary: $('summary'), watching: $('watching'), legend: $('legend') });
setFloorActive(true);

on('select', (id) => {
  renderPanel();
  if (id) scrollToCard(id);
});
on('filter', () => renderPanel());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selectedId) select(state.selectedId);
  // T switches between light and dark, as on the dashboard.
  if (isThemeKey(e)) {
    e.preventDefault();
    toggleTheme();
  }
});

function paintTitle() {
  const needs = [...state.agents.values()].filter((a) => a.kind === 'main' && a.needsYou).length;
  // Kept up to date even in a background tab, where the count shows in the tab strip.
  document.title = needs ? `(${needs}) Overtime` : 'Overtime';
}

// ── Data ───────────────────────────────────────────────────────────────────

let first = true;

function applySnapshot(snap) {
  const prev = state.agents;
  state.agents = new Map(snap.agents.map((a) => [a.id, a]));
  state.feed = snap.feed || [];
  state.watching = snap.watching || [];
  state.timeOffset = Date.now() - snap.now;
  syncFloor(prev);
  paintTitle();
  // Nobody can see a background tab, so it only redraws when you come back to it.
  if (document.hidden && !first) return;
  renderPanel();
  $('empty').hidden = state.agents.size > 0 || !floorIsEmpty();
  if (first) refit();
  first = false;
}

function paintConn(kind, label, title) {
  $('conn').className = `conn ${kind}`;
  $('conn').dataset.tip = title;
  $('conn-label').textContent = label;
}

if (state.demo) {
  paintConn('live', 'Demo', 'Simulated agents');
  import('/shared/demo.js').then((m) => m.startDemo(applySnapshot));
} else {
  const source = new EventSource('/events');
  source.onopen = () => paintConn('live', 'Live', 'Following your transcripts live');
  source.onerror = () => paintConn('down', 'Reconnecting', "Lost the connection to Overtime's server. Reconnecting…");
  // The server sends what changed; this keeps the whole picture.
  const merge = createMerger();
  source.onmessage = (e) => {
    try { applySnapshot(merge(JSON.parse(e.data))); } catch (error) { console.error(error); }
  };
}

const clock = $('clock');
const paintClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
paintClock();
setInterval(() => {
  if (document.hidden) return;
  paintClock();
  tickElapsed();
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  paintClock();
  renderPanel();
});
