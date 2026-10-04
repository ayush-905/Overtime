// Every harness Overtime reads, in the order they're shown. Each is a module
// that says, for one agent tool:
//
//   id, name, prefix   its id ('pi'), what to call it, and what goes before its
//                      session ids ('pi-') so they never collide with another's
//   nativeId           the shape of its own session ids
//   folder(env)        where its transcripts are
//   open({ dir })      reading them: transcripts(since) lists the files changed
//                      since then; live(feed, agent, event) follows one as it
//                      grows; indexLine(record, line) adds a line to the 31-day
//                      history; refresh() and titleOf(id) if it keeps more beside
//                      them; meta(file) for its subagents'
//   resume             the command that picks a session back up, and its app's link
//   process            how to spot it running: its executable, or script under node
//   commands           where its slash commands go, for a prompt you repeat
//   tools              its tools that read and write files and run commands
//
// Adding one: write its reader (like pi.js and pi-usage.js), a module like the
// ones here, list it below, and give it its name, colour and mark in
// ui/src/lib/sources.ts.

import { promises as fsp } from 'node:fs';
import claude from './claude.js';
import codex from './codex.js';
import pi from './pi.js';

export const HARNESSES = [claude, codex, pi];
export const SOURCES = HARNESSES.map((h) => h.id);

const BY_ID = new Map(HARNESSES.map((h) => [h.id, h]));

/** The harness a source id names; an unknown one is treated as Claude Code. */
export const harness = (id) => BY_ID.get(id) || claude;

/**
 * Each harness ready to read: with its folder from `dirs` (tests, and only the
 * ones given), else from the environment. `options` go to every harness's open().
 */
export function openHarnesses({ dirs, env = process.env, ...options } = {}) {
  const open = [];
  for (const h of HARNESSES) {
    const dir = dirs ? dirs[h.id] : h.folder(env);
    if (dir) open.push({ ...h, ...h.open({ dir, env, ...options }) });
  }
  return open;
}

/** The folders being followed, and the harnesses with one on this Mac (Claude Code always counts). */
export async function onThisMac(open) {
  const here = [];
  for (const h of open) if (h.id === 'claude' || (await fsp.stat(h.dir).then((st) => st.isDirectory(), () => false))) here.push(h);
  return { folders: here.map((h) => h.dir), sources: here.map((h) => h.id) };
}

/** Whether `id` is a session id the routes take: one harness's prefix and its own id. */
export const isSessionId = (id) => HARNESSES.some((h) => id.startsWith(h.prefix) && h.nativeId.test(id.slice(h.prefix.length)));

/** A session's id in its own transcripts, without Overtime's prefix. */
export function nativeIdOf(id) {
  const h = HARNESSES.find((x) => x.prefix && String(id).startsWith(x.prefix));
  return h ? String(id).slice(h.prefix.length) : String(id);
}
