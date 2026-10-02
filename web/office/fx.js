// Little bits of life: particles for celebrations, compactions and errors,
// and an office cat that wanders around and keeps waiting agents company.

import { T, COLS, ROWS, SPOTS, drawCat, findPath, isOpen, tileOf, nearestOpen } from './office.js';

const particles = [];
const CONFETTI = ['#ffcf5c', '#e87ba4', '#3987e5', '#1baf7a', '#eb6834', '#9085e9'];

export function confetti(x, y) {
  for (let i = 0; i < 22; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const speed = 30 + Math.random() * 45;
    particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      g: 90, life: 1300 + Math.random() * 500, age: 0, size: Math.random() < 0.3 ? 2 : 1,
      color: CONFETTI[i % CONFETTI.length],
    });
  }
}

export function puff(x, y) {
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x, y, vx: Math.cos(angle) * 14, vy: Math.sin(angle) * 8 - 10,
      g: -6, life: 900 + Math.random() * 300, age: 0, size: 2, color: '#f4f1e8', fade: true,
    });
  }
}

export function sweat(x, y) {
  for (let i = 0; i < 3; i++) {
    particles.push({
      x: x + (i - 1) * 4, y, vx: (i - 1) * 8, vy: -18 - i * 4,
      g: 70, life: 800, age: 0, size: 1, color: '#7ec8e3',
    });
  }
}

export function zzz(x, y) {
  particles.push({ x, y, vx: 4, vy: -7, g: 0, life: 1800, age: 0, size: 0, text: 'z', color: '#5a5f66', fade: true });
}

export function updateParticles(dt) {
  const s = dt / 1000;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.g * s;
    p.x += p.vx * s;
    p.y += p.vy * s;
  }
}

export function drawParticles(g) {
  for (const p of particles) {
    g.globalAlpha = p.fade ? 1 - p.age / p.life : Math.min(1, (p.life - p.age) / 300);
    if (p.text) {
      g.fillStyle = p.color;
      g.font = '6px ui-monospace, monospace';
      g.fillText(p.text, p.x, p.y);
    } else {
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }
  g.globalAlpha = 1;
}

// ── The cat ────────────────────────────────────────────────────────────────

export const cat = {
  x: 17 * T + 8, y: 16 * T + 12, dir: 'right', path: [], pose: 'sleep',
  walkClock: 0, nextAt: performance.now() + 4000, zAt: 0, meowUntil: 0,
};

const CAT_SPEED = 30;

function randomOpenTile() {
  for (let tries = 0; tries < 40; tries++) {
    const c = 1 + Math.floor(Math.random() * (COLS - 2));
    const r = 4 + Math.floor(Math.random() * (ROWS - 5));
    if (isOpen(c, r)) return [c, r];
  }
  return [17, 16];
}

function chooseDestination(characters) {
  // Most of the time the cat visits someone who is waiting in the lounge.
  const waiting = characters.filter((ch) => !ch.moving && ch.spot?.zone === 'lounge');
  if (waiting.length && Math.random() < 0.65) {
    const ch = waiting[Math.floor(Math.random() * waiting.length)];
    const [c, r] = ch.spot.approach;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isOpen(c + dc, r + dr)) return [c + dc, r + dr];
  }
  if (Math.random() < 0.3) return SPOTS.lounge[0].approach;
  return randomOpenTile();
}

export function updateCat(dt, now, characters) {
  if (!cat.path.length && now > cat.nextAt) {
    let start = tileOf(cat.x, cat.y);
    if (!isOpen(...start)) start = nearestOpen(start);
    const path = findPath(start, chooseDestination(characters));
    if (path?.length) {
      cat.path = path;
      cat.pose = 'walk';
    }
    cat.nextAt = now + 9000 + Math.random() * 14000;
  }
  if (cat.path.length) {
    let move = (CAT_SPEED * dt) / 1000;
    while (move > 0 && cat.path.length) {
      const wp = cat.path[0];
      const dx = wp.x - cat.x;
      const dy = wp.y - cat.y;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.1) cat.dir = dx > 0 ? 'right' : 'left';
      if (dist <= move) {
        cat.x = wp.x;
        cat.y = wp.y;
        cat.path.shift();
        move -= dist;
      } else {
        cat.x += (dx / dist) * move;
        cat.y += (dy / dist) * move;
        move = 0;
      }
    }
    cat.walkClock += dt;
    if (!cat.path.length) cat.pose = Math.random() < 0.5 ? 'sleep' : 'sit';
  }
  if (cat.pose === 'sleep' && now > cat.zAt) {
    zzz(cat.x + 3, cat.y - 6);
    cat.zAt = now + 1400;
  }
}

export function drawTheCat(g) {
  drawCat(g, { x: cat.x, y: cat.y, pose: cat.pose, frame: Math.floor(cat.walkClock / 160) % 2, dir: cat.dir });
}

export function catNear(x, y) {
  return Math.hypot(cat.x - x, cat.y - 3 - y) < 9;
}

export function meow(now) {
  cat.meowUntil = now + 1800;
  if (cat.pose === 'sleep') cat.pose = 'sit';
}
