// Finds transcripts from every source and follows them as they grow.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { newAgent, oneLine } from './agents.js';
import { applyClaudeEvent } from './claude.js';
import { applyCodexEvent } from './codex.js';
import { codexId } from './codex-usage.js';
import { applyPiEvent } from './pi.js';
import { piAgentDir, piFileId, piId, refreshPiWindows } from './pi-usage.js';
import { createCodexNames } from './titles.js';

const RECENT_MS = 6 * 60 * 60 * 1000;
const MAX_INITIAL_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024; // read big transcripts in pieces so memory stays small

/** Follow anything touched today, or in the last 6 hours if that reaches further back. */
export function windowStart(now = Date.now()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.min(midnight.getTime(), now - RECENT_MS);
}

async function exists(dir) {
  try { return (await fsp.stat(dir)).isDirectory(); } catch { return false; }
}

const APPLY = { claude: applyClaudeEvent, codex: applyCodexEvent, pi: applyPiEvent };

export function createWatcher({ claudeDir, codexDir, piDir, piHome = piAgentDir(), feed }) {
  const files = new Map(); // path → tail state
  const agents = new Map(); // id → agent
  // Files that were read and had nothing recent, by the mtime they had then. The
  // Claude app appends bookkeeping lines with no timestamp to old sessions, which
  // bumps their mtime; without this they'd be read in full on every discovery.
  const stale = new Map();
  const codexNames = createCodexNames(codexDir);
  let dirty = true;

  async function readMeta(f) {
    try {
      const meta = JSON.parse(await fsp.readFile(f.file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
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
    const apply = APPLY[f.agent.source];
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

  async function track(file, opts, cutoff) {
    if (files.has(file)) return;
    let st;
    try { st = await fsp.stat(file); } catch { return; }
    if (st.mtimeMs < cutoff || stale.get(file) === st.mtimeMs) return;
    stale.delete(file);
    const base = path.basename(file, '.jsonl');
    const id = opts.source === 'codex' ? codexId(base.match(/([0-9a-f-]{36})$/)?.[1] || base)
      : opts.source === 'pi' ? piId(piFileId(path.basename(file)) || base)
      : opts.kind === 'sub' ? base.replace(/^agent-/, '') : base;
    const agent = agents.get(id) || newAgent(id, { ...opts, file });
    // Read the whole transcript so token and cost totals cover the full session.
    const start = Math.max(0, st.size - MAX_INITIAL_BYTES);
    const f = { file, agent, offset: start, leftover: null, skipPartial: start > 0, mtimeMs: st.mtimeMs };
    files.set(file, f);
    agents.set(id, agent);
    if (opts.kind === 'sub') await readMeta(f);
    await readNew(f, st.size);
  }

  async function discoverClaude(cutoff) {
    let projects;
    try { projects = await fsp.readdir(claudeDir, { withFileTypes: true }); } catch { return; }
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const pdir = path.join(claudeDir, p.name);
      let entries;
      try { entries = await fsp.readdir(pdir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          await track(path.join(pdir, e.name), { kind: 'main', source: 'claude' }, cutoff);
        } else if (e.isDirectory()) {
          const sdir = path.join(pdir, e.name, 'subagents');
          let st;
          try { st = await fsp.stat(sdir); } catch { continue; }
          if (st.mtimeMs < cutoff) continue;
          let subs;
          try { subs = await fsp.readdir(sdir); } catch { continue; }
          for (const s of subs) {
            if (s.endsWith('.jsonl')) await track(path.join(sdir, s), { kind: 'sub', parentId: e.name, source: 'claude' }, cutoff);
          }
        }
      }
    }
  }

  async function discoverCodex(cutoff) {
    if (!codexDir) return;
    async function walk(dir) {
      let names;
      try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of names) {
        if (entry.isDirectory()) await walk(path.join(dir, entry.name));
        else if (entry.name.endsWith('.jsonl')) await track(path.join(dir, entry.name), { kind: 'main', source: 'codex' }, cutoff);
      }
    }
    await walk(codexDir);
  }

  // pi's sessions sit in a folder per project (or all together, with its sessionDir setting).
  async function discoverPi(cutoff) {
    if (!piDir) return;
    await refreshPiWindows(piHome);
    let entries;
    try { entries = await fsp.readdir(piDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) await track(path.join(piDir, e.name), { kind: 'main', source: 'pi' }, cutoff);
      if (!e.isDirectory()) continue;
      let names;
      try { names = await fsp.readdir(path.join(piDir, e.name)); } catch { continue; }
      for (const name of names) if (name.endsWith('.jsonl')) await track(path.join(piDir, e.name, name), { kind: 'main', source: 'pi' }, cutoff);
    }
  }

  async function discover() {
    const cutoff = windowStart();
    await discoverClaude(cutoff);
    await discoverCodex(cutoff);
    await discoverPi(cutoff);
    // Codex keeps its chats' names apart from their transcripts.
    await codexNames.refresh();
    for (const a of agents.values()) {
      if (a.source !== 'codex' || a.kind !== 'main') continue;
      const name = codexNames.get(a.nativeId);
      if (a.title !== name) { a.title = name; dirty = true; }
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
    /** The folders being followed. */
    sources: async () => [claudeDir, (await exists(codexDir || '')) ? codexDir : null, (await exists(piDir || '')) ? piDir : null].filter(Boolean),
    /** The sources with a folder on this Mac; Claude Code always counts. */
    present: async () => ['claude', ...((await exists(codexDir || '')) ? ['codex'] : []), ...((await exists(piDir || '')) ? ['pi'] : [])],
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
  };
}
