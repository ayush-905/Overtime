// Live updates from the server arrive as changes: the first message after a page
// connects has everything, and each one after it only what changed since, as
// [path, value] pairs, with the analytics split down to each card's data. The
// agents and the feed come item by item, by id: [path, ids, items] gives the
// list's order (null when it's the same as before) and only the items that are
// new or changed. This puts them back together into the whole snapshot the pages
// work with. Only what changed gets a new object, so unchanged parts keep their
// identity, and a message that changes nothing (the server's heartbeat) gives
// back the same snapshot, with only its `now` brought up to date.

/** Set `value` at `path` in a copy of `root`, copying only the objects along the way. */
function setIn(root, path, value) {
  const top = { ...(root || {}) };
  let at = top;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    at[key] = { ...(at[key] && typeof at[key] === 'object' ? at[key] : {}) };
    at = at[key];
  }
  at[path[path.length - 1]] = value;
  return top;
}

const getIn = (root, path) => path.reduce((at, key) => at?.[key], root);

/** A function that takes each message and returns the whole snapshot so far. The demo sends whole snapshots, which pass straight through. */
export function createMerger() {
  let whole = null;
  return (msg) => {
    if (!msg.patch) {
      // A server from before these changes leaves out analytics that haven't changed.
      whole = 'analytics' in msg || !whole ? msg : { ...msg, analytics: whole.analytics };
      return whole;
    }
    if (whole && !msg.changes.length && !msg.items?.length) {
      whole.now = msg.now;
      return whole;
    }
    let next = { ...(whole || {}), now: msg.now };
    for (const [path, value] of msg.changes) next = setIn(next, path, value);
    for (const [path, ids, items] of msg.items || []) {
      const before = getIn(next, path) || [];
      const byId = new Map(before.map((x) => [x.id, x]));
      for (const x of items) byId.set(x.id, x);
      next = setIn(next, path, (ids || before.map((x) => x.id)).map((id) => byId.get(id)));
    }
    whole = next;
    return whole;
  };
}
