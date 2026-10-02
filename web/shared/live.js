// Live updates from the server arrive as changes: the first message after a page
// connects has everything, and each one after it only what changed since, as
// [path, value] pairs, with the analytics split down to each card's data. This
// puts them back together into the whole snapshot the pages work with. Only
// what changed gets a new object, so unchanged parts keep their identity.

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

/** A function that takes each message and returns the whole snapshot so far. The demo sends whole snapshots, which pass straight through. */
export function createMerger() {
  let whole = null;
  return (msg) => {
    if (!msg.patch) {
      // A server from before these changes leaves out analytics that haven't changed.
      whole = 'analytics' in msg || !whole ? msg : { ...msg, analytics: whole.analytics };
      return whole;
    }
    let next = { ...(whole || {}), now: msg.now };
    for (const [path, value] of msg.changes) next = setIn(next, path, value);
    whole = next;
    return whole;
  };
}
