// Everything around the office: the header chips, project filters, agent cards
// and the activity feed.

import { lookFor, portrait } from './office.js';
import {
  state, emit, select, setFilter, matchesFilter, serverNow, ago, compact, money, esc, waitLevel, projectHue, projectName,
} from '/shared/state.js';

export const ACTIVITY = [
  ['edit', 'Editing', 'desk'],
  ['read', 'Reading and searching', 'bookshelf'],
  ['bash', 'Shell commands', 'server racks'],
  ['web', 'Web', 'kiosk'],
  ['plan', 'Planning', 'whiteboard'],
  ['delegate', 'Briefing a subagent', 'meeting table'],
  ['other', 'Other tools', 'filing cabinets'],
  ['think', 'Thinking', 'wherever they are'],
  ['wait', 'Waiting for you', 'lounge'],
];
const ACTIVITY_LABEL = Object.fromEntries(ACTIVITY.map(([k, label]) => [k, label]));
const ENTRY = { 'claude-desktop': 'Desktop', 'claude-vscode': 'VS Code', cli: 'CLI', codex: 'Codex', pi: 'Pi' };
const COUNT_ICONS = [['edit', '⌨️', 'edits'], ['read', '📖', 'reads'], ['search', '🔎', 'searches'], ['bash', '💻', 'commands'], ['web', '🌐', 'web'], ['delegate', '📞', 'subagents']];

let els;
const portraits = new Map();
const lastHtml = new Map();

const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const timeSec = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function setHtml(el, key, html) {
  if (lastHtml.get(key) === html) return;
  lastHtml.set(key, html);
  el.innerHTML = html;
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function portraitUrl(a) {
  const parent = a.parentId && state.agents.get(a.parentId);
  const look = lookFor(a.seed, a.kind === 'sub', parent ? parent.seed % 360 : null, a.source);
  let url = portraits.get(look.key);
  if (!url) {
    url = portrait(look).toDataURL();
    portraits.set(look.key, url);
  }
  return url;
}

function prettyModel(model) {
  if (!model) return '';
  const m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]$/i, '');
  const match = m.match(/^([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!match) return m;
  const name = match[1][0].toUpperCase() + match[1].slice(1);
  return match[3] ? `${name} ${match[2]}.${match[3]}` : `${name} ${match[2]}`;
}

function statusText(a) {
  const tool = a.tool;
  const action = tool ? (tool.category === 'other' ? `Using ${tool.name}${tool.detail && tool.detail !== tool.name ? ` · ${tool.detail}` : ''}` : `${tool.verb} ${tool.detail || ''}`.trim()) : '';
  switch (a.needsYou) {
    case 'turn': return a.endReason === 'interrupted' ? '✋ Stopped, waiting for you' : '✅ Done, waiting for you';
    case 'question': return `❓ Has a question: ${tool?.detail || ''}`;
    case 'plan': return '📝 Plan ready for your review';
    case 'approval': return `✋ Probably waiting for your approval · ${action}`;
  }
  switch (a.status) {
    case 'working': return `${tool?.icon || '⚙️'} ${action}`;
    case 'thinking': return '🤔 Thinking…';
    case 'replying': return '💬 Writing a reply';
    case 'done': return '📄 Finished, handing in results';
    case 'idle': return '💤 Idle';
  }
  return '';
}

/** Timestamp the live "how long" counter runs from. */
function sinceFor(a) {
  if (a.needsYou === 'turn' || a.status === 'done') return a.endedAt;
  if (a.needsYou) return a.tool?.startedAt || a.endedAt;
  if (a.status === 'working' && a.tool) return a.tool.startedAt;
  if (a.turnStartedAt && (a.status === 'thinking' || a.status === 'replying')) return a.turnStartedAt;
  return a.lastActivity;
}

function meterHtml(ctx) {
  if (!ctx) return '';
  const lvl = ctx.pct >= 90 ? 'crit' : ctx.pct >= 70 ? 'warn' : 'ok';
  const icon = lvl === 'crit' ? '⚠ ' : lvl === 'warn' ? '▲ ' : '';
  const tip = `Context window: ${compact(ctx.used)} of ${compact(ctx.window)} tokens (${ctx.pct}%)${lvl !== 'ok' ? '. Getting full: it will compact soon.' : ''}`;
  return `<span class="meter ${lvl}" data-tip="${esc(tip)}"><span class="meter-track"><span class="meter-fill" style="width:${Math.max(3, ctx.pct)}%"></span></span><span class="meter-label">${icon}${ctx.pct}% context</span></span>`;
}

function costHtml(a) {
  if (a.cost == null) return '';
  const interns = a.internCost > 0.005 ? ` + ${money(a.internCost)} interns` : '';
  const tip = `Estimated at API list prices${a.costKnown ? '' : ' (some models unpriced)'}. Subscription plans are billed differently.`;
  return `<span class="stat" data-tip="${esc(tip)}">≈ ${money(a.cost)}${interns}</span>`;
}

function timelineHtml(a) {
  const cells = a.timeline || [];
  if (!cells.some(Boolean)) return '';
  const now = serverNow();
  const size = 3600000 / cells.length;
  const html = cells.map((s, i) => {
    const t0 = now - 3600000 + i * size;
    const tip = s ? `${time(t0)}–${time(t0 + size)} · ${ACTIVITY_LABEL[s] || s}` : `${time(t0)} · nothing yet`;
    return `<i class="act-${s || 'none'}" data-tip="${esc(tip)}"></i>`;
  }).join('');
  return `<div class="timeline" role="img" aria-label="Activity over the last hour"><div class="tl-cells">${html}</div><div class="tl-axis"><span>1h ago</span><span>now</span></div></div>`;
}

function countsHtml(counts) {
  const parts = COUNT_ICONS.filter(([k]) => counts?.[k]).map(([k, icon, label]) => `<span data-tip="${counts[k]} ${label}">${icon} ${counts[k]}</span>`);
  return parts.length ? `<div class="counts">${parts.join('')}</div>` : '';
}

function internHtml(sub) {
  return `<li class="intern" data-id="${esc(sub.id)}">
    <img src="${portraitUrl(sub)}" alt="" width="20" height="28">
    <div><div class="intern-name">🧢 ${esc(sub.nick)} <span>${esc(sub.agentType || 'subagent')}</span></div>
    <div class="intern-task">${esc(sub.title)}</div>
    <div class="intern-status">${esc(statusText(sub))}</div></div>
  </li>`;
}

function detailsHtml(a) {
  const files = a.files?.length
    ? `<div class="section"><h3>Files touched</h3><ul class="files">${a.files.map((f) => `<li><span class="fname" title="${esc(f.path)}">${esc(f.name)}</span><span class="add">+${compact(f.added)}</span><span class="del">−${compact(f.removed)}</span></li>`).join('')}</ul></div>`
    : '';
  const t = a.tokens || {};
  const totals = `<dl class="totals">
      <div><dt>Tokens</dt><dd data-tip="${esc(`${compact(t.input)} input · ${compact(t.output)} output · ${compact(t.cacheRead)} cache read · ${compact(t.cacheWrite)} cache write`)}">${compact(t.total)}</dd></div>
      <div><dt>Turns</dt><dd>${a.turns || 0}</dd></div>
      <div><dt>Lines</dt><dd>+${compact(a.lines?.added || 0)} −${compact(a.lines?.removed || 0)}</dd></div>
      <div><dt>Errors</dt><dd>${a.errors || 0}</dd></div>
      <div><dt>Compactions</dt><dd>${a.compactions || 0}</dd></div>
      <div><dt>Session</dt><dd>${a.startedAt ? ago(serverNow() - a.startedAt) : '—'}</dd></div>
    </dl>`;
  const snippet = a.snippet ? `<blockquote>${esc(a.snippet)}</blockquote>` : '';
  const recent = a.recent?.length
    ? `<div class="section"><h3>Recent</h3><ol class="recent">${[...a.recent].reverse().map((r) => `<li><time>${timeSec(r.t)}</time><span>${esc(r.icon)} ${esc(r.text)}</span></li>`).join('')}</ol></div>`
    : '';
  const open = a.cwd && a.project !== 'No folder'
    ? `<div class="actions"><a href="vscode://file/${esc(encodeURI(a.cwd))}" data-tip="${esc(a.cwd)}">Open folder in VS Code</a></div>`
    : '';
  return `<div class="details">${totals}${files}${snippet}${recent}${open}</div>`;
}

function cardHtml(a, subs) {
  const meta = [a.project && projectName(a.project), a.branch, prettyModel(a.model)].filter(Boolean).map(esc).join(' · ');
  const entry = ENTRY[a.entrypoint] || (a.background ? 'Background' : a.entrypoint?.startsWith('sdk') ? 'SDK' : '');
  const selected = a.id === state.selectedId;
  const age = waitLevel(a);
  const hue = projectHue(a.project);
  return `<article class="card${selected ? ' selected' : ''}${a.needsYou ? ` needs age-${age}` : ''}" data-id="${esc(a.id)}" tabindex="0" aria-expanded="${selected}">
    <div class="card-head">
      <img class="avatar" src="${portraitUrl(a)}" alt="" width="30" height="42">
      <div class="who">
        <div class="nick">${esc(a.nick)}${entry ? `<span class="tag">${esc(entry)}</span>` : ''}</div>
        <div class="title" title="${esc(a.title)}">${esc(a.title)}</div>
      </div>
      <span class="elapsed" data-since="${sinceFor(a) || ''}"${a.needsYou ? ' data-prefix="waiting "' : ''}></span>
    </div>
    <div class="status">${esc(statusText(a))}</div>
    ${meta ? `<div class="meta"><i class="pdot" style="--h:${hue}"></i>${meta}</div>` : ''}
    <div class="stats">${meterHtml(a.context)}${costHtml(a)}</div>
    ${timelineHtml(a)}
    ${countsHtml(a.counts)}
    ${subs.length ? `<ul class="interns">${subs.map(internHtml).join('')}</ul>` : ''}
    ${selected ? detailsHtml(a) : ''}
  </article>`;
}

// ── Sections ───────────────────────────────────────────────────────────────

function renderChips() {
  const counts = new Map();
  for (const a of state.agents.values()) {
    if (a.kind !== 'main' || !a.project) continue;
    counts.set(a.project, (counts.get(a.project) || 0) + 1);
  }
  if (state.filter && !counts.has(state.filter)) counts.set(state.filter, 0);
  const chips = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  const html = chips.length > 1 || state.filter
    ? `<button type="button" class="chip${state.filter ? '' : ' on'}" data-project="">All</button>` + chips.map(([name, n]) => `<button type="button" class="chip${state.filter === name ? ' on' : ''}" data-project="${esc(name)}"><i class="pdot" style="--h:${projectHue(name)}"></i>${esc(projectName(name))}<span>${n}</span></button>`).join('')
    : '';
  setHtml(els.chips, 'chips', html);
  els.chips.hidden = !html;
}

function renderAgents() {
  const list = [...state.agents.values()].filter(matchesFilter);
  const mains = list.filter((a) => a.kind === 'main' || !state.agents.has(a.parentId));
  const subsOf = (id) => list.filter((s) => s.kind === 'sub' && s.parentId === id);
  const needs = mains.filter((a) => a.needsYou).sort((x, y) => (sinceFor(x) || 0) - (sinceFor(y) || 0));
  const working = mains.filter((a) => !a.needsYou && ['thinking', 'working', 'replying', 'done'].includes(a.status)).sort((x, y) => y.lastActivity - x.lastActivity);
  const idle = mains.filter((a) => !needs.includes(a) && !working.includes(a));
  const group = (title, items, cls = '') => items.length
    ? `<section class="group ${cls}"><h2>${title}<span class="count">${items.length}</span></h2>${items.map((a) => cardHtml(a, subsOf(a.id))).join('')}</section>`
    : '';
  const html = group('Needs you', needs, 'group-needs') + group('Working', working) + group('Idle', idle);
  setHtml(els.list, 'agents', html || `<p class="none">${state.filter ? `No agents in ${esc(state.filter)} right now.` : 'No agents right now. Sessions active in the last 30 minutes show up here.'}</p>`);
  tickElapsed();
}

function renderFeed() {
  const items = state.feed.slice(-14).reverse();
  setHtml(els.feed, 'feed', items.length
    ? items.map((f) => `<li><time>${timeSec(f.t)}</time><i style="--c: hsl(${(f.seed ?? 0) % 360} 55% 55%)"></i><b>${f.kind === 'sub' ? '🧢 ' : ''}${esc(f.who)}</b><span>${esc(f.icon)} ${esc(f.text)}</span></li>`).join('')
    : '<li class="none">Nothing yet. Activity shows up here as your agents work.</li>');
}

/** Hide status chips, least useful first, until the rest fit beside the name. */
function fitStatus() {
  const el = els.summary;
  const chips = [...el.children];
  el.classList.remove('bare');
  for (const c of chips) c.hidden = false;
  for (const kind of ['people', 'hot']) {
    if (el.scrollWidth <= el.clientWidth) break;
    const chip = chips.find((c) => c.classList.contains(kind));
    if (chip) chip.hidden = true;
  }
  el.classList.toggle('bare', chips.every((c) => c.hidden));
}

function renderSummary() {
  const mains = [...state.agents.values()].filter((a) => a.kind === 'main');
  const interns = state.agents.size - mains.length;
  const needs = mains.filter((a) => a.needsYou).length;
  // Status chips in the header: who's in and who needs you. Plan limits live on the dashboard.
  const chips = [];
  const people = mains.length ? `${mains.length} agent${mains.length === 1 ? '' : 's'}` : 'Office empty';
  chips.push(`<span class="chip people"${interns ? ` data-tip="${interns} intern${interns === 1 ? '' : 's'} helping out"` : ''}>${people}${interns ? `<small>+${interns}</small>` : ''}</span>`);
  if (needs) chips.push(`<span class="chip hot">${needs} need${needs === 1 ? 's' : ''} you</span>`);
  setHtml(els.summary, 'summary', chips.join(''));
  fitStatus();
  if (state.watching.length) els.watching.textContent = state.watching.join(' and ');
}

function renderLegend() {
  els.legend.innerHTML = ACTIVITY.map(([key, label, where]) => `<span><i class="act-${key}"></i>${esc(label)} <em>${esc(where)}</em></span>`).join('');
}

/** Update every "how long" counter without re-rendering the cards. */
export function tickElapsed() {
  const now = serverNow();
  for (const el of els.list.querySelectorAll('[data-since]')) {
    const since = Number(el.dataset.since);
    el.textContent = since ? `${el.dataset.prefix || ''}${ago(now - since)}` : '';
  }
}

export function renderPanel() {
  renderChips();
  renderAgents();
  renderFeed();
  renderSummary();
}

export function initPanel(elements) {
  els = elements;
  renderLegend();
  window.addEventListener('resize', fitStatus);
  els.list.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const item = e.target.closest('[data-id]');
    if (item) select(item.dataset.id);
  });
  els.list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card')) {
      e.preventDefault();
      select(e.target.dataset.id);
    }
  });
  els.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-project]');
    if (!chip) return;
    if (!chip.dataset.project) {
      if (state.filter) setFilter(state.filter);
    } else setFilter(chip.dataset.project);
  });
}

export function scrollToCard(id) {
  els.list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export { statusText, emit };
