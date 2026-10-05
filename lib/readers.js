// What the harnesses' readers share when they add a transcript's lines to a
// usage-index record (claude-usage.js, codex-usage.js, pi-usage.js): a session's
// first line, its requests, tool calls and the lines they change, and when a
// request had to write the cache again. The record itself is made in usage-index.js.

import { projectName } from './agents.js';

const CACHE_EXPIRY_MS = 5 * 60_000; // the default cache lifetime

/** How many lines a piece of text is, for the lines an edit adds or removes. */
export function lineCount(text) {
  if (!text) return 0;
  const s = String(text);
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}

/**
 * A session's first line: its id, the session it belongs to (its parent's, for a
 * subagent), its folder and project, and when a forked one's own work starts.
 */
export function startSession(f, { source, id, nativeId, parentId, cwd, forkStart }) {
  f.id = id;
  f.nativeId = nativeId;
  f.source = source;
  f.parentId = parentId;
  f.sub = !!parentId;
  f.session = parentId || id;
  f.cwd = cwd || f.cwd;
  f.project = projectName(f.cwd);
  f.dirName = f.cwd?.replace(/[^a-zA-Z0-9]/g, '-');
  f.forkStart = forkStart;
}

/**
 * One request: when, what it cost (0 when its price isn't known), its tokens,
 * its model, and `detail`, its cache use and context size. The index keeps it as
 * [t, cost, tokens, model, record, detail].
 */
export function addEvent(f, t, cost, tokens, model, detail) {
  f.events.push([t, cost || 0, tokens, model || 'unknown', f, detail]);
}

/** Lines a call changed in one file, kept as [t, added, removed, record, path]. */
export function addEdit(f, t, added, removed, path) {
  f.edits.push([t, added, removed, f, path]);
}

/**
 * Whether a request rebuilt the cache: most of its prompt had to be written to
 * the cache again. That happens when a session starts ('start'), after a pause
 * long enough for the cache to expire ('pause'), or after a compaction ('other').
 * Notes the request's time on the record, for the next one.
 */
export function cacheRebuild(f, t, { write, read, fresh }) {
  const rebuild =
    write > 20_000 && write > (write + read + fresh) / 2
      ? !f.lastT
        ? 'start'
        : t - f.lastT > CACHE_EXPIRY_MS
          ? 'pause'
          : 'other'
      : null;
  f.lastT = t;
  return rebuild;
}

/**
 * A tool call, kept on the record by its id until its result comes: pending
 * till then, unless `call` says otherwise. `edits` are the changes it would make
 * to files, as { path, added, removed }, which only count once it went through
 * (settleCall). A call counts once: null when one with this id is kept already.
 */
export function startCall(f, id, call) {
  if (f.callById.has(id)) return null;
  const kept = { status: 'pending', reason: null, rec: f, ...call };
  f.callById.set(id, kept);
  f.calls.push(kept);
  return kept;
}

/**
 * How a tool call ended ('ok', 'error' or 'denied', and why), and the files it
 * changed if they went through (`applied`): unless it failed, by default, though
 * a script can fail after its patch went in.
 */
export function settleCall(f, call, status, reason = null, applied = status === 'ok') {
  call.status = status;
  call.reason = reason;
  if (applied) for (const e of call.edits || []) addEdit(f, call.t, e.added, e.removed, e.path);
  delete call.edits;
}
