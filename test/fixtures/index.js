// Hand-made transcripts, one folder per harness, laid out the way each harness
// keeps them: claude/ is a projects folder, codex/ has sessions/ with
// session_index.jsonl beside it, and pi/sessions/ has a folder per project.
// Every word in them is made up; only their shape follows the real formats.
//
// Every line is on 2026-03-02 between 09:00 and 10:00 UTC. Tests move them so
// that 10:00 is now (or the `at` they give), which makes them today's work, and
// `clock('09:00:05')` says when that line now landed.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENDS = Date.parse('2026-03-02T10:00:00.000Z');
const ISO = /^2026-03-02T\d\d:\d\d:\d\d\.\d{3}Z$/;

export const CLAUDE = {
  turn: 'a1000000-0000-4000-8000-000000000001', // a normal turn: tools, a failing test run, a fix, the reply, an ai-title
  approval: 'a1000000-0000-4000-8000-000000000002', // a file write waiting for you to allow it
  ask: 'a1000000-0000-4000-8000-000000000003', // a question for you, then a plan to approve
  compact: 'a1000000-0000-4000-8000-000000000004', // a manual /compact, an edit you turn down, a custom title
  delegate: 'a1000000-0000-4000-8000-000000000005', // a session that briefs a subagent
  sub: 'a7e5b1c2d3e4f5061', // that subagent
  extras: 'a1000000-0000-4000-8000-000000000006', // the Claude app: todos, a multi-edit, the web, an MCP tool, a background task, its own cost
};
export const CODEX = {
  main: 'c0de0000-0000-4000-8000-000000000001', // git, rate limits, patches, a failing test run, task_complete, a name
  second: 'c0de0000-0000-4000-8000-000000000002', // a failed script, a patch you turn down, a stop, a compaction, a patch waiting
  sub: 'c0de0000-0000-4000-8000-000000000003', // a subagent of the first: a plan, a web search, a search
};
export const PI = {
  main: '019c0000-0000-7000-8000-000000000001', // tools, a failing test run, a name, a compaction, a branch
  fork: '019c0000-0000-7000-8000-000000000002', // a /fork of the first: copied lines, then its own, a stop, a read waiting
};
export const CWD = '/Users/sam/work/bakery';

/** Moving the fixtures so that 10:00 lands on `at`: by how much, and when a line at a clock time now is. */
export function timeline(at = Date.now()) {
  const shift = at - ENDS;
  return { shift, clock: (time) => Date.parse(`2026-03-02T${time}.000Z`) + shift };
}

/** One line moved in time: its ISO timestamps, Pi's message times (ms) and Codex's reset times (seconds). */
export function moveLine(text, shift) {
  return JSON.stringify(JSON.parse(text), (key, v) => {
    if (typeof v === 'string' && ISO.test(v)) return new Date(Date.parse(v) + shift).toISOString();
    if (typeof v === 'number' && key === 'timestamp') return v + shift;
    if (typeof v === 'number' && ['resets_at', 'started_at', 'completed_at'].includes(key)) return v + Math.round(shift / 1000);
    return v;
  });
}

async function* walk(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every fixture file of a harness, by its path under test/fixtures. */
export async function fixtureFiles(harness) {
  const out = [];
  for await (const file of walk(path.join(ROOT, harness))) out.push(path.relative(ROOT, file));
  return out.sort();
}

/** The fixture transcript with this session (or subagent) id in its name. */
export async function fixtureFile(harness, id) {
  const found = (await fixtureFiles(harness)).filter((f) => f.endsWith('.jsonl') && path.basename(f).includes(id));
  if (found.length !== 1) throw new Error(`no single ${harness} fixture for ${id}`);
  return found[0];
}

/** A fixture transcript's lines, moved by `shift`. */
export async function fixtureLines(rel, shift = 0) {
  const text = await fsp.readFile(path.join(ROOT, rel), 'utf8');
  return text.split('\n').filter(Boolean).map((line) => moveLine(line, shift));
}

/** Where a fixture file goes, given the folders the harnesses read: `{ claude, codex, pi }`. */
export function placeOf(rel, dirs) {
  const [harness, ...rest] = rel.split(path.sep);
  if (harness === 'claude' && dirs.claude) return path.join(dirs.claude, ...rest);
  // Codex keeps its chats' names beside its sessions folder.
  if (harness === 'codex' && dirs.codex) return rest[0] === 'sessions' ? path.join(dirs.codex, ...rest.slice(1)) : path.join(path.dirname(dirs.codex), ...rest);
  if (harness === 'pi' && dirs.pi && rest[0] === 'sessions') return path.join(dirs.pi, ...rest.slice(1));
  return null;
}

/**
 * Write the fixtures into the folders given (`{ claude, codex, pi }`, any of
 * them), moved so 10:00 is `at`. `only` keeps the files whose path has one of
 * these ids in it. Returns the move, as timeline() does.
 */
export async function layFixtures(dirs, { at = Date.now(), only = null } = {}) {
  const t = timeline(at);
  for (const harness of ['claude', 'codex', 'pi']) {
    if (!dirs[harness]) continue;
    for (const rel of await fixtureFiles(harness)) {
      if (only && !only.some((id) => rel.includes(id))) continue;
      const dest = placeOf(rel, dirs);
      if (!dest) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      if (rel.endsWith('.jsonl')) await fsp.writeFile(dest, (await fixtureLines(rel, t.shift)).join('\n') + '\n');
      else await fsp.copyFile(path.join(ROOT, rel), dest);
    }
  }
  return t;
}
