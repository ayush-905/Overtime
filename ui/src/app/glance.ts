// In the Mac app, the page in the menu bar's popover tells the app what to show in
// the menu bar: an image of each provider's logo with what's left of its 5-hour
// window over its weekly one, with a dot before them while an agent needs you,
// and the figures for the other ways it can show (the window closest to its
// limit, today's cost). The app puts the needs count on the Dock too. Sent when
// it changes, and every 5 seconds, since a window can reset with no new data. It
// follows the stores rather than drawing anything, so the page isn't drawn again
// for it.
// The popover's page is hidden most of the time, so the logos are decoded with
// createImageBitmap (an <img> never finishes decoding there) and nothing waits
// on an animation frame.

import { useEffect } from 'react';
import { useLive, WORKING } from '@/data/live';
import { useLimits } from '@/data/limits';
import { bridge, inPopover, type Glance } from '@/data/desktop';
import { env } from '@/lib/env';
import { money } from '@/lib/format';
import { providerName, quotaItems, type LimitsInput, type QuotaItem } from '@/lib/limits';
import claudeMark from '@/assets/claude.svg';
import codexMark from '@/assets/codex.png';

const S = 2; // drawn at twice the size, for Retina
const H = 22; // points: as tall as a menu bar icon can be
const GLYPH = 16; // points, each provider's logo
const DOT = 5; // points across, the dot while an agent needs you
const GAP = { dot: 4, glyph: 3, block: 8 }; // points: after the dot, after a logo, between providers

let glyphs: Record<'claude' | 'codex', HTMLCanvasElement> | null = null;

async function loadGlyphs() {
  const box = GLYPH * S;
  const canvas = () => Object.assign(document.createElement('canvas'), { width: box, height: box });
  // Claude's mark: the SVG's one path, filled. (The build may inline the SVG with its quotes as ', so either.)
  const claude = canvas();
  const svg = await (await fetch(claudeMark)).text();
  const ctx = claude.getContext('2d')!;
  ctx.scale(box / 248, box / 248);
  ctx.fill(new Path2D(svg.match(/\sd=["']([^"']+)["']/)![1]));
  // Codex's: the dark knot of its app icon, without the light square round it, cropped to the knot.
  const img = await createImageBitmap(await (await fetch(codexMark)).blob());
  const src = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(img, 0, 0);
  const px = sctx.getImageData(0, 0, src.width, src.height);
  let x0 = src.width,
    y0 = src.height,
    x1 = 0,
    y1 = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    const lum = (0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2]) / 255;
    const a = (px.data[i + 3] / 255) * Math.max(0, Math.min(1, (0.72 - lum) / 0.45));
    px.data[i] = px.data[i + 1] = px.data[i + 2] = 0;
    px.data[i + 3] = Math.round(a * 255);
    if (a > 0.2) {
      const p = i / 4;
      const x = p % src.width;
      const y = Math.floor(p / src.width);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  sctx.putImageData(px, 0, 0);
  // Its lines are finer than Claude's mark; a pixel wider each way, they weigh the same in the menu bar.
  const bold = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
  const bctx = bold.getContext('2d')!;
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    bctx.drawImage(src, dx, dy);
  const codex = canvas();
  const side = Math.max(x1 - x0, y1 - y0) + 3;
  codex
    .getContext('2d')!
    .drawImage(
      bold,
      x0 - 1 - (side - (x1 - x0 + 3)) / 2,
      y0 - 1 - (side - (y1 - y0 + 3)) / 2,
      side,
      side,
      0,
      0,
      box,
      box,
    );
  glyphs = { claude, codex };
}

/** Each provider with its 5-hour and weekly figures, as the menu bar shows them. */
function limitLines(items: QuotaItem[]) {
  const byProvider = new Map<'claude' | 'codex', QuotaItem[]>();
  for (const w of items) byProvider.set(w.provider, [...(byProvider.get(w.provider) || []), w]);
  const left = (w?: QuotaItem) =>
    !w || (w.usedPercent == null && !w.limited)
      ? '–'
      : w.limited
        ? '0%'
        : `${Math.max(0, Math.round(100 - w.usedPercent!))}%`;
  return [...byProvider].map(([provider, windows]) => ({
    provider,
    lines: [
      left(windows.find((w) => /hour/i.test(w.label)) || windows[0]),
      left(windows.find((w) => /week/i.test(w.label)) || windows[1]),
    ],
  }));
}

/** Each provider's logo with its two figures stacked, after a dot if an agent needs you. A PNG, black on clear. */
function drawMenuBar(providers: ReturnType<typeof limitLines>, needs: boolean) {
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d')!;
  const font = `600 ${8.5 * S}px system-ui, -apple-system, sans-serif`;
  ctx.font = font;
  const blocks = providers.map((p) => ({
    ...p,
    width: Math.ceil(Math.max(...p.lines.map((t) => ctx.measureText(t).width))),
  }));
  const lead = needs ? DOT + GAP.dot : 0;
  const width =
    (lead + blocks.reduce((sum, _b, i) => sum + (i ? GAP.block : 0) + GLYPH + GAP.glyph, 0)) * S +
    blocks.reduce((sum, b) => sum + b.width, 0);
  canvas.width = Math.ceil(width);
  canvas.height = H * S;
  ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  if (needs) {
    ctx.beginPath();
    ctx.arc((DOT / 2) * S, (H / 2) * S, (DOT / 2) * S, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = font;
  let x = lead * S;
  blocks.forEach((b, i) => {
    if (i) x += GAP.block * S;
    if (glyphs?.[b.provider]) ctx.drawImage(glyphs[b.provider], x, ((H - GLYPH) / 2) * S);
    x += (GLYPH + GAP.glyph) * S;
    ctx.fillText(b.lines[0], x, 9.6 * S);
    ctx.fillText(b.lines[1], x, 19.6 * S);
    x += b.width;
  });
  return canvas.toDataURL('image/png');
}

let sent = '';
let at = 0; // the time of the snapshot it last looked at, since a heartbeat moves only that
let drawn = { key: '', image: '' };

/** Tell the app what the menu bar shows, when that's changed. For every provider, whatever the popover shows. */
export function sendGlance() {
  if (!inPopover || !bridge) return;
  const snap = useLive.getState().snap;
  if (!snap) return;
  at = snap.now;
  const l = useLimits.getState();
  const inp: LimitsInput = {
    now: Date.now() - env.timeOffset,
    limits: snap.limits || null,
    exactOn: l.exactOn,
    exact: l.exact,
    codexRecorded: snap.codexLimits || null,
    codexExactOn: l.codexExactOn,
    codexExact: l.codexExact,
  };
  const items = quotaItems(inp, 'all');
  const windows = items
    .filter((w) => w.limited || w.usedPercent != null)
    .map((w) => ({ ...w, left: w.limited ? 0 : Math.max(0, Math.round(100 - w.usedPercent!)) }));
  const tightest = [...windows].sort((a, b) => a.left - b.left)[0];
  const mains = snap.agents.filter((a) => a.kind === 'main');
  const cost = snap.analytics?.all?.spend?.today?.cost;
  const needs = mains.filter((a) => a.needsYou).length;
  // The image is drawn again only when what's in it changes.
  const providers = limitLines(items);
  const key = JSON.stringify([providers, needs > 0, !!glyphs]);
  if (key !== drawn.key) drawn = { key, image: providers.length ? drawMenuBar(providers, needs > 0) : '' };
  const glance: Glance = {
    left: tightest ? tightest.left : null,
    limited: !!tightest?.limited,
    windows: windows.map(
      (w) => `${providerName(w.provider)} ${w.label.toLowerCase()}: ${w.limited ? 'limit reached' : `${w.left}% left`}`,
    ),
    cost: cost == null ? '' : money(cost),
    needs,
    working: mains.filter((a) => !a.needsYou && WORKING.includes(a.status as string)).length,
    image: drawn.image,
  };
  const json = JSON.stringify(glance);
  if (json === sent) return;
  sent = json;
  bridge.glance(glance);
}

/** The popover keeps the menu bar up to date, seen or not: with each message from the server, each new exact reading, and every 5 seconds. */
export function useGlance() {
  useEffect(() => {
    if (!inPopover) return;
    loadGlyphs().then(sendGlance, (error) =>
      console.error("Couldn't load the providers' logos for the menu bar", error),
    );
    sendGlance();
    const stopLive = useLive.subscribe((s, before) => {
      if (s.snap !== before.snap || s.snap?.now !== at) sendGlance();
    });
    const stopLimits = useLimits.subscribe((s, before) => {
      if (s.exact !== before.exact || s.codexExact !== before.codexExact) sendGlance();
    });
    const t = setInterval(sendGlance, 5000);
    return () => {
      stopLive();
      stopLimits();
      clearInterval(t);
    };
  }, []);
}
