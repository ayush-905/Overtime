// pi transcripts, read two ways: `applyPiRecord` builds the usage index's
// history (cost, messages, tool calls, edits, working time), and the helpers
// below are shared with the live watcher in pi.js. pi files each session as
// <sessions>/--<folder>--/<time>_<id>.jsonl. Its entries form a tree, so going
// back with /tree starts a branch in the same file; every entry is still work
// that happened, so all of them count, whichever branch is current. Ids are the
// session's own, prefixed `pi-`.

import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contextWindow, priceTokens } from './pricing.js';
import { notePrompt } from './titles.js';
import { projectName } from './agents.js';
import { failReason, shellInfo } from './tool-failures.js';

const CACHE_EXPIRY_MS = 5 * 60_000; // the default cache lifetime
// How a reply ends its turn; `toolUse` means tools run and the agent carries on.
export const PI_TURN_ENDS = new Set(['stop', 'length', 'error', 'aborted']);

export const piId = (id) => (id?.startsWith('pi-') ? id : `pi-${id}`);

/** The session id in a transcript's name, `<time>_<id>.jsonl`. */
export const piFileId = (name) => name.match(/^[^_]+_(.+)\.jsonl$/)?.[1] || null;

const expand = (p, home) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

/** Pi's own folder: PI_CODING_AGENT_DIR, else ~/.pi/agent. */
export const piAgentDir = (env = process.env, home = os.homedir()) => path.resolve(expand(env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'), home));

/**
 * Where pi keeps its sessions, found the way pi finds it: PI_CODING_AGENT_SESSION_DIR,
 * else the `sessionDir` in its settings, else `sessions` in its folder.
 */
export function piSessionsDir(env = process.env, home = os.homedir()) {
  if (env.PI_CODING_AGENT_SESSION_DIR) return path.resolve(expand(env.PI_CODING_AGENT_SESSION_DIR, home));
  const agentDir = piAgentDir(env, home);
  try {
    const dir = JSON.parse(readFileSync(path.join(agentDir, 'settings.json'), 'utf8')).sessionDir;
    if (typeof dir === 'string' && path.isAbsolute(expand(dir.trim(), home))) return path.resolve(expand(dir.trim(), home));
  } catch {}
  return path.join(agentDir, 'sessions');
}

/** A message's text: its content as a string, or its text blocks. */
export function piText(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');
}

function lineCount(text) {
  if (!text) return 0;
  const s = String(text);
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}

/** A tool's path, made absolute against the session's folder (pi's tools take relative ones). */
export const piPath = (p, cwd) => (typeof p === 'string' && p ? path.resolve(cwd || '/', p) : null);

/** The lines an edit or write call adds and removes, as { path, added, removed }; null for other tools. */
export function piEdit(name, args, cwd) {
  const file = piPath(args?.path, cwd);
  if (!file) return null;
  if (name === 'write') return { path: file, added: lineCount(args.content), removed: 0 };
  if (name !== 'edit') return null;
  // Older pi took one oldText/newText pair rather than a list.
  const edits = Array.isArray(args.edits) ? args.edits : typeof args.oldText === 'string' ? [args] : [];
  return {
    path: file,
    added: edits.reduce((n, e) => n + lineCount(e?.newText), 0),
    removed: edits.reduce((n, e) => n + lineCount(e?.oldText), 0),
  };
}

/**
 * One request's usage: tokens split the way they're billed, and what pi says
 * they cost. pi prices every request itself, at the provider's list prices, even
 * on a subscription, and knows models Overtime's price list doesn't.
 */
export function piUsage(model, u = {}) {
  const fresh = Math.max(0, u.input || 0);
  const read = Math.max(0, u.cacheRead || 0);
  const write = Math.max(0, u.cacheWrite || 0);
  const write1h = Math.min(write, Math.max(0, u.cacheWrite1h || 0));
  const output = Math.max(0, u.output || 0);
  const c = u.cost || {};
  const cost = Number.isFinite(c.total) ? c.total : null;
  const parts = cost == null ? null : { output: c.output || 0, cacheRead: c.cacheRead || 0, cacheWrite: c.cacheWrite || 0, input: c.input || 0, search: 0 };
  // What the cached tokens would have cost as fresh input: at the rate pi charged for fresh input, else the price list's.
  const plain = fresh > 0 && c.input > 0
    ? ((read + write) * c.input) / fresh
    : priceTokens(model, { fresh, cacheRead: read, write5m: write - write1h, write1h, output })?.plainCached ?? null;
  return {
    fresh, read, write, write1h, output,
    tokens: fresh + read + write + output,
    cost,
    parts,
    saved: parts && plain != null ? plain - parts.cacheRead - parts.cacheWrite : 0,
    context: fresh + read + write + output,
  };
}

// The context windows pi works with, by "provider/model". Pi doesn't write a
// session's window down, but it compacts by these: its catalog as last fetched
// from pi.dev (models-store.json), under your own models and overrides
// (models.json), both in its folder. Only the windows are read from them.
const windows = { stamp: '', byModel: new Map() };

/** Read pi's model windows again if either file changed; says whether they did. */
export async function refreshPiWindows(agentDir = piAgentDir()) {
  const files = ['models-store.json', 'models.json'].map((name) => path.join(agentDir, name));
  const stats = await Promise.all(files.map((file) => fsp.stat(file).catch(() => null)));
  const stamp = [agentDir, ...stats.map((st) => (st ? `${st.size}:${st.mtimeMs}` : '-'))].join('|');
  if (stamp === windows.stamp) return false;
  const [store, own] = await Promise.all(files.map((file) => fsp.readFile(file, 'utf8').then(JSON.parse).catch(() => null)));
  const byModel = new Map();
  const put = (provider, id, window) => {
    if (typeof id === 'string' && Number.isFinite(window) && window > 0) byModel.set(`${provider}/${id}`, window);
  };
  for (const [provider, entry] of Object.entries(store || {})) for (const m of entry?.models || []) put(provider, m?.id, m?.contextWindow);
  for (const [provider, p] of Object.entries(own?.providers || {})) {
    for (const m of p?.models || []) put(provider, m?.id, m?.contextWindow);
    for (const [id, o] of Object.entries(p?.modelOverrides || {})) put(provider, id, o?.contextWindow);
  }
  Object.assign(windows, { stamp, byModel });
  return true;
}

/** How much a model can hold: as pi has it for that provider, else as Overtime's price list does. */
export function piWindow(provider, model, used) {
  return windows.byModel.get(`${provider}/${model}`) || contextWindow(model, used);
}

/** What a tool call was about: the file it read or changed, the command it ran, the search. */
function callSubject(name, args = {}, cwd) {
  const text = (v, n) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : null);
  const file = ['read', 'edit', 'write'].includes(name) ? piPath(args.path, cwd) : null;
  const what = name === 'bash' || name === 'powershell' ? text(args.command, 200) : name === 'grep' || name === 'find' ? text(args.pattern, 100) : null;
  return { file, what };
}

/** Why a tool call failed, from its result: null when it didn't really fail (grep finding nothing), '' when unknown. */
function failure(call, m) {
  const text = piText(m.content);
  const exit = text.match(/Command exited with code (\d+)\s*$/);
  if (exit) return failReason(call, `Exit code ${exit[1]}\n${text}`);
  return text.trim().split('\n')[0].trim().slice(0, 80);
}

function addUsage(f, t, provider, model, usage) {
  const d = piUsage(model, usage);
  if (!d.tokens && !d.cost) return;
  // A rebuild: most of the prompt had to be written to the cache again (a new
  // session, a compaction, or a pause long enough for the cache to expire).
  const rebuild = d.write > 20_000 && d.write > (d.write + d.read + d.fresh) / 2
    ? (!f.lastT ? 'start' : t - f.lastT > CACHE_EXPIRY_MS ? 'pause' : 'other')
    : null;
  f.lastT = t;
  const detail = { read: d.read, write: d.write, fresh: d.fresh, output: d.output, saved: d.saved, writeCost: d.parts?.cacheWrite || 0, context: d.context, rebuild, costKnown: d.cost != null, parts: d.parts };
  f.events.push([t, d.cost || 0, d.tokens, model || 'unknown', f, detail]);
  f.contextWindow = piWindow(provider, model, d.context);
}

/** One line of a pi transcript, into the index record `f`; `addText` keeps a message's text for search. */
export function applyPiRecord(f, ev, addText) {
  if (ev.type === 'session') {
    f.id = piId(ev.id);
    f.nativeId = ev.id;
    f.source = 'pi';
    f.parentId = null;
    f.sub = false;
    f.session = f.id;
    f.cwd = ev.cwd || f.cwd;
    f.project = projectName(f.cwd);
    f.dirName = f.cwd?.replace(/[^a-zA-Z0-9]/g, '-');
    // /fork and /clone start a session with a copy of the conversation so far; only what follows is its own.
    f.forkStart = ev.parentSession ? Date.parse(ev.timestamp) : null;
    return;
  }
  const t = Date.parse(ev.timestamp);
  if (!Number.isFinite(t)) return;
  // Each entry once, however often it's read.
  if (ev.id) {
    if (f.seen.has(ev.id)) return;
    f.seen.add(ev.id);
  }
  if (ev.type === 'session_info') {
    f.title = typeof ev.name === 'string' && ev.name.trim() ? ev.name.trim() : null;
    return;
  }
  if (ev.type === 'model_change') {
    f.model = ev.modelId || f.model;
    f.provider = ev.provider || f.provider;
    return;
  }
  if (f.forkStart && t < f.forkStart) return;
  if (ev.type === 'compaction') {
    f.compactions.push({ t, trigger: 'unknown', before: ev.tokensBefore || 0, rec: f });
    if (ev.usage) addUsage(f, t, f.provider, f.model, ev.usage);
    return;
  }
  // Summaries of an abandoned branch, and other model work outside the conversation.
  if (ev.type === 'branch_summary' || ev.type === 'usage') {
    if (ev.usage) addUsage(f, t, ev.provider || f.provider, ev.model || f.model, ev.usage);
    return;
  }
  const m = ev.type === 'message' ? ev.message : null;
  if (!m) return;
  if (m.role === 'user') {
    const full = piText(m.content).trim();
    if (!full) return;
    const text = full.replace(/\s+/g, ' ');
    f.prompts.push([t, f, 'human', text.slice(0, 90)]);
    notePrompt(f, text.slice(0, 70));
    if (f.keepText) addText?.(f, t, 'you', full, ev.id);
    // A turn runs from your message to the reply that ends it.
    f.activeTurn = { start: t, end: t };
    f.work.push(f.activeTurn);
  } else if (m.role === 'assistant') {
    f.model = m.model || f.model;
    f.provider = m.provider || f.provider;
    const blocks = Array.isArray(m.content) ? m.content : [];
    blocks.forEach((b, i) => {
      if (b?.type === 'text' && b.text?.trim() && f.keepText) addText?.(f, t, 'agent', b.text, `${ev.id}:${i}`);
      if (b?.type !== 'toolCall' || !b.id || f.callById.has(b.id)) return;
      const args = b.arguments || {};
      const shell = b.name === 'bash' ? shellInfo(args.command) : {};
      const { file, what } = callSubject(b.name, args, f.cwd);
      const call = { t, name: b.name, program: shell.program || null, simple: !!shell.simple, status: 'pending', reason: null, rec: f, file, what, edit: piEdit(b.name, args, f.cwd) };
      f.callById.set(b.id, call);
      f.calls.push(call);
    });
    if (m.usage) addUsage(f, t, f.provider, f.model, m.usage);
    if (f.activeTurn) f.activeTurn.end = t;
    if (m.stopReason === 'aborted') f.prompts.push([t, f, 'interrupt', null]);
    if (PI_TURN_ENDS.has(m.stopReason)) {
      if (f.activeTurn) f.activeTurn.completed = true;
      f.activeTurn = null;
    }
  } else if (m.role === 'toolResult') {
    const call = f.callById.get(m.toolCallId);
    if (call?.status === 'pending') {
      const reason = m.isError ? failure(call, m) : null;
      call.status = m.isError && reason !== null ? 'error' : 'ok';
      call.reason = call.status === 'error' ? reason || null : null;
      // An edit only changed the file if it went through.
      if (call.status === 'ok' && call.edit && (call.edit.added || call.edit.removed)) f.edits.push([call.t, call.edit.added, call.edit.removed, f, call.edit.path]);
      delete call.edit;
    }
    // A tool that did model work of its own reports its usage with its result.
    if (m.usage) addUsage(f, t, f.provider, f.model, m.usage);
    if (f.activeTurn) f.activeTurn.end = t;
  }
}
