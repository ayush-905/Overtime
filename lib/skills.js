// Skills: which ones your agents were offered over the last 30 days, which were
// used and how (you ran it as a command, or the agent chose it), and which never
// were. What's on offer comes from the sessions themselves: Claude Code lists a
// session's skills in its transcript, and Codex in its instructions. A skill
// counts as used when Claude Code's Skill tool loads it or you run it as a
// command, and when Codex reads its SKILL.md.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DAY = 86_400_000;
const HOME = os.homedir();
const CHECK_MS = 5 * 60_000;
const found = new Map(); // a file → [exists, when it was checked]

function cached(key, work) {
  const hit = found.get(key);
  if (hit && Date.now() - hit[1] < CHECK_MS) return hit[0];
  const value = work();
  found.set(key, [value, Date.now()]);
  return value;
}

const exists = (file) => cached(file, () => existsSync(file));

const folders = (dir) =>
  cached(`dirs:${dir}`, () => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  });

/**
 * The folder whose .claude/skills has `name`, looking in a session's folder,
 * the folders above it (up to your home folder) and the ones just inside it,
 * which is where a repo's skills are when you start a session a level up.
 */
function projectWith(name, cwd) {
  const has = (dir) => exists(path.join(dir, '.claude', 'skills', name, 'SKILL.md'));
  for (let dir = cwd; dir && dir.startsWith(HOME) && dir !== HOME; dir = path.dirname(dir)) if (has(dir)) return dir;
  return folders(cwd).find(has) || null;
}

/**
 * Where a skill comes from: your own (~/.claude/skills or ~/.codex/skills), a
 * project's, a plugin's, the Claude app's, or built into the agent. `dir` is
 * where it was loaded from, when that's known, and `cwds` the folders of the
 * sessions it was offered in.
 */
export function skillKind(source, name, dir, cwds = []) {
  const at = String(dir || '');
  if (source === 'codex') {
    if (
      at.includes('/.codex/skills/.system/') ||
      (!name.includes(':') && exists(path.join(HOME, '.codex', 'skills', '.system', name, 'SKILL.md')))
    )
      return { kind: 'builtin' };
    if (at.startsWith(path.join(HOME, '.codex', 'skills'))) return { kind: 'personal' };
    if (/(^|\/)\.(agents|codex)\/skills\//.test(at))
      return { kind: 'project', project: path.basename(at.split(/\/\.(?:agents|codex)\/skills\//)[0]) };
    if (name.includes(':') || /^r\d+\//.test(at) || at.includes('/plugins/'))
      return { kind: 'plugin', plugin: name.includes(':') ? name.split(':')[0] : null };
    return { kind: at ? 'plugin' : 'builtin' };
  }
  if (name.startsWith('anthropic-skills:')) return { kind: 'app' };
  if (name.includes(':')) return { kind: 'plugin', plugin: name.split(':')[0] };
  if (at.includes('/bundled-skills/')) return { kind: 'builtin' };
  if (at.startsWith(path.join(HOME, '.claude', 'skills'))) return { kind: 'personal' };
  if (at.includes('/.claude/skills/'))
    return { kind: 'project', project: path.basename(at.split('/.claude/skills/')[0]) };
  if (exists(path.join(HOME, '.claude', 'skills', name, 'SKILL.md'))) return { kind: 'personal' };
  // The Claude app keeps the skills it syncs from your account in ~/.claude/skills/synced.
  if (
    folders(path.join(HOME, '.claude', 'skills', 'synced')).some((bucket) =>
      exists(path.join(bucket, name, 'SKILL.md')),
    )
  )
    return { kind: 'app' };
  for (const cwd of cwds) {
    const dir = cwd && projectWith(name, cwd);
    if (dir) return { kind: 'project', project: path.basename(dir) };
  }
  return { kind: 'builtin' };
}

/** Skills over the last 30 days, for the Skills card: the ones used, most first, and the ones that weren't. */
export function skillUsage(index, now = Date.now()) {
  const since = now - 30 * DAY;
  // What was on offer, and a line about each, by provider.
  const offered = new Map(); // source:name → { name, source, about, file, cwds, projects }
  const listedProjects = new Set();
  for (const list of index.skillLists()) {
    if (!(list.t >= since)) continue;
    const source = list.rec.source;
    for (const name of list.names) {
      const key = `${source}:${name}`;
      let s = offered.get(key);
      if (!s)
        offered.set(key, (s = { name, source, about: '', file: null, cwds: new Set(), projects: new Set(), t: 0 }));
      if (list.t >= s.t) {
        s.t = list.t;
        s.about = list.about?.[name] || s.about;
        s.file = list.files?.[name] || s.file;
      }
      if (list.rec.cwd) s.cwds.add(list.rec.cwd);
      s.projects.add(index.projectOf(list.rec));
      listedProjects.add(index.projectOf(list.rec));
    }
  }
  // The Claude app's skills can be on offer twice: synced to ~/.claude/skills/synced
  // under their own name, and as anthropic-skills:name. They're one skill.
  const alias = new Map();
  for (const [key, o] of offered) {
    if (o.source !== 'claude' || o.name.includes(':')) continue;
    const full = offered.get(`claude:anthropic-skills:${o.name}`);
    if (!full || skillKind('claude', o.name, null).kind !== 'app') continue;
    alias.set(key, `claude:anthropic-skills:${o.name}`);
    for (const cwd of o.cwds) full.cwds.add(cwd);
    for (const project of o.projects) full.projects.add(project);
    offered.delete(key);
  }
  const used = new Map();
  for (const u of index.skills()) {
    if (u.t < since || u.t > now) continue;
    const key = alias.get(`${u.rec.source}:${u.name}`) || `${u.rec.source}:${u.name}`;
    // A command you ran is only a skill if it was on offer as one (not /model or /compact).
    if (u.by === 'you' && !offered.has(key)) continue;
    let s = used.get(key);
    if (!s)
      used.set(
        key,
        (s = {
          name: offered.get(key)?.name || u.name,
          source: u.rec.source,
          uses: 0,
          you: 0,
          agent: 0,
          sessions: new Set(),
          projects: new Set(),
          lastAt: 0,
          dir: null,
          days: new Set(),
        }),
      );
    s.uses++;
    s[u.by === 'you' ? 'you' : 'agent']++;
    s.sessions.add(u.rec.session);
    const project = index.projectOf(u.rec);
    if (project && project !== 'Unknown') s.projects.add(project);
    s.lastAt = Math.max(s.lastAt, u.t);
    s.dir ||= u.dir;
    s.days.add(new Date(u.t).toDateString());
  }
  // A session can be offered another folder's skills (one added with --add-dir), so every project's folder is worth a look.
  const everyCwd = [
    ...new Set(
      index
        .sessions()
        .map((x) => x.cwd)
        .filter(Boolean),
    ),
  ];
  const describe = (s, o) => {
    let { kind, project, plugin } = skillKind(s.source, s.name, s.dir || o?.file, [
      ...new Set([...(o?.cwds || []), ...everyCwd]),
    ]);
    // Not found on disk, but only ever offered in one project's sessions: that project's, from a folder it adds.
    if (kind === 'builtin' && s.source === 'claude' && o?.projects.size === 1 && listedProjects.size > 1)
      ({ kind, project } = { kind: 'project', project: [...o.projects][0] });
    return {
      name: s.name,
      source: s.source,
      kind,
      ...(project ? { project } : {}),
      ...(plugin ? { plugin } : {}),
      about: o?.about || '',
    };
  };
  const usedRows = [...used.entries()]
    .map(([key, s]) => ({
      ...describe(s, offered.get(key)),
      uses: s.uses,
      you: s.you,
      agent: s.agent,
      sessions: s.sessions.size,
      days: s.days.size,
      projects: [...s.projects].slice(0, 4),
      lastAt: s.lastAt,
    }))
    .sort((a, b) => b.uses - a.uses || b.lastAt - a.lastAt);
  const unused = [...offered.entries()]
    .filter(([key]) => !used.has(key))
    .map(([, o]) => describe(o, o))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  // Without the window's start, which moves every pass: the card doesn't show it, and
  // it would send all of this to every page again each time.
  return {
    offered: offered.size || null,
    usedCount: usedRows.length,
    uses: usedRows.reduce((n, s) => n + s.uses, 0),
    used: usedRows,
    unused,
  };
}
