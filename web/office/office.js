// Office layout, furniture art and character sprites. Everything is drawn in
// code at a 16px tile size and scaled up with nearest-neighbour filtering.

export const T = 16;
export const COLS = 26;
export const ROWS = 17;
export const W = COLS * T;
export const H = ROWS * T;
const WALL_H = 3 * T;

// ── Walkable grid ──────────────────────────────────────────────────────────

export const blocked = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, () => r < 3));
function block(c, r, w = 1, h = 1) {
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) blocked[y][x] = true;
}

function spot(zone, c, r, face, pose, extra = {}) {
  return { zone, x: c * T + 8, y: r * T + 12, face, pose, approach: [c, r], owner: null, ...extra };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function tileOf(x, y) {
  return [Math.max(0, Math.min(COLS - 1, Math.floor(x / T))), Math.max(0, Math.min(ROWS - 1, Math.floor((y - 1) / T)))];
}

export function isOpen(c, r) {
  return c >= 0 && r >= 0 && c < COLS && r < ROWS && !blocked[r][c];
}

export function nearestOpen([c, r]) {
  for (let d = 1; d < 6; d++) {
    for (const [dc, dr] of DIRS) if (isOpen(c + dc * d, r + dr * d)) return [c + dc * d, r + dr * d];
  }
  return [c, r];
}

/** Breadth-first path over walkable tiles; returns tile-centre waypoints. */
export function findPath([sc, sr], [tc, tr]) {
  const start = sr * COLS + sc;
  const goal = tr * COLS + tc;
  if (start === goal) return [];
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) break;
    const c = cur % COLS;
    const r = (cur / COLS) | 0;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (prev[ni] !== -1 || (blocked[nr][nc] && ni !== goal)) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let cur = goal; cur !== start; cur = prev[cur])
    path.push({ x: (cur % COLS) * T + 8, y: ((cur / COLS) | 0) * T + 12 });
  return path.reverse();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw((x, y, w2, h2, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, w2, h2);
  }, g);
  return c;
}

function rect(g, x, y, w, h, col) {
  g.fillStyle = col;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

const CODE_COLORS = ['#7ec8e3', '#f4d35e', '#ee6c4d', '#9bd18b', '#c49bff'];
const MUGS = ['#e74c3c', '#f39c12', '#2e86de', '#27ae60', '#8e44ad', '#16a085'];
const BOOKS = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#e84393', '#34495e'];

// ── Furniture ──────────────────────────────────────────────────────────────

export const FURNITURE = []; // depth-sorted with characters by baseY
export const DESKS = [];
export const INTERN_DESKS = [];
export const SPOTS = { board: [], books: [], files: [], servers: [], web: [], meeting: [], lounge: [], floor: [] };
export const DOOR = { x: 24 * T, y: 3 * T + 10, face: 'up', pose: 'stand', approach: [23, 3], zone: 'door' };
export const RACK_LEDS = [];

const chairSeat = makeSprite(10, 8, (R) => {
  R(1, 0, 8, 4, '#3a3f58');
  R(1, 0, 8, 1, '#4b5170');
  R(4, 4, 2, 2, '#2a2e40');
  R(1, 6, 8, 1, '#23263a');
  R(0, 7, 2, 1, '#23263a');
  R(8, 7, 2, 1, '#23263a');
});
const chairBack = makeSprite(8, 4, (R) => {
  R(0, 0, 8, 4, '#4b5170');
  R(0, 0, 8, 1, '#5d6485');
  R(0, 3, 8, 1, '#3a3f58');
});
const chairTop = makeSprite(10, 9, (R) => {
  R(1, 0, 8, 5, '#4b5170');
  R(1, 0, 8, 1, '#5d6485');
  R(1, 5, 8, 3, '#3a3f58');
  R(1, 8, 2, 1, '#23263a');
  R(7, 8, 2, 1, '#23263a');
});
const stool = makeSprite(10, 6, (R) => {
  R(2, 0, 6, 3, '#6a5641');
  R(2, 0, 6, 1, '#7f6a52');
  R(2, 3, 1, 3, '#4d3e2f');
  R(7, 3, 1, 3, '#4d3e2f');
});

function addSeatChair(x, y, withBack) {
  FURNITURE.push({ img: chairSeat, x: x - 5, y: y - 5, baseY: y - 1 });
  if (withBack) FURNITURE.push({ img: chairBack, x: x - 4, y: y - 5, baseY: y + 1 });
}

function addPlant(c, r, variant = 0) {
  const leaf = variant ? ['#2f7d44', '#58a866'] : ['#3e8e4f', '#6cbf78'];
  const img = makeSprite(14, 22, (R) => {
    R(6, 3, 2, 12, '#2e6b3a');
    R(2, 5, 5, 3, leaf[0]);
    R(7, 2, 5, 3, leaf[1]);
    R(1, 10, 5, 3, leaf[1]);
    R(8, 8, 5, 3, leaf[0]);
    R(4, 0, 5, 3, leaf[0]);
    R(9, 12, 4, 2, leaf[1]);
    R(2, 14, 10, 2, '#c4754a');
    R(3, 16, 8, 6, '#b0643a');
    R(3, 16, 8, 1, '#9a5430');
  });
  FURNITURE.push({ img, x: c * T + 1, y: r * T - 6, baseY: r * T + 16 });
  block(c, r);
}

function addDesk(i, c, r) {
  const mug = MUGS[i % MUGS.length];
  const img = makeSprite(32, 22, (R) => {
    R(8, 0, 16, 10, '#2a2d34');
    R(9, 1, 14, 8, '#12161c');
    R(14, 10, 4, 2, '#3a3d44');
    R(12, 11, 8, 1, '#3a3d44');
    R(0, 11, 32, 7, '#a06d40');
    R(0, 11, 32, 1, '#b8814f');
    R(0, 17, 32, 1, '#8a5c34');
    R(1, 18, 30, 3, '#7b5230');
    R(2, 21, 2, 1, '#5e3d22');
    R(28, 21, 2, 1, '#5e3d22');
    R(10, 13, 11, 3, '#cfd4db');
    R(11, 14, 9, 1, '#b7bdc6');
    R(23, 14, 2, 2, '#cfd4db');
    R(3, 12, 3, 4, mug);
    R(6, 13, 1, 2, mug);
    R(26, 13, 5, 3, '#f3efe4');
    R(27, 14, 3, 1, '#cfc8b6');
  });
  const desk = {
    i,
    c,
    r,
    screen: { x: c * T + 9, y: r * T - 5, w: 14, h: 8 },
    seat: spot('desk', c, r + 1, 'up', 'sit', { x: (c + 1) * T, y: (r + 1) * T + 12, approach: [c, r + 1], desk: i }),
  };
  DESKS.push(desk);
  FURNITURE.push({
    img,
    x: c * T,
    y: r * T - 6,
    baseY: r * T + 16,
    dyn: (g, now, scene) => drawScreen(g, desk.screen, scene.desks[i], now, i),
  });
  addSeatChair(desk.seat.x, desk.seat.y, true);
  // A paper bin that fills up as the agent's context window does.
  desk.bin = { x: c * T + 26, y: (r + 1) * T + 4 };
  FURNITURE.push({
    img: binImg,
    x: desk.bin.x,
    y: desk.bin.y,
    baseY: desk.bin.y + 7,
    dyn: (g, now, scene) => drawBin(g, desk.bin, scene.desks[i]),
  });
  block(c, r, 2, 1);
}

const binImg = makeSprite(6, 8, (R) => {
  R(0, 1, 6, 7, '#7d8894');
  R(0, 1, 6, 1, '#a3adb8');
  R(1, 2, 4, 5, '#5e6873');
  R(1, 7, 4, 1, '#5e6873');
});

const PAPER = ['#f4f1e8', '#e9e4d6', '#fbfaf4'];

function drawBin(g, bin, state) {
  const pct = state?.context || 0;
  if (!pct) return;
  // Paper balls stack inside the bin and start piling over the rim past 85%.
  const balls = Math.min(9, Math.ceil(pct / 11));
  const spots = [
    [1, 6],
    [3, 6],
    [2, 5],
    [1, 4],
    [3, 4],
    [2, 3],
    [1, 1],
    [3, 0],
    [2, -1],
  ];
  for (let k = 0; k < balls; k++) {
    const [dx, dy] = spots[k];
    rect(g, bin.x + dx, bin.y + dy, 2, 2, PAPER[k % PAPER.length]);
  }
  if (pct >= 90) rect(g, bin.x + 4, bin.y - 1, 2, 2, '#e8e2d0');
}

function addInternDesk(i, c, r) {
  const img = makeSprite(16, 18, (R) => {
    R(3, 1, 10, 7, '#9aa1ab');
    R(4, 2, 8, 5, '#12161c');
    R(2, 8, 12, 2, '#c9ced6');
    R(0, 7, 16, 6, '#b98a5a');
    R(0, 7, 16, 1, '#cf9f6c');
    R(2, 8, 12, 2, '#c9ced6');
    R(0, 13, 16, 1, '#9c7048');
    R(1, 14, 14, 3, '#8b6240');
    R(1, 17, 2, 1, '#6b4a30');
    R(13, 17, 2, 1, '#6b4a30');
  });
  const desk = {
    i,
    c,
    r,
    screen: { x: c * T + 4, y: r * T, w: 8, h: 5 },
    seat: spot('desk', c, r + 1, 'up', 'sit', { intern: i }),
  };
  INTERN_DESKS.push(desk);
  FURNITURE.push({
    img,
    x: c * T,
    y: r * T - 2,
    baseY: r * T + 16,
    dyn: (g, now, scene) => drawScreen(g, desk.screen, scene.interns[i], now, i + 7),
  });
  FURNITURE.push({ img: stool, x: desk.seat.x - 5, y: desk.seat.y - 4, baseY: desk.seat.y - 1 });
  block(c, r);
}

function drawScreen(g, s, state, now, seed) {
  const mode = state?.mode || 'off';
  if (mode === 'off') {
    rect(g, s.x, s.y, s.w, s.h, '#12161c');
    rect(g, s.x, s.y, 2, 1, '#252c36');
    return;
  }
  rect(g, s.x, s.y, s.w, s.h, mode === 'away' ? '#18202b' : '#1b2a3a');
  if (mode === 'typing') {
    const scroll = Math.floor(now / 200);
    const lines = Math.max(2, Math.floor((s.h - 1) / 2));
    for (let k = 0; k < lines; k++) {
      const n = scroll + k + seed * 3;
      const indent = n % 3;
      const len = 2 + ((n * 7919) % Math.max(3, s.w - 4 - indent));
      rect(
        g,
        s.x + 1 + indent,
        s.y + 1 + k * 2,
        Math.min(len, s.w - 2 - indent),
        1,
        CODE_COLORS[(n + seed) % CODE_COLORS.length],
      );
    }
  } else if (mode === 'thinking') {
    rect(g, s.x + 1, s.y + 1, Math.floor(s.w * 0.6), 1, '#4b6a88');
    rect(g, s.x + 1, s.y + 3, Math.floor(s.w * 0.4), 1, '#4b6a88');
    if (Math.floor(now / 450) % 2) rect(g, s.x + 1 + Math.floor(s.w * 0.4) + 1, s.y + 3, 1, 1, '#e8eef5');
  } else if (mode === 'waiting') {
    const t = now / 900;
    rect(
      g,
      s.x + Math.round(((Math.sin(t) + 1) * (s.w - 3)) / 2) + 1,
      s.y + Math.round(((Math.cos(t * 1.3) + 1) * (s.h - 3)) / 2) + 1,
      1,
      1,
      '#f4d35e',
    );
  } else {
    rect(g, s.x + Math.floor(s.w / 2) - 1, s.y + Math.floor(s.h / 2) - 1, 2, 2, '#2c3a4d');
  }
}

function buildOffice() {
  // Top wall: bookshelf, filing cabinets, plants.
  const shelf = makeSprite(64, 44, (R) => {
    const rnd = mulberry32(42);
    R(0, 0, 64, 44, '#6b4226');
    R(0, 0, 64, 2, '#7d5030');
    R(0, 0, 2, 44, '#51311b');
    R(62, 0, 2, 44, '#51311b');
    for (let s = 0; s < 3; s++) {
      const top = 3 + s * 13;
      R(2, top, 60, 11, '#4a2c17');
      let x = 3;
      while (x < 59) {
        if (rnd() < 0.07) {
          x += 3;
          continue;
        }
        const w = 2 + Math.floor(rnd() * 2);
        const h = 7 + Math.floor(rnd() * 4);
        const col = BOOKS[Math.floor(rnd() * BOOKS.length)];
        R(x, top + 11 - h, Math.min(w, 59 - x), h, col);
        R(x, top + 11 - h + 2, Math.min(w, 59 - x), 1, 'rgba(255,255,255,0.25)');
        x += w + (rnd() < 0.2 ? 1 : 0);
      }
      R(2, top + 11, 60, 2, '#51311b');
    }
  });
  FURNITURE.push({ img: shelf, x: 15 * T, y: 20, baseY: 4 * T });
  block(15, 3, 4, 1);
  for (let c = 15; c <= 18; c++) SPOTS.books.push(spot('books', c, 4, 'up', 'stand'));

  const cabinets = makeSprite(32, 30, (R) => {
    for (let k = 0; k < 2; k++) {
      const x0 = k * 16;
      R(x0, 0, 15, 30, '#8a939e');
      R(x0, 0, 15, 1, '#a3acb6');
      for (let d = 0; d < 3; d++) {
        const y0 = 2 + d * 9;
        R(x0 + 1, y0, 13, 8, '#7c858f');
        R(x0 + 2, y0 + 1, 11, 6, '#8f98a2');
        R(x0 + 5, y0 + 3, 5, 1, '#d9dde2');
      }
    }
  });
  FURNITURE.push({ img: cabinets, x: 20 * T, y: 2 * T + 2, baseY: 4 * T });
  block(20, 3, 2, 1);
  SPOTS.files.push(spot('files', 20, 4, 'up', 'stand'), spot('files', 21, 4, 'up', 'stand'));

  for (let c = 10; c <= 12; c++) SPOTS.board.push(spot('board', c, 3, 'up', 'stand'));

  addPlant(0, 3);
  addPlant(14, 3, 1);
  addPlant(22, 3);
  addPlant(0, 16, 1);
  addPlant(9, 16);

  // Desks for the main agents, and a small pod for subagent interns.
  [
    [1, 5],
    [4, 5],
    [7, 5],
    [1, 9],
    [4, 9],
    [7, 9],
  ].forEach(([c, r], i) => addDesk(i, c, r));
  [
    [1, 13],
    [3, 13],
    [5, 13],
    [7, 13],
  ].forEach(([c, r], i) => addInternDesk(i, c, r));

  // Meeting table, where agents brief their subagents.
  const table = makeSprite(64, 28, (R) => {
    R(0, 0, 64, 22, '#94704d');
    R(0, 0, 64, 1, '#a8845f');
    R(0, 21, 64, 1, '#7d5a3a');
    R(1, 22, 62, 4, '#6e4f33');
    R(3, 26, 3, 2, '#523a26');
    R(58, 26, 3, 2, '#523a26');
    R(8, 6, 11, 7, '#c9ced6');
    R(9, 7, 9, 4, '#2b3440');
    R(28, 8, 9, 7, '#f3efe4');
    R(30, 10, 5, 1, '#cfc8b6');
    R(30, 12, 4, 1, '#cfc8b6');
    R(47, 7, 3, 3, '#f39c12');
    R(52, 12, 6, 1, '#2e86de');
  });
  FURNITURE.push({ img: table, x: 12 * T, y: 7 * T + 2, baseY: 9 * T });
  block(12, 7, 4, 2);
  for (let c = 12; c <= 15; c++) {
    const top = spot('meeting', c, 6, 'down', 'sit', { y: 7 * T + 6, approach: [c, 6] });
    const bottom = spot('meeting', c, 9, 'up', 'sit', { y: 9 * T + 10 });
    SPOTS.meeting.push(top, bottom);
    FURNITURE.push({ img: chairTop, x: top.x - 5, y: top.y - 14, baseY: top.y - 3 });
    addSeatChair(bottom.x, bottom.y, true);
  }

  // Web kiosk: a standing desk with a big globe screen.
  const kiosk = makeSprite(32, 28, (R) => {
    R(3, 0, 26, 15, '#2a2d34');
    R(4, 1, 24, 13, '#0f2740');
    R(14, 15, 4, 5, '#555c66');
    R(1, 19, 30, 5, '#6b737e');
    R(1, 19, 30, 1, '#808894');
    R(2, 24, 28, 4, '#4a515b');
  });
  const kioskScreen = { x: 19 * T + 4, y: 8 * T - 11, w: 24, h: 13 };
  FURNITURE.push({
    img: kiosk,
    x: 19 * T,
    y: 8 * T - 12,
    baseY: 9 * T,
    dyn: (g, now, scene) => drawGlobe(g, kioskScreen, now, scene.webBusy),
  });
  block(19, 8, 2, 1);
  SPOTS.web.push(spot('web', 19, 9, 'up', 'stand'), spot('web', 20, 9, 'up', 'stand'));

  // Server racks for shell commands.
  const rack = makeSprite(16, 36, (R) => {
    R(1, 0, 15, 36, '#262a33');
    R(1, 0, 15, 1, '#3a404c');
    for (let u = 0; u < 6; u++) {
      const y0 = 2 + u * 5 + (u > 2 ? 1 : 0);
      R(3, y0, 12, 4, '#343a46');
      R(9, y0 + 1, 5, 1, '#2a2f39');
      R(9, y0 + 3, 5, 1, '#2a2f39');
    }
  });
  [5, 7, 9].forEach((r, k) => {
    const x = 25 * T;
    const y = r * T - 4;
    const leds = [];
    for (let u = 0; u < 6; u++) {
      const y0 = y + 2 + u * 5 + (u > 2 ? 1 : 0) + 1;
      leds.push({ x: x + 4, y: y0, seed: k * 11 + u }, { x: x + 6, y: y0 + 1, seed: k * 11 + u + 5 });
    }
    RACK_LEDS.push(...leds);
    FURNITURE.push({
      img: rack,
      x,
      y,
      baseY: (r + 2) * T,
      dyn: (g, now, scene) => drawLeds(g, leds, now, scene.serversBusy),
    });
    block(25, r, 1, 2);
    SPOTS.servers.push(spot('servers', 24, r + 1, 'right', 'stand'));
  });

  // Lounge: sofa, coffee table, coffee machine, water cooler, beanbags.
  const sofa = makeSprite(48, 22, (R) => {
    R(2, 0, 44, 9, '#a44a33');
    R(2, 0, 44, 1, '#bf5b40');
    R(6, 3, 6, 5, '#f2c14e');
    R(36, 3, 6, 5, '#5aa37a');
    R(3, 9, 42, 8, '#c86a4f');
    R(3, 9, 42, 1, '#d77c60');
    R(17, 9, 1, 8, '#a9563e');
    R(31, 9, 1, 8, '#a9563e');
    R(0, 3, 5, 15, '#8e3f2b');
    R(43, 3, 5, 15, '#8e3f2b');
    R(0, 3, 5, 1, '#a44a33');
    R(43, 3, 5, 1, '#a44a33');
    R(2, 17, 44, 3, '#6e2f20');
    R(3, 20, 2, 2, '#4a2016');
    R(43, 20, 2, 2, '#4a2016');
  });
  FURNITURE.push({ img: sofa, x: 18 * T, y: 12 * T - 8, baseY: 12 * T + 6 });
  block(18, 12, 3, 1);
  for (let c = 18; c <= 20; c++)
    SPOTS.lounge.push(spot('lounge', c, 12, 'down', 'sofa', { y: 12 * T + 13, approach: [c, 13] }));

  const coffeeTable = makeSprite(48, 12, (R) => {
    R(1, 0, 46, 6, '#7b5230');
    R(1, 0, 46, 1, '#946640');
    R(3, 6, 2, 5, '#5e3d22');
    R(43, 6, 2, 5, '#5e3d22');
    R(10, 1, 3, 3, '#f4f4f4');
    R(29, 1, 7, 4, '#e84393');
    R(37, 2, 5, 3, '#2e86de');
  });
  FURNITURE.push({ img: coffeeTable, x: 18 * T, y: 14 * T + 3, baseY: 14 * T + 14 });
  block(18, 14, 3, 1);

  const coffee = makeSprite(14, 24, (R) => {
    R(1, 0, 12, 24, '#3b3b3b');
    R(1, 0, 12, 2, '#555555');
    R(3, 4, 8, 5, '#222222');
    R(6, 11, 2, 2, '#999999');
    R(5, 16, 4, 4, '#f4f4f4');
    R(3, 20, 8, 1, '#777777');
  });
  FURNITURE.push({
    img: coffee,
    x: 25 * T + 1,
    y: 13 * T - 8,
    baseY: 14 * T,
    dyn: (g, now, scene) => drawCoffee(g, now, scene.coffeeBusy),
  });
  block(25, 13);
  SPOTS.lounge.push(spot('lounge', 24, 13, 'right', 'stand'));

  const cooler = makeSprite(12, 26, (R) => {
    R(2, 0, 8, 9, 'rgba(140,200,240,0.9)');
    R(3, 1, 2, 6, 'rgba(255,255,255,0.5)');
    R(4, 9, 4, 1, '#5a8fb8');
    R(1, 10, 10, 16, '#e8ecef');
    R(1, 10, 10, 1, '#ffffff');
    R(3, 14, 2, 2, '#4aa3ff');
    R(7, 14, 2, 2, '#e74c3c');
  });
  FURNITURE.push({ img: cooler, x: 25 * T + 2, y: 15 * T - 10, baseY: 16 * T });
  block(25, 15);
  SPOTS.lounge.push(spot('lounge', 24, 15, 'right', 'stand'));

  [
    [21, 15, '#e0a13a'],
    [23, 15, '#5aa37a'],
  ].forEach(([c, r, col]) => {
    const bag = makeSprite(16, 12, (R) => {
      R(4, 1, 8, 3, col);
      R(2, 3, 12, 8, col);
      R(1, 5, 14, 6, col);
      R(4, 3, 4, 1, 'rgba(255,255,255,0.35)');
      R(2, 10, 12, 1, 'rgba(0,0,0,0.2)');
    });
    FURNITURE.push({ img: bag, x: c * T, y: r * T + 3, baseY: r * T + 10 });
    SPOTS.lounge.push(spot('lounge', c, r, 'down', 'sofa', { y: r * T + 12 }));
  });
  SPOTS.lounge.push(spot('lounge', 16, 14, 'right', 'stand'), spot('lounge', 16, 15, 'right', 'stand'));

  for (const [c, r] of [
    [10, 11],
    [11, 11],
    [13, 11],
    [14, 11],
    [10, 12],
    [11, 12],
    [13, 12],
    [14, 12],
  ]) {
    SPOTS.floor.push(spot('floor', c, r, 'down', 'stand'));
  }
}

function drawGlobe(g, s, now, busy) {
  const cx = s.x + 12;
  const cy = s.y + 6;
  g.save();
  g.beginPath();
  g.arc(cx, cy, 5, 0, Math.PI * 2);
  g.fillStyle = busy ? '#2e86de' : '#255f99';
  g.fill();
  g.clip();
  const shift = (now / (busy ? 90 : 400)) % 24;
  g.fillStyle = busy ? '#58c27d' : '#3f8f5c';
  for (const [dx, dy, w, h] of [
    [0, -3, 4, 3],
    [5, 0, 3, 4],
    [11, -2, 4, 2],
    [16, 1, 5, 3],
    [20, -4, 3, 2],
  ]) {
    const x = cx - 5 + ((dx + shift) % 24) - 6;
    g.fillRect(Math.round(x), cy + dy, w, h);
    g.fillRect(Math.round(x - 24), cy + dy, w, h);
  }
  g.restore();
  if (busy) {
    const p = (now / 30) % 18;
    rect(g, s.x + 3, s.y + 12, 18, 1, '#1d3b5c');
    rect(g, s.x + 3, s.y + 12, Math.round(p), 1, '#7ec8e3');
  }
}

function drawLeds(g, leds, now, busy) {
  for (const led of leds) {
    const period = busy ? 110 : 900;
    const on = (Math.floor(now / period) + led.seed * 7) % 5 < (busy ? 3 : 4);
    const col = led.seed % 3 === 0 ? '#4aa3ff' : led.seed % 7 === 0 ? '#ffb020' : '#3ddc84';
    rect(g, led.x, led.y, 1, 1, on ? col : '#1c2a22');
  }
}

function drawCoffee(g, now, busy) {
  const x = 25 * T + 1;
  const y = 13 * T - 8;
  rect(g, x + 4, y + 5, 2, 1, Math.floor(now / 700) % 2 ? '#e74c3c' : '#7a2a22');
  rect(g, x + 7, y + 5, 3, 1, '#3ddc84');
  if (!busy) return;
  for (let k = 0; k < 3; k++) {
    const t = (now / 400 + k / 3) % 1;
    g.globalAlpha = 1 - t;
    rect(g, x + 6 + Math.round(Math.sin(t * 6 + k) * 1.5), y + 15 - Math.round(t * 10), 1, 1, '#ffffff');
  }
  g.globalAlpha = 1;
}

buildOffice();

// ── Static background: floor, wall, rug, wall decor ────────────────────────

const WINDOWS = [18, 82];

export const background = makeSprite(W, H, (R) => {
  // Floor planks.
  R(0, WALL_H, W, H - WALL_H, '#c39a6b');
  for (let row = 0, y = WALL_H; y < H; row++, y += 8) {
    R(0, y, W, 1, '#b48a5d');
    if (row % 3 === 1) R(0, y + 1, W, 7, '#c8a072');
    for (let x = (row % 2) * 24; x < W; x += 48) R(x, y, 1, 8, '#aa8055');
  }
  // Wall.
  R(0, 0, W, WALL_H, '#e6dccb');
  R(0, 0, W, 3, '#cdbfa6');
  R(0, 34, W, 11, '#d9ccb4');
  R(0, 34, W, 1, '#c7b89d');
  R(0, 45, W, 3, '#7a5a3c');
  R(0, WALL_H, W, 2, 'rgba(0,0,0,0.12)');
  // Window frames (sky is drawn live).
  for (const x of WINDOWS) {
    R(x - 2, 5, 48, 28, '#f6f2ea');
    R(x - 3, 33, 50, 2, '#e2dccf');
  }
  // Poster and a framed picture.
  R(130, 9, 12, 17, '#2d3a4f');
  R(132, 11, 8, 6, '#f39c12');
  R(132, 19, 8, 1, '#8fa3bf');
  R(132, 21, 6, 1, '#8fa3bf');
  R(339, 12, 12, 10, '#6b4226');
  R(340, 13, 10, 8, '#9fd3f5');
  R(340, 18, 10, 3, '#5aa37a');
  // Whiteboard.
  const bx = 9 * T + 2;
  R(bx, 6, 76, 30, '#aab2bc');
  R(bx + 2, 8, 72, 26, '#fbfbf6');
  R(bx + 6, 36, 64, 2, '#8d959f');
  R(bx + 10, 35, 4, 1, '#e74c3c');
  R(bx + 16, 35, 4, 1, '#2e86de');
  R(bx + 22, 35, 4, 1, '#27ae60');
  // A little flow chart that is always there.
  R(bx + 6, 12, 14, 1, '#2e86de');
  R(bx + 6, 19, 14, 1, '#2e86de');
  R(bx + 6, 12, 1, 8, '#2e86de');
  R(bx + 19, 12, 1, 8, '#2e86de');
  R(bx + 20, 15, 6, 1, '#555555');
  R(bx + 25, 14, 1, 3, '#555555');
  R(bx + 27, 12, 10, 1, '#e74c3c');
  R(bx + 27, 19, 10, 1, '#e74c3c');
  R(bx + 27, 12, 1, 8, '#e74c3c');
  R(bx + 36, 12, 1, 8, '#e74c3c');
  R(bx + 8, 25, 26, 1, '#9aa3ad');
  R(bx + 8, 28, 18, 1, '#9aa3ad');
  // Door mat and lounge rug.
  R(23 * T + 3, 3 * T + 1, 2 * T - 6, 5, '#5f7f5f');
  const rx = 16 * T + 2;
  const ry = 11 * T + 12;
  R(rx, ry, 9 * T - 4, H - ry - 4, '#47648a');
  R(rx + 2, ry + 2, 9 * T - 8, H - ry - 8, '#5f7fa6');
  for (let y = ry + 6; y < H - 8; y += 8) R(rx + 6, y, 9 * T - 16, 1, '#6d8fb6');
});

// ── Live wall: windows, clock, whiteboard, door ────────────────────────────

const STARS = Array.from({ length: 14 }, (_, i) => {
  const r = mulberry32(i + 7);
  return [Math.floor(r() * 44), Math.floor(r() * 24), r()];
});

export function isNight(hour) {
  return hour >= 19.5 || hour < 6;
}

function skyColors(hour) {
  if (hour < 5 || hour >= 20.5) return ['#0b1633', '#1b2a52'];
  if (hour < 7) return ['#9ec9e8', '#f6a86b'];
  if (hour < 17.5) return ['#7cc6fb', '#cdeeff'];
  if (hour < 19.5) return ['#6a4c93', '#f08a5d'];
  return ['#1b2a52', '#2a2f5a'];
}

export function drawWall(g, now, scene) {
  const [top, bottom] = skyColors(scene.hour);
  const night = scene.hour < 5 || scene.hour >= 20.5;
  for (const x of WINDOWS) {
    rect(g, x, 7, 44, 12, top);
    rect(g, x, 19, 44, 12, bottom);
    if (night) {
      for (const [sx, sy, p] of STARS)
        if (Math.floor(now / 600 + p * 10) % 7 !== 0) rect(g, x + sx, 7 + sy, 1, 1, '#f5f3d7');
      rect(g, x + 32, 10, 4, 4, '#f5f3d7');
    } else {
      const cloud = ((now / 900 + x) % 70) - 14;
      rect(g, x + cloud, 11, 10, 3, 'rgba(255,255,255,0.85)');
      rect(g, x + cloud + 3, 9, 5, 2, 'rgba(255,255,255,0.85)');
    }
    // Mullions.
    rect(g, x + 21, 7, 2, 24, '#f6f2ea');
    rect(g, x, 18, 44, 2, '#f6f2ea');
  }

  // Clock with real time.
  const cx = 19 * T + 8;
  const cy = 18;
  g.beginPath();
  g.arc(cx, cy, 7, 0, Math.PI * 2);
  g.fillStyle = '#fdfbf7';
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#5b4636';
  g.stroke();
  const d = new Date();
  const hAng = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;
  const mAng = ((d.getMinutes() + d.getSeconds() / 60) / 60) * Math.PI * 2 - Math.PI / 2;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(hAng) * 3.5, cy + Math.sin(hAng) * 3.5);
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(mAng) * 5.5, cy + Math.sin(mAng) * 5.5);
  g.strokeStyle = '#2b2b33';
  g.stroke();

  // Whiteboard: someone planning adds lines as they go.
  if (scene.boardBusy) {
    const bx = 9 * T + 2;
    const n = Math.floor(now / 350) % 9;
    for (let k = 0; k < n; k++) {
      const len = 6 + ((k * 37) % 20);
      rect(g, bx + 42, 11 + k * 2.4, len, 1, k % 3 === 0 ? '#2e86de' : '#555555');
    }
  }

  // Door, opens when someone is near it.
  const x = 23 * T + 1;
  const y = 8;
  rect(g, x, y, 30, 40, '#6a4428');
  rect(g, x + 9, 2, 12, 4, '#2f8f4e');
  rect(g, x + 11, 3, 8, 2, '#dff5e5');
  if (scene.doorOpen) {
    rect(g, x + 2, y + 2, 26, 38, '#2a2320');
    rect(g, x + 2, y + 2, 26, 3, '#3d342f');
    rect(g, x + 2, y + 2, 5, 38, '#8b5e3c');
    rect(g, x + 6, y + 2, 1, 38, '#6f4a2e');
  } else {
    rect(g, x + 2, y + 2, 26, 38, '#8b5e3c');
    rect(g, x + 5, y + 5, 20, 14, '#7a5234');
    rect(g, x + 5, y + 22, 20, 14, '#7a5234');
    rect(g, x + 23, y + 20, 2, 2, '#e0b64a');
  }
}

export function screenGlows(scene) {
  const glows = [];
  DESKS.forEach((d, i) => {
    if (scene.desks[i] && scene.desks[i].mode !== 'off') glows.push(d.screen);
  });
  INTERN_DESKS.forEach((d, i) => {
    if (scene.interns[i] && scene.interns[i].mode !== 'off') glows.push(d.screen);
  });
  glows.push({ x: 19 * T + 4, y: 8 * T - 11, w: 24, h: 13 });
  return glows;
}

// ── Characters ─────────────────────────────────────────────────────────────

const HEAD_FRONT = ['...hhhh...', '..hhhhhh..', '.hhhhhhhh.', '.hssssssh.', '.sesssses.', '.ssssssss.', '..ssssss..'];
const HEAD_BACK = ['...hhhh...', '..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', '.hhhhhhhh.', '.shhhhhhs.', '..ssssss..'];
const HEAD_SIDE = ['...hhhh...', '..hhhhhhh.', '.hhhhhhhh.', '.ssshhhhh.', 'sesshhhhh.', '.sssshhhh.', '..ssss....'];
const BODY = ['.dccccccd.', 'sdccccccds', 'sdccccccds', '.pppppppp.'];
const BODY_SIDE = ['..dcccc...', '..dccsc...', '..dcccc...', '..pppp....'];
const LEGS = {
  stand: ['.ppp..ppp.', '.ppp..ppp.', '.kkk..kkk.'],
  a: ['.ppp..ppp.', '.ppp..kkk.', '.kkk......'],
  b: ['.ppp..ppp.', '.kkk..ppp.', '......kkk.'],
};
const LEGS_SIDE = {
  stand: ['..pppp....', '..pppp....', '.kkkk.....'],
  a: ['..pppp....', '.pp..pp...', 'kk....kk..'],
  b: ['..pppp....', '...pp.....', '..kkk.....'],
};
const LEGS_SOFA = ['.pppppppp.', '.pp....pp.', '.kk....kk.'];

const SKIN = ['#f5d0b0', '#eab98f', '#d39a6a', '#b97a4a', '#8d5a36', '#6a4127'];
const HAIR = ['#2b1b10', '#4a2f1d', '#7a4a26', '#c7852f', '#e2c16e', '#1d1d24', '#9aa0a8', '#a83f3f', '#5b3d8f'];
const PANTS = ['#2f3b55', '#3b3b3b', '#4a3b2b', '#2e4a3b', '#5a5f6b'];

// Codex agents all wear the same dark hoodie, and Pi's a plum one, so they stand apart from Claude's.
const HOODIES = { codex: ['#2f3a44', '#1fae8a'], pi: ['#5c2a4d', '#e58bc4'] };

export function lookFor(seed, intern = false, capHue = null, source = 'claude') {
  const hue = seed % 360;
  const hoodie = HOODIES[source];
  return {
    key: `${seed}:${intern ? capHue : ''}:${hoodie ? source : ''}`,
    hue,
    intern,
    colors: {
      h: HAIR[(seed >>> 3) % HAIR.length],
      s: SKIN[(seed >>> 7) % SKIN.length],
      e: '#1d1d24',
      c: hoodie ? hoodie[0] : `hsl(${hue} 55% 55%)`,
      d: hoodie ? hoodie[1] : `hsl(${hue} 50% 42%)`,
      p: PANTS[(seed >>> 11) % PANTS.length],
      k: '#2b2b33',
      y: '#f7d046',
      a: `hsl(${capHue ?? hue} 65% 50%)`,
    },
  };
}

const spriteCache = new Map();

function buildRows(view, pose, frame, blink, look) {
  let head = view === 'back' ? HEAD_BACK : view === 'side' ? HEAD_SIDE : HEAD_FRONT;
  if (blink && view !== 'back') head = head.map((row) => row.replace(/e/g, 's'));
  if (look.intern) head = head.map((row, i) => (i < 3 ? row.replace(/h/g, 'a') : row));
  let body = view === 'side' ? [...BODY_SIDE] : [...BODY];
  if (look.intern && view === 'front') body[1] = body[1].slice(0, 3) + 'y' + body[1].slice(4);
  if (pose === 'sit') {
    if (view === 'back' && frame === 'a') body[1] = 'sdccccccd.';
    if (view === 'back' && frame === 'b') body[1] = '.dccccccds';
    return [...head, ...body.slice(0, 3)];
  }
  if (pose === 'sofa') return [...head, ...body, ...LEGS_SOFA];
  const legs = view === 'side' ? LEGS_SIDE[frame] || LEGS_SIDE.stand : LEGS[frame] || LEGS.stand;
  return [...head, ...body, ...legs];
}

function characterSprite(look, view, pose, frame, blink, flip) {
  const key = `${look.key}|${view}|${pose}|${frame}|${blink ? 1 : 0}|${flip ? 1 : 0}`;
  let img = spriteCache.get(key);
  if (img) return img;
  const rows = buildRows(view, pose, frame, blink, look);
  img = makeSprite(10, rows.length, (R) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        R(flip ? 9 - x : x, y, 1, 1, look.colors[ch]);
      }
    });
  });
  spriteCache.set(key, img);
  return img;
}

/** Draw a character with its feet at (x, y). */
export function drawCharacter(g, look, { x, y, dir, pose, frame, blink, alpha = 1 }) {
  const view = dir === 'up' ? 'back' : dir === 'left' || dir === 'right' ? 'side' : 'front';
  const flip = dir === 'right';
  const img = characterSprite(look, view, pose, frame, blink, flip);
  g.globalAlpha = alpha;
  if (pose === 'stand' || pose === 'walk') {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(Math.round(x) - 4, Math.round(y) - 1, 8, 2);
  }
  const top = pose === 'sit' || pose === 'sofa' ? y - 13 : y - 14;
  g.drawImage(img, Math.round(x) - 5, Math.round(top));
  g.globalAlpha = 1;
}

/** A small portrait for the sidebar. */
export function portrait(look) {
  return characterSprite(look, 'front', 'stand', 'stand', false, false);
}

// ── The office cat ─────────────────────────────────────────────────────────

const CAT = {
  walkA: ['.......o.o', 'o......ooo', '.o.....oeo', '.oooooooo.', '.owowowoo.', '..o.o..o.o'],
  walkB: ['.......o.o', 'o......ooo', '.o.....oeo', '.oooooooo.', '.owowowoo.', '.o..o.o..o'],
  sit: ['.....o.o..', '.....ooo..', '.....oeo..', 'o...oooo..', '.o.ooowo..', '..oooooo..'],
  sleep: ['..........', '..........', '..........', '.oooooo...', 'oowowoooo.', '.oooooooo.'],
};
const CAT_COLORS = { o: '#e39b4b', w: '#b86f2c', e: '#2b2b33' };
const catCache = new Map();

export function drawCat(g, { x, y, pose, frame, dir }) {
  const name = pose === 'walk' ? (frame ? 'walkA' : 'walkB') : pose;
  const flip = dir === 'left';
  const key = `${name}|${flip}`;
  let img = catCache.get(key);
  if (!img) {
    img = makeSprite(10, 6, (R) => {
      CAT[name].forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch !== '.') R(flip ? 9 - rx : rx, ry, 1, 1, CAT_COLORS[ch]);
        }
      });
    });
    catCache.set(key, img);
  }
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(Math.round(x) - 4, Math.round(y) - 1, 8, 2);
  g.drawImage(img, Math.round(x) - 5, Math.round(y) - 6);
}
