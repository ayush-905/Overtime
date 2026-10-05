// Skills: which ones your agents were offered over the last 30 days, which were
// used and how (you ran it as a command, or the agent chose it), and which never
// were. What's on offer comes from the sessions themselves: Claude Code lists a
// session's skills in its transcript, and Codex in its instructions. A skill
// counts as used when Claude Code's Skill tool loads it or you run it as a
// command, and when Codex reads its SKILL.md. Each harness's module says where
// its skills live (its `skills` in lib/harnesses).
// @ts-check
/** @import { OfferedSkill, SkillUsage, UsedSkill } from '../types/api.js' */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { harness } from './harnesses/index.js';

const DAY = 86_400_000;
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
 * Where a skill comes from: your own, a project's, a plugin's, the Claude app's,
 * or built into the agent, as its harness tells. `dir` is where it was loaded
 * from, when that's known, and `cwds` the folders of the sessions it was offered in.
 */
export function skillKind(source, name, dir, cwds = []) {
  const skills = harness(source).skills;
  return skills ? skills.kind(name, { at: String(dir || ''), cwds, exists, folders }) : { kind: 'builtin' };
}

/** Skills over the last 30 days, for the Skills card: the ones used, most first, and the ones that weren't. @returns {SkillUsage} */
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
  // An app's skills can be on offer twice, under their own name and another (the
  // Claude app's as anthropic-skills:name too). They're one skill.
  const alias = new Map();
  for (const [key, o] of offered) {
    const other = harness(o.source).skills?.alias?.(o.name);
    const full = other && offered.get(`${o.source}:${other}`);
    if (!full || skillKind(o.source, o.name, null).kind !== 'app') continue;
    alias.set(key, `${o.source}:${other}`);
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
  /** @returns {OfferedSkill} */
  const describe = (s, o) => {
    let { kind, project, plugin } = skillKind(s.source, s.name, s.dir || o?.file, [
      ...new Set([...(o?.cwds || []), ...everyCwd]),
    ]);
    // Not found on disk, but only ever offered in one project's sessions: that project's, from a folder it adds.
    if (kind === 'builtin' && harness(s.source).skills?.addDirs && o?.projects.size === 1 && listedProjects.size > 1)
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
    .map(
      ([key, s]) =>
        /** @satisfies {UsedSkill} */ ({
          ...describe(s, offered.get(key)),
          uses: s.uses,
          you: s.you,
          agent: s.agent,
          sessions: s.sessions.size,
          days: s.days.size,
          projects: [...s.projects].slice(0, 4),
          lastAt: s.lastAt,
        }),
    )
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
