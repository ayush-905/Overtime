// Finds transcripts from every source and follows them as they grow.

import { promises as fsp } from 'node:fs';
import { newAgent, oneLine } from './agents.js';
import { onThisMac, openHarnesses } from './harnesses/index.js';

const RECENT_MS = 6 * 60 * 60 * 1000;
const MAX_INITIAL_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024; // read big transcripts in pieces so memory stays small

/** Follow anything touched today, or in the last 6 hours if that reaches further back. */
export function windowStart(now = Date.now()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.min(midnight.getTime(), now - RECENT_MS);
}

/**
 * `harnesses` are the open harnesses to follow (openHarnesses()); without them,
 * the ones whose folders are given, as tests do.
 */
export function createWatcher({ harnesses, claudeDir, codexDir, piDir, piHome, feed }) {
  const open = harnesses || openHarnesses({ dirs: { claude: claudeDir, codex: codexDir, pi: piDir }, piHome });
  const bySource = new Map(open.map((h) => [h.id, h]));
  const files = new Map(); // path → tail state
  const agents = new Map(); // id → agent
  // Files that were read and had nothing recent, by the mtime they had then. The
  // Claude app appends bookkeeping lines with no timestamp to old sessions, which
  // bumps their mtime; without this they'd be read in full on every discovery.
  const stale = new Map();
  let dirty = true;

  async function readMeta(f) {
    const read = bySource.get(f.agent.source)?.meta;
    if (!read) {
      f.agent.metaLoaded = true;
      return;
    }
    try {
      const meta = await read(f.file);
      f.agent.description = meta.description ? oneLine(meta.description, 70) : null;
      f.agent.agentType = meta.agentType || null;
      f.agent.metaLoaded = true;
      dirty = true;
    } catch {
      // The meta file can land a moment after the transcript; retried on the next tick.
    }
  }

  async function readNew(f, size) {
    if (size < f.offset) {
      f.offset = 0;
      f.leftover = null;
    }
    if (size === f.offset) return;
    const fh = await fsp.open(f.file, 'r');
    const apply = bySource.get(f.agent.source).live;
    try {
      while (f.offset < size) {
        const len = Math.min(CHUNK_BYTES, size - f.offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, f.offset);
        if (!bytesRead) break;
        f.offset += bytesRead;
        let data = f.leftover ? Buffer.concat([f.leftover, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        if (f.skipPartial) {
          const nl = data.indexOf(10);
          data = nl === -1 ? Buffer.alloc(0) : data.subarray(nl + 1);
          f.skipPartial = false;
        }
        // Lines end at a newline byte, which never sits inside a multi-byte character.
        const last = data.lastIndexOf(10);
        if (last === -1) {
          f.leftover = Buffer.from(data);
          continue;
        }
        f.leftover = Buffer.from(data.subarray(last + 1));
        for (const line of data.subarray(0, last).toString('utf8').split('\n')) {
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          apply(feed, f.agent, ev);
        }
        dirty = true;
      }
    } finally {
      await fh.close();
    }
  }

  async function track(h, { file, st, id, sub, parentId }) {
    if (files.has(file) || stale.get(file) === st.mtimeMs) return;
    stale.delete(file);
    const agent = agents.get(id) || newAgent(id, { kind: sub ? 'sub' : 'main', parentId, source: h.id, file, priced: h.livePriced !== false });
    // Read the whole transcript so token and cost totals cover the full session.
    const start = Math.max(0, st.size - MAX_INITIAL_BYTES);
    const f = { file, agent, offset: start, leftover: null, skipPartial: start > 0, mtimeMs: st.mtimeMs };
    files.set(file, f);
    agents.set(id, agent);
    if (sub) await readMeta(f);
    await readNew(f, st.size);
  }

  async function discover() {
    const cutoff = windowStart();
    for (const h of open) {
      await h.refresh?.();
      for await (const entry of h.transcripts(cutoff)) await track(h, entry);
      // A harness that keeps its chats' names apart from their transcripts (Codex).
      if (!h.titleOf) continue;
      for (const a of agents.values()) {
        if (a.source !== h.id || a.kind !== 'main') continue;
        const name = h.titleOf(a.nativeId);
        if (a.title !== name) { a.title = name; dirty = true; }
      }
    }
    for (const [file, f] of files) {
      if (f.agent.lastActivity < cutoff) {
        files.delete(file);
        agents.delete(f.agent.id);
        stale.set(file, f.mtimeMs);
      }
    }
    if (stale.size > 5000) stale.clear(); // a safety valve; it only means one more read each
  }

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const f of files.values()) {
        if (!f.agent.metaLoaded) await readMeta(f);
        let st;
        try { st = await fsp.stat(f.file); } catch { continue; }
        f.mtimeMs = st.mtimeMs;
        if (st.size !== f.offset) await readNew(f, st.size);
      }
    } catch (error) {
      console.error('tick failed:', error.message);
    } finally {
      busy = false;
    }
  }

  return {
    agents,
    discover,
    tick,
    /** The folders being followed, and the sources with one on this Mac (Claude Code always counts). */
    onThisMac: () => onThisMac(open),
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
  };
}
