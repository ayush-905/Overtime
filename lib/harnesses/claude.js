// Claude Code: ~/.claude/projects/<folder>/<session>.jsonl, with each session's
// subagents in <folder>/<session>/subagents/agent-<id>.jsonl (a .meta.json beside
// each says what it was asked to do).

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyClaudeEvent } from '../claude.js';
import { applyClaudeLine } from '../claude-usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOME = os.homedir();
const SKILLS = path.join(HOME, '.claude', 'skills');
// The Claude app keeps a file for each session it started: <account>/<org>/local_<id>.json.
const APP_SESSIONS = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const APP_RESCAN_MS = 30_000;

const stat = (file) => fsp.stat(file).catch(() => null);

let appSessions = { at: 0, byCli: new Map() };

/** The Claude app's sessions, by the transcript id each one runs: cliSessionId → local_… id. */
async function claudeAppSessions() {
  if (Date.now() - appSessions.at < APP_RESCAN_MS) return appSessions.byCli;
  const byCli = new Map();
  const walk = async (dir, depth) => {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (e.isFile() && /^local_[\w-]+\.json$/.test(e.name)) {
        try {
          const s = JSON.parse(await fsp.readFile(full, 'utf8'));
          if (UUID.test(s.cliSessionId || '') && /^local_[A-Za-z0-9-]{1,64}$/.test(s.sessionId || '') && !s.isArchived)
            byCli.set(s.cliSessionId, s.sessionId);
        } catch {}
      }
    }
  };
  await walk(APP_SESSIONS, 0);
  appSessions = { at: Date.now(), byCli };
  return byCli;
}

/**
 * The folder whose .claude/skills has `name`, looking in a session's folder,
 * the folders above it (up to your home folder) and the ones just inside it,
 * which is where a repo's skills are when you start a session a level up.
 */
function projectWith(name, cwd, exists, folders) {
  const has = (dir) => exists(path.join(dir, '.claude', 'skills', name, 'SKILL.md'));
  for (let dir = cwd; dir?.startsWith(HOME) && dir !== HOME; dir = path.dirname(dir)) if (has(dir)) return dir;
  return folders(cwd).find(has) || null;
}

export default {
  id: 'claude',
  name: 'Claude Code',
  // Its sessions go by their own id; the others' carry a prefix.
  prefix: '',
  nativeId: UUID,
  folder: (env) => env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects'),

  open({ dir }) {
    return {
      dir,
      /** Every transcript changed since `since`: the sessions, then their subagents. */
      async *transcripts(since) {
        let projects = [];
        try {
          projects = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const p of projects) {
          if (!p.isDirectory()) continue;
          const pdir = path.join(dir, p.name);
          let entries = [];
          try {
            entries = await fsp.readdir(pdir, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const e of entries) {
            if (e.isFile() && e.name.endsWith('.jsonl')) {
              const file = path.join(pdir, e.name);
              const st = await stat(file);
              const session = path.basename(e.name, '.jsonl');
              if (st && st.mtimeMs >= since)
                yield {
                  file,
                  st,
                  id: session,
                  nativeId: session,
                  session,
                  sub: false,
                  parentId: null,
                  dirName: p.name,
                };
            } else if (e.isDirectory()) {
              // A new subagent touches its folder, so an untouched one has nothing new.
              const sdir = path.join(pdir, e.name, 'subagents');
              const sst = await stat(sdir);
              if (!sst || sst.mtimeMs < since) continue;
              let subs = [];
              try {
                subs = await fsp.readdir(sdir);
              } catch {
                continue;
              }
              for (const s of subs) {
                if (!s.endsWith('.jsonl')) continue;
                const file = path.join(sdir, s);
                const st = await stat(file);
                const id = path.basename(s, '.jsonl').replace(/^agent-/, '');
                if (st && st.mtimeMs >= since)
                  yield { file, st, id, nativeId: id, session: e.name, sub: true, parentId: e.name, dirName: p.name };
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
    // The Claude app opens a session it started itself, by its own id (local_…),
    // which it keeps in a file per session beside the transcript's id.
    async app(nativeId, { appInstalled, getDesktopSessions = claudeAppSessions }) {
      if (!appInstalled('Claude.app')) return { app: null };
      const local = (await getDesktopSessions()).get(nativeId);
      return local
        ? { app: { name: 'Claude', url: `claude://code/continue?session=${encodeURIComponent(local)}` } }
        : { app: null, appMissing: { name: 'Claude', why: 'started outside the Claude app' } };
    },
  },
  // Judged by the executable's own name: the desktop app's launcher passes the agent's path in its arguments.
  process: {
    exe: 'claude',
    script: /@anthropic-ai\/claude-code\/cli\.m?js/,
    resumed: /(?:--(?:resume|session-id)[= ]|\bresume +)([0-9a-f-]{36})/,
  },
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
  skills: {
    /**
     * Where a skill comes from: yours (~/.claude/skills), a project's, a
     * plugin's, the Claude app's, or built into Claude Code. `at` is where it was
     * loaded from ('' when that isn't known), `cwds` the folders of the sessions
     * it was offered in, and `exists(file)` and `folders(dir)` look on disk.
     */
    kind(name, { at, cwds, exists, folders }) {
      if (name.startsWith('anthropic-skills:')) return { kind: 'app' };
      if (name.includes(':')) return { kind: 'plugin', plugin: name.split(':')[0] };
      if (at.includes('/bundled-skills/')) return { kind: 'builtin' };
      if (at.startsWith(SKILLS)) return { kind: 'personal' };
      if (at.includes('/.claude/skills/'))
        return { kind: 'project', project: path.basename(at.split('/.claude/skills/')[0]) };
      if (exists(path.join(SKILLS, name, 'SKILL.md'))) return { kind: 'personal' };
      // The Claude app keeps the skills it syncs from your account in ~/.claude/skills/synced.
      if (folders(path.join(SKILLS, 'synced')).some((bucket) => exists(path.join(bucket, name, 'SKILL.md'))))
        return { kind: 'app' };
      for (const cwd of cwds) {
        const dir = cwd && projectWith(name, cwd, exists, folders);
        if (dir) return { kind: 'project', project: path.basename(dir) };
      }
      return { kind: 'builtin' };
    },
    // The Claude app's skills can be on offer twice: synced to ~/.claude/skills/synced
    // under their own name, and as anthropic-skills:name.
    alias: (name) => (name.includes(':') ? null : `anthropic-skills:${name}`),
    // A session can be offered the skills of a folder it adds (--add-dir).
    addDirs: true,
  },
};
