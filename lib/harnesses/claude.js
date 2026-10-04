// Claude Code: ~/.claude/projects/<folder>/<session>.jsonl, with each session's
// subagents in <folder>/<session>/subagents/agent-<id>.jsonl (a .meta.json beside
// each says what it was asked to do).

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyClaudeEvent } from '../claude.js';
import { applyClaudeLine } from '../claude-usage.js';

const stat = (file) => fsp.stat(file).catch(() => null);

export default {
  id: 'claude',
  name: 'Claude Code',
  // Its sessions go by their own id; the others' carry a prefix.
  prefix: '',
  nativeId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  folder: (env) => env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects'),

  open({ dir }) {
    return {
      dir,
      /** Every transcript changed since `since`: the sessions, then their subagents. */
      async *transcripts(since) {
        let projects = [];
        try { projects = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const p of projects) {
          if (!p.isDirectory()) continue;
          const pdir = path.join(dir, p.name);
          let entries = [];
          try { entries = await fsp.readdir(pdir, { withFileTypes: true }); } catch { continue; }
          for (const e of entries) {
            if (e.isFile() && e.name.endsWith('.jsonl')) {
              const file = path.join(pdir, e.name);
              const st = await stat(file);
              const session = path.basename(e.name, '.jsonl');
              if (st && st.mtimeMs >= since) yield { file, st, id: session, nativeId: session, session, sub: false, parentId: null, dirName: p.name };
            } else if (e.isDirectory()) {
              // A new subagent touches its folder, so an untouched one has nothing new.
              const sdir = path.join(pdir, e.name, 'subagents');
              const sst = await stat(sdir);
              if (!sst || sst.mtimeMs < since) continue;
              let subs = [];
              try { subs = await fsp.readdir(sdir); } catch { continue; }
              for (const s of subs) {
                if (!s.endsWith('.jsonl')) continue;
                const file = path.join(sdir, s);
                const st = await stat(file);
                const id = path.basename(s, '.jsonl').replace(/^agent-/, '');
                if (st && st.mtimeMs >= since) yield { file, st, id, nativeId: id, session: e.name, sub: true, parentId: e.name, dirName: p.name };
              }
            }
          }
        }
      },
      /** What a subagent was asked to do; throws until its meta file is there. */
      async meta(file) {
        const meta = JSON.parse(await fsp.readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
        return { description: meta.description || null, agentType: meta.agentType || null };
      },
      live: applyClaudeEvent,
      indexLine: applyClaudeLine,
    };
  },

  resume: {
    command: (id) => `claude --resume ${id}`,
    // The Claude app opens a session it started itself, by its own id (local_…).
    async app(nativeId, { appInstalled, getDesktopSessions }) {
      if (!appInstalled('Claude.app')) return { app: null };
      const local = (await getDesktopSessions()).get(nativeId);
      return local
        ? { app: { name: 'Claude', url: `claude://code/continue?session=${encodeURIComponent(local)}` } }
        : { app: null, appMissing: 'started outside the Claude app' };
    },
  },
  // Judged by the executable's own name: the desktop app's launcher passes the agent's path in its arguments.
  process: { exe: 'claude', script: /@anthropic-ai\/claude-code\/cli\.m?js/, resumed: /(?:--(?:resume|session-id)[= ]|\bresume +)([0-9a-f-]{36})/ },
  commands: {
    dir: () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'commands'),
    use: (name) => `/${name}`,
    noun: 'command',
  },
  tools: {
    reads: new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']),
    writes: new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']),
    command: (name) => name === 'Bash',
    delegate: (name) => name === 'Task' || name === 'Agent',
  },
};
