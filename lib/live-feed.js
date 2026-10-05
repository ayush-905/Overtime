// @ts-check
// Live updates (/events): only what changed.
//
// A page gets everything when it connects, then only the parts that changed
// since the last update it had, as [path, value] pairs; web/shared/live.js puts
// them back together. The analytics are split down to each card's data, so a
// new reading of one doesn't resend the rest, and the agents and the feed go
// item by item, so an agent that's idle isn't sent again because another one is
// working, and the feed sends only what's new. Each page keeps its own record
// of what it has, so one connecting later never misses a change.

const LISTS = ['agents', 'feed']; // sent item by item, by each item's id

// Costs and ratios need no more than four decimals, which trims the analytics by a good share.
const round = (_key, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);
const analyticsCache = new WeakMap(); // an analytics object → its parts, worked out once
const snapCache = new WeakMap(); // a snapshot → its parts, worked out once for every page

/** The analytics as [path, JSON] parts: each view's insights card by card, and its other sections whole. */
export function analyticsParts(analytics) {
  if (!analytics) return [[['analytics'], 'null']];
  let parts = analyticsCache.get(analytics);
  if (!parts) {
    parts = [];
    for (const [scope, view] of Object.entries(analytics)) {
      for (const [section, value] of Object.entries(view || {})) {
        if (section === 'insights' && value)
          for (const [key, x] of Object.entries(value))
            parts.push([['analytics', scope, 'insights', key], JSON.stringify(x, round) ?? 'null']);
        else parts.push([['analytics', scope, section], JSON.stringify(value, round) ?? 'null']);
      }
    }
    analyticsCache.set(analytics, parts);
  }
  return parts;
}

/** A snapshot as JSON pieces: [path, JSON] for each part, and each list as [name, ids, id → JSON]. */
export function snapshotParts(snap) {
  let cached = snapCache.get(snap);
  if (!cached) {
    const parts = [];
    const lists = [];
    for (const [key, value] of Object.entries(snap)) {
      if (key === 'now' || key === 'analytics') continue;
      if (LISTS.includes(key) && Array.isArray(value))
        lists.push([key, value.map((x) => x.id), new Map(value.map((x) => [x.id, JSON.stringify(x)]))]);
      else parts.push([[key], JSON.stringify(value) ?? 'null']);
    }
    cached = { parts: [...parts, ...analyticsParts(snap.analytics)], lists };
    snapCache.set(snap, cached);
  }
  return cached;
}

/** What a page that has just connected has: nothing yet. */
export const emptyPage = () => ({ parts: new Map(), lists: new Map() });

/**
 * The message that brings a page up to `snap`, from what it has (`has`, as
 * emptyPage() makes it), which is updated to match.
 */
export function patchFor(has, snap) {
  const { parts, lists } = snapshotParts(snap);
  const changes = [];
  for (const [path, json] of parts) {
    const key = path.join('.');
    if (has.parts.get(key) === json) continue;
    // This replaces whatever the page had at, under or above this path.
    for (const k of has.parts.keys()) if (k.startsWith(`${key}.`) || key.startsWith(`${k}.`)) has.parts.delete(k);
    has.parts.set(key, json);
    changes.push(`[${JSON.stringify(path)},${json}]`);
  }
  const items = [];
  for (const [name, ids, byId] of lists) {
    const before = has.lists.get(name);
    const order = JSON.stringify(ids);
    const changed = [];
    for (const [id, json] of byId) if (before?.items.get(id) !== json) changed.push(json);
    if (before?.order === order && !changed.length) continue;
    items.push(`[${JSON.stringify([name])},${before?.order === order ? 'null' : order},[${changed.join(',')}]]`);
    has.lists.set(name, { order, items: byId });
  }
  return `data: {"now":${snap.now},"patch":1,"changes":[${changes.join(',')}]${items.length ? `,"items":[${items.join(',')}]` : ''}}\n\n`;
}

/** The pages following the live feed, each sent what changed since its last update. */
export function createLiveFeed() {
  const pages = new Map(); // each open page's response → what it has
  const send = (res, snap) => {
    const has = pages.get(res);
    if (has) res.write(patchFor(has, snap));
  };
  return {
    /** A page that's connected: its first update has everything. */
    open(res) {
      pages.set(res, emptyPage());
    },
    close(res) {
      pages.delete(res);
    },
    get size() {
      return pages.size;
    },
    send,
    sendAll(snap) {
      for (const res of pages.keys()) send(res, snap);
    },
  };
}
