// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, a folder per
// day. Resuming an old chat appends to its original file, so every day counts.
// Codex keeps its chats' names apart, in session_index.jsonl beside that folder.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyCodexEvent } from '../codex.js';
import { applyCodexRecord, codexId } from '../codex-usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKILLS = path.join(os.homedir(), '.codex', 'skills');

/**
 * Codex's names for its chats, from session_index.jsonl beside its sessions
 * folder: a line for each name it gave or you gave, the latest last. Read again
 * only when the file changes; `refresh()` says whether it did.
 */
function createCodexNames(codexDir) {
  const file = codexDir ? path.join(path.dirname(codexDir), 'session_index.jsonl') : null;
  let names = new Map();
  let seen = '';
  return {
    async refresh() {
      if (!file) return false;
      const st = await fsp.stat(file).catch(() => null);
      const stamp = st ? `${st.size}:${st.mtimeMs}` : '';
      if (stamp === seen) return false;
      seen = stamp;
      const next = new Map();
      const text = st ? await fsp.readFile(file, 'utf8').catch(() => '') : '';
      for (const line of text.split('\n')) {
        let x;
        try {
          x = JSON.parse(line);
        } catch {
          continue;
        }
        const name = typeof x?.thread_name === 'string' ? x.thread_name.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
        if (!x?.id || !name) continue;
        const at = Date.parse(x.updated_at) || 0;
        if (!next.has(x.id) || at >= next.get(x.id).at) next.set(x.id, { name, at });
      }
      names = next;
      return true;
    },
    /** The name of the chat with Codex's own id, or null. */
    get: (nativeId) => names.get(nativeId)?.name || null,
  };
}

export default {
  id: 'codex',
  name: 'Codex',
  prefix: 'codex-',
  nativeId: UUID,
  folder: (env) => env.CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions'),
  // Live, Codex reports tokens but no prices; the history prices them.
  livePriced: false,

  open({ dir }) {
    const names = createCodexNames(dir);
    async function* walk(folder, since) {
      let entries = [];
      try {
        entries = await fsp.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const file = path.join(folder, e.name);
        if (e.isDirectory()) {
          yield* walk(file, since);
          continue;
        }
        const native = e.isFile() && e.name.match(/([0-9a-f-]{36})\.jsonl$/)?.[1];
        if (!native) continue;
        const st = await fsp.stat(file).catch(() => null);
        // A subagent says so in its first line; until then it's a session of its own.
        if (st && st.mtimeMs >= since)
          yield {
            file,
            st,
            id: codexId(native),
            nativeId: native,
            session: codexId(native),
            sub: false,
            parentId: null,
          };
      }
    }
    return {
      dir,
      transcripts: (since) => walk(dir, since),
      refresh: () => names.refresh(),
      titleOf: (nativeId) => names.get(nativeId),
      live: applyCodexEvent,
      indexLine: (f, line, addText) => applyCodexRecord(f, JSON.parse(line), addText),
    };
  },

  resume: {
    command: (id) => `codex resume ${id}`,
    // The Codex app opens any Codex chat by the id its transcript has.
    app: async (nativeId, { appInstalled }) => ({
      app: appInstalled('Codex.app', 'ChatGPT.app') ? { name: 'Codex', url: `codex://threads/${nativeId}` } : null,
    }),
  },
  process: {
    exe: 'codex',
    script: /@openai\/codex/,
    resumed: /(?:--(?:resume|session-id)[= ]|\bresume +)([0-9a-f-]{36})/,
    // Codex's own helpers, which aren't sessions.
    skip: /\b(?:sandbox|mcp-server|exec-server)\b/,
    // The Codex app runs all its chats in one process.
    shared: /\bapp-server\b/,
  },
  commands: {
    dir: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'prompts'),
    use: (name) => `/prompts:${name}`,
    noun: 'Codex prompt',
  },
  tools: {
    reads: new Set(),
    // Its edits are patches, counted from what they change.
    writes: new Set(),
    command: (name) => name !== 'apply_patch',
    delegate: () => false,
  },
  skills: {
    /**
     * Where a skill comes from: built into Codex (~/.codex/skills/.system), yours
     * (~/.codex/skills), a project's (.agents/skills or .codex/skills), or a
     * plugin's. `at` is where it was loaded from ('' when that isn't known), and
     * `exists(file)` looks on disk.
     */
    kind(name, { at, exists }) {
      if (
        at.includes('/.codex/skills/.system/') ||
        (!name.includes(':') && exists(path.join(SKILLS, '.system', name, 'SKILL.md')))
      )
        return { kind: 'builtin' };
      if (at.startsWith(SKILLS)) return { kind: 'personal' };
      if (/(^|\/)\.(agents|codex)\/skills\//.test(at))
        return { kind: 'project', project: path.basename(at.split(/\/\.(?:agents|codex)\/skills\//)[0]) };
      if (name.includes(':') || /^r\d+\//.test(at) || at.includes('/plugins/'))
        return { kind: 'plugin', plugin: name.includes(':') ? name.split(':')[0] : null };
      return { kind: at ? 'plugin' : 'builtin' };
    },
  },
};
