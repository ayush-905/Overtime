// The office floor: characters, where they walk, how they look, and the
// bubbles and name tags that float above them.

import {
  T, W, H, FURNITURE, DESKS, INTERN_DESKS, SPOTS, DOOR,
  background, drawWall, drawCharacter, lookFor, isNight, screenGlows,
  tileOf, isOpen, nearestOpen, findPath,
} from './office.js';
import { state, select, matchesFilter, clip, waitLevel } from '/shared/state.js';
import * as fx from './fx.js';

const WALK_SPEED = 46; // px per second
const ZONE_SETTLE_MS = 350; // ignore zone flips shorter than this

const chars = new Map(); // id → character
const labelEls = new Map();
let canvas;
let g;
let stage;
let wrap;
let labelsEl;
let catLabel;
let scale = 3;
let firstSync = true;
let active = true; // false while another screen is showing: keep moving, skip drawing

// ── Sizing ─────────────────────────────────────────────────────────────────

function fit() {
  if (!active) return;
  const box = stage.getBoundingClientRect();
  if (!box.width) return;
  const maxH = Math.max(240, window.innerHeight - box.top - 24);
  let s = Math.min((box.width - 24) / W, maxH / H);
  if (s >= 2) s = Math.floor(s * 4) / 4;
  scale = Math.max(0.5, s);
  const k = Math.max(1, Math.round(scale * (window.devicePixelRatio || 1)));
  canvas.width = W * k;
  canvas.height = H * k;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.imageSmoothingEnabled = false;
  wrap.style.width = `${W * scale}px`;
  wrap.style.height = `${H * scale}px`;
}

// ── Characters ─────────────────────────────────────────────────────────────

function lookOf(a) {
  const parent = a.parentId && state.agents.get(a.parentId);
  return lookFor(a.seed, a.kind === 'sub', parent ? parent.seed % 360 : null, a.source);
}

function makeChar(a, walkIn) {
  return {
    id: a.id,
    kind: a.kind,
    look: lookOf(a),
    x: DOOR.x,
    y: DOOR.y,
    dir: 'down',
    path: [],
    spot: null,
    zone: null,
    pendingZone: null,
    pendingSince: 0,
    deskIdx: -1,
    moving: false,
    walkClock: 0,
    arrivedAt: 0,
    alpha: walkIn ? 0 : 1,
    leaving: false,
    prevApproach: null,
    deliverFor: null,
    wanderAt: 0,
    hopUntil: 0,
    alertUntil: 0,
    compactUntil: 0,
    blinkAt: performance.now() + 1500 + Math.random() * 4000,
  };
}

function ensureDesk(ch) {
  const pool = ch.kind === 'sub' ? INTERN_DESKS : DESKS;
  if (ch.deskIdx >= 0) return pool[ch.deskIdx];
  const taken = new Set();
  for (const o of chars.values()) if (o !== ch && o.kind === ch.kind && o.deskIdx >= 0) taken.add(o.deskIdx);
  const a = state.agents.get(ch.id);
  const start = a ? a.seed % pool.length : 0;
  for (let k = 0; k < pool.length; k++) {
    const i = (start + k) % pool.length;
    if (!taken.has(i)) {
      ch.deskIdx = i;
      return pool[i];
    }
  }
  return null;
}

function claimSpot(ch, zone) {
  const pool = SPOTS[zone] || SPOTS.floor;
  if (ch.spot && ch.spot.zone === zone && ch.spot.owner === ch.id) return ch.spot;
  const a = state.agents.get(ch.id);
  const start = a ? a.seed % pool.length : 0;
  for (let k = 0; k < pool.length; k++) {
    const s = pool[(start + k) % pool.length];
    if (!s.owner) return s;
  }
  return zone === 'floor' ? pool[start] : claimSpot(ch, 'floor');
}

function deliverSpot(ch, parent) {
  const anchor = parent.spot && !parent.moving ? parent.spot : null;
  if (ch.deliverFor && ch.deliverFor.anchor === anchor && ch.deliverFor.parentId === parent.id) return ch.deliverFor.spot;
  const [pc, pr] = anchor ? anchor.approach : tileOf(parent.x, parent.y);
  let target = [pc, pr];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (isOpen(pc + dc, pr + dr)) {
      target = [pc + dc, pr + dr];
      break;
    }
  }
  const face = target[0] > pc ? 'left' : target[0] < pc ? 'right' : target[1] > pr ? 'up' : 'down';
  const spot = { zone: 'deliver', x: target[0] * T + 8, y: target[1] * T + 12, face, pose: 'stand', approach: target };
  ch.deliverFor = { anchor, parentId: parent.id, spot };
  return spot;
}

function targetFor(ch, a) {
  if (ch.leaving || !a) return DOOR;
  if (a.kind === 'sub' && a.status === 'done') {
    const parent = chars.get(a.parentId);
    if (parent && !parent.leaving) return deliverSpot(ch, parent);
    ch.leaving = true;
    return DOOR;
  }
  if (ch.zone === 'desk') {
    const desk = ensureDesk(ch);
    return desk ? desk.seat : claimSpot(ch, 'floor');
  }
  return claimSpot(ch, ch.zone);
}

function releaseSpot(ch) {
  if (ch.spot && ch.spot.owner === ch.id) ch.spot.owner = null;
}

function occupy(ch, spot) {
  releaseSpot(ch);
  ch.spot = spot;
  if (SPOTS[spot.zone]) spot.owner = ch.id;
}

function goTo(ch, spot) {
  occupy(ch, spot);
  let start = tileOf(ch.x, ch.y);
  const lead = [];
  if (!isOpen(start[0], start[1])) {
    const out = ch.prevApproach || nearestOpen(start);
    lead.push({ x: out[0] * T + 8, y: out[1] * T + 12 });
    start = out;
  }
  const path = findPath(start, spot.approach) || [];
  ch.path = [...lead, ...path, { x: spot.x, y: spot.y }];
  ch.moving = true;
  ch.prevApproach = spot.approach;
}

function placeAt(ch, spot) {
  occupy(ch, spot);
  ch.x = spot.x;
  ch.y = spot.y;
  ch.path = [];
  ch.moving = false;
  ch.dir = spot.face;
  ch.prevApproach = spot.approach;
}

function removeChar(ch) {
  releaseSpot(ch);
  chars.delete(ch.id);
  labelEls.get(ch.id)?.remove();
  labelEls.delete(ch.id);
}

function freeLoungeSpot(ch) {
  const free = SPOTS.lounge.filter((s) => !s.owner && s !== ch.spot);
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

function step(ch, dt, now) {
  if (!ch.path.length) {
    if (ch.moving) {
      ch.moving = false;
      ch.arrivedAt = now;
      ch.dir = ch.spot?.face || 'down';
    }
    return;
  }
  // Spend the whole frame's movement, even across several waypoints, so a
  // throttled background tab still gets everyone where they are going.
  let move = (WALK_SPEED * dt) / 1000;
  while (move > 0 && ch.path.length) {
    const wp = ch.path[0];
    const dx = wp.x - ch.x;
    const dy = wp.y - ch.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > Math.abs(dy)) ch.dir = dx > 0 ? 'right' : 'left';
    else if (dist > 0.01) ch.dir = dy > 0 ? 'down' : 'up';
    if (dist <= move) {
      ch.x = wp.x;
      ch.y = wp.y;
      ch.path.shift();
      move -= dist;
    } else {
      ch.x += (dx / dist) * move;
      ch.y += (dy / dist) * move;
      move = 0;
    }
  }
  ch.walkClock += dt;
}

function update(dt, now) {
  for (const ch of chars.values()) {
    const a = state.agents.get(ch.id);
    if (a && !ch.leaving) {
      if (ch.zone === null) ch.zone = a.zone;
      else if (a.zone !== ch.zone) {
        if (ch.pendingZone !== a.zone) {
          ch.pendingZone = a.zone;
          ch.pendingSince = now;
        } else if (now - ch.pendingSince > ZONE_SETTLE_MS) {
          ch.zone = a.zone;
          ch.pendingZone = null;
        }
      } else ch.pendingZone = null;
    }

    // Agents waiting in the lounge get up now and then to stretch their legs.
    if (ch.zone === 'lounge' && ch.spot?.zone === 'lounge' && !ch.moving && !ch.leaving) {
      if (!ch.wanderAt) ch.wanderAt = now + 20000 + Math.random() * 35000;
      else if (now > ch.wanderAt) {
        const next = freeLoungeSpot(ch);
        if (next) goTo(ch, next);
        ch.wanderAt = 0;
      }
    }

    const target = targetFor(ch, a);
    if (target !== ch.spot) goTo(ch, target);
    step(ch, dt, now);

    if (a && a.kind === 'sub' && a.status === 'done' && !ch.leaving && !ch.moving && ch.spot?.zone === 'deliver' && now - ch.arrivedAt > 1800) {
      ch.leaving = true;
    }
    if (ch.leaving && !ch.moving && ch.spot === DOOR) {
      ch.alpha -= dt / 450;
      if (ch.alpha <= 0) removeChar(ch);
    } else if (ch.alpha < 1) {
      ch.alpha = Math.min(1, ch.alpha + dt / 450);
    }
    if (now > ch.blinkAt + 140) ch.blinkAt = now + 2500 + Math.random() * 4000;
  }
  fx.updateParticles(dt);
  fx.updateCat(dt, now, [...chars.values()]);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function isTyping(a) {
  return a && (a.status === 'replying' || (a.status === 'working' && a.tool?.category === 'edit'));
}

function screenMode(ch, a) {
  if (!a) return 'off';
  const atDesk = !ch.moving && ch.spot?.zone === 'desk';
  if (!atDesk) return a.status === 'waiting' ? 'waiting' : 'away';
  if (isTyping(a)) return 'typing';
  if (a.status === 'thinking' || a.status === 'working') return 'thinking';
  return 'away';
}

function buildScene() {
  const d = new Date();
  const scene = {
    hour: d.getHours() + d.getMinutes() / 60,
    desks: [], interns: [],
    serversBusy: false, boardBusy: false, webBusy: false, coffeeBusy: false, doorOpen: false,
  };
  for (const ch of chars.values()) {
    const a = state.agents.get(ch.id);
    if (ch.deskIdx >= 0) {
      (ch.kind === 'sub' ? scene.interns : scene.desks)[ch.deskIdx] = { mode: screenMode(ch, a), context: a?.context?.pct || 0 };
    }
    if (a && !ch.moving && ch.spot) {
      const active = a.status === 'working' || a.status === 'thinking';
      if (ch.spot.zone === 'servers' && active) scene.serversBusy = true;
      if (ch.spot.zone === 'board' && active) scene.boardBusy = true;
      if (ch.spot.zone === 'web' && active) scene.webBusy = true;
      if (ch.spot.zone === 'lounge' && ch.spot.approach[0] === 24 && ch.spot.approach[1] === 13) scene.coffeeBusy = true;
    }
    if (Math.hypot(ch.x - DOOR.x, ch.y - DOOR.y) < 22) scene.doorOpen = true;
  }
  return scene;
}

function poseOf(ch, a, now) {
  if (ch.moving) return { pose: 'walk', frame: Math.floor(ch.walkClock / 140) % 2 ? 'a' : 'b', dir: ch.dir };
  const s = ch.spot;
  const dir = s?.face || ch.dir;
  if (s?.pose === 'sit') {
    const typing = s.zone === 'desk' && isTyping(a);
    return { pose: 'sit', frame: typing ? (Math.floor(now / 130) % 2 ? 'a' : 'b') : 'stand', dir };
  }
  if (s?.pose === 'sofa') return { pose: 'sofa', frame: 'stand', dir };
  return { pose: 'stand', frame: 'stand', dir };
}

function hopOffset(ch, now) {
  if (now >= ch.hopUntil) return 0;
  const p = 1 - (ch.hopUntil - now) / 700;
  return -Math.round(Math.abs(Math.sin(p * Math.PI * 2)) * 4);
}

function charAlpha(ch, a) {
  let alpha = ch.alpha;
  if (a?.background) alpha *= 0.55;
  if (a && !matchesFilter(a)) alpha *= 0.25;
  return alpha;
}

function drawChar(ch, now) {
  const a = state.agents.get(ch.id);
  const p = poseOf(ch, a, now);
  const y = ch.y + hopOffset(ch, now);
  if (ch.id === state.selectedId) {
    g.strokeStyle = '#ffd166';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(ch.x, ch.y, 8, 3, 0, 0, Math.PI * 2);
    g.stroke();
  }
  drawCharacter(g, ch.look, {
    x: ch.x, y, dir: p.dir, pose: p.pose, frame: p.frame,
    blink: now > ch.blinkAt && now < ch.blinkAt + 140, alpha: charAlpha(ch, a),
  });
  if (now < ch.alertUntil) {
    const top = y - (p.pose === 'sit' || p.pose === 'sofa' ? 13 : 14) - 6 - Math.round(Math.abs(Math.sin(now / 90)) * 2);
    g.fillStyle = '#d03b3b';
    g.fillRect(Math.round(ch.x) + 4, top, 2, 4);
    g.fillRect(Math.round(ch.x) + 4, top + 5, 2, 2);
  }
}

function render(now) {
  const scene = buildScene();
  g.drawImage(background, 0, 0);
  drawWall(g, now, scene);
  const items = FURNITURE.map((f) => ({ y: f.baseY, f }));
  for (const ch of chars.values()) items.push({ y: ch.y, ch });
  items.push({ y: fx.cat.y, cat: true });
  items.sort((p, q) => p.y - q.y);
  for (const it of items) {
    if (it.f) {
      g.drawImage(it.f.img, it.f.x, it.f.y);
      it.f.dyn?.(g, now, scene);
    } else if (it.cat) fx.drawTheCat(g);
    else drawChar(it.ch, now);
  }
  fx.drawParticles(g);
  if (isNight(scene.hour)) {
    g.fillStyle = 'rgba(16, 20, 52, 0.30)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(80, 130, 210, 0.16)';
    for (const s of screenGlows(scene)) g.fillRect(s.x - 3, s.y - 2, s.w + 6, s.h + 9);
    g.globalCompositeOperation = 'source-over';
  }
}

// ── Bubbles, name tags and context gauges ──────────────────────────────────

function bubbleFor(a, ch, now) {
  if (!a) return { text: '', cls: 'hidden' };
  if (now < ch.compactUntil) return { text: '🧹 tidied up context', cls: 'info' };
  const age = waitLevel(a);
  switch (a.needsYou) {
    case 'turn': return { text: '✅ Your turn', cls: `needs age-${age}` };
    case 'question': return { text: '❓ Question for you', cls: `needs age-${age}` };
    case 'plan': return { text: '📝 Plan to review', cls: `needs age-${age}` };
    case 'approval': return { text: '✋ Needs approval?', cls: `needs age-${age}` };
  }
  switch (a.status) {
    case 'thinking': return { text: '🤔 thinking…', cls: 'think' };
    case 'replying': return { text: '💬 writing a reply', cls: '' };
    case 'done': return { text: '📄 handing in', cls: '' };
    case 'working': return { text: `${a.tool?.icon || '⚙️'} ${clip(a.tool?.detail || a.tool?.verb || 'working', 24)}`, cls: '' };
  }
  return { text: '', cls: 'hidden' };
}

function syncLabels(now) {
  for (const [id, el] of labelEls) if (!chars.has(id)) { el.remove(); labelEls.delete(id); }
  for (const ch of chars.values()) {
    const a = state.agents.get(ch.id);
    let el = labelEls.get(ch.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'label';
      el.innerHTML = '<div class="bubble"></div><div class="nametag"><span></span></div><div class="gauge" hidden><b></b></div>';
      el.addEventListener('click', () => select(ch.id));
      labelsEl.appendChild(el);
      labelEls.set(ch.id, el);
      el._parts = { bubble: el.children[0], name: el.children[1].firstChild, gauge: el.children[2], fill: el.children[2].firstChild };
    }
    const seated = !ch.moving && (ch.spot?.pose === 'sit' || ch.spot?.pose === 'sofa');
    const headTop = ch.y + hopOffset(ch, now) - (seated ? 13 : 14);
    el.style.transform = `translate(${(ch.x * scale).toFixed(1)}px, ${((headTop - 1) * scale).toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = charAlpha(ch, a).toFixed(2);
    el.style.zIndex = ch.id === state.selectedId ? 1000 : a?.needsYou ? 900 : Math.round(ch.y);

    let b = bubbleFor(a, ch, now);
    // On a small office, only the bubbles that matter: who needs you, and who you picked.
    if (scale < 1.3 && !b.cls.startsWith('needs') && ch.id !== state.selectedId) b = { text: '', cls: 'hidden' };
    const key = b.text + '|' + b.cls;
    if (el._bubble !== key) {
      el._parts.bubble.textContent = b.text;
      el._parts.bubble.className = `bubble ${b.cls}`;
      el._bubble = key;
    }
    const name = a ? `${a.kind === 'sub' ? '🧢 ' : ''}${a.background ? '👻 ' : ''}${a.nick}${a.source === 'codex' ? ' · Codex' : a.source === 'pi' ? ' · Pi' : ''}` : '';
    if (el._name !== name) {
      el._parts.name.textContent = name;
      el._name = name;
    }
    const pct = a?.context?.pct;
    el._parts.gauge.hidden = !pct;
    if (pct) {
      el._parts.fill.style.width = `${Math.max(4, pct)}%`;
      el._parts.gauge.className = `gauge ${pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : ''}`;
      el._parts.gauge.title = `Context ${pct}% full`;
    }
    el.classList.toggle('selected', ch.id === state.selectedId);
  }
  catLabel.hidden = performance.now() > fx.cat.meowUntil;
  if (!catLabel.hidden) catLabel.style.transform = `translate(${(fx.cat.x * scale).toFixed(1)}px, ${((fx.cat.y - 8) * scale).toFixed(1)}px) translate(-50%, -100%)`;
}

// ── Syncing with new data ──────────────────────────────────────────────────

/** Place new agents, send departed ones home, and react to what changed. */
export function syncFloor(prev) {
  const now = performance.now();
  const ordered = [...state.agents.values()].sort((x, y) => (x.kind === 'main' ? 0 : 1) - (y.kind === 'main' ? 0 : 1));
  for (const a of ordered) {
    let ch = chars.get(a.id);
    if (!ch) {
      ch = makeChar(a, !firstSync);
      chars.set(a.id, ch);
      if (firstSync) {
        ch.zone = a.zone;
        placeAt(ch, targetFor(ch, a));
      }
      continue;
    }
    if (ch.leaving && !(a.kind === 'sub' && a.status === 'done')) ch.leaving = false;
    const p = prev.get(a.id);
    if (!p) continue;
    if (a.lastCompactAt > (p.lastCompactAt || 0) && now > ch.compactUntil) {
      ch.compactUntil = now + 5000;
      const desk = ch.kind === 'main' && ch.deskIdx >= 0 ? DESKS[ch.deskIdx] : null;
      if (desk?.bin) fx.puff(desk.bin.x + 3, desk.bin.y + 2);
      else fx.puff(ch.x, ch.y - 10);
    }
    if (a.errors > (p.errors || 0)) {
      ch.alertUntil = now + 1600;
      fx.sweat(ch.x, ch.y - 16);
    }
    if (a.endedAt > (p.endedAt || 0) && a.endReason === 'done') {
      ch.hopUntil = now + 700;
      if (a.kind === 'main') fx.confetti(ch.x, ch.y - 14);
    }
  }
  for (const ch of chars.values()) if (!state.agents.has(ch.id)) ch.leaving = true;
  firstSync = false;
}

export function floorIsEmpty() {
  return chars.size === 0;
}

function hitTest(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  if (fx.catNear(x, y)) return { cat: true };
  let best = null;
  let bestDist = 12;
  for (const ch of chars.values()) {
    const d = Math.hypot(ch.x - x, ch.y - 7 - y);
    if (d < bestDist) {
      bestDist = d;
      best = ch;
    }
  }
  return best ? { ch: best } : null;
}

export function initFloor(els) {
  ({ canvas, stage, wrap, labelsEl } = els);
  g = canvas.getContext('2d');
  catLabel = document.createElement('div');
  catLabel.className = 'label cat';
  catLabel.innerHTML = '<div class="bubble">🐱 meow</div>';
  catLabel.hidden = true;
  labelsEl.appendChild(catLabel);

  fit();
  window.addEventListener('resize', fit);
  canvas.addEventListener('click', (e) => {
    const hit = hitTest(e);
    if (hit?.cat) fx.meow(performance.now());
    else if (hit?.ch) select(hit.ch.id);
    else if (state.selectedId) select(state.selectedId);
  });
  canvas.addEventListener('mousemove', (e) => {
    canvas.style.cursor = hitTest(e) ? 'pointer' : 'default';
  });

  startFrames();
  // While another screen is showing, keep everyone walking a few times a second
  // without drawing, so the office is where you'd expect when you come back.
  setInterval(() => {
    if (active) return;
    const now = performance.now();
    advance(now);
  }, 250);
}

const FRAME_MS = 1000 / 30; // 30 frames a second is plenty for pixel art, and half the drawing
let lastStep = performance.now();
let lastDraw = 0;
let frameId = 0;

function advance(now) {
  update(Math.min(1000, now - lastStep), now);
  lastStep = now;
}

function frame(now) {
  frameId = 0;
  if (!active) return;
  advance(now);
  if (now - lastDraw >= FRAME_MS - 1) {
    lastDraw = now;
    render(now);
    syncLabels(now);
  }
  frameId = requestAnimationFrame(frame);
}

function startFrames() {
  if (!frameId) frameId = requestAnimationFrame(frame);
}

export function refit() {
  fit();
}

/** Show or hide the office; it re-measures itself and starts drawing again when it comes back. */
export function setFloorActive(on) {
  active = on;
  if (on) {
    fit();
    startFrames();
  }
}
