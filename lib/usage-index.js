// A running index of the last 31 days of Claude Code usage: every assistant
// message's cost and tokens (with its cache use and context size), which
// project, model and session it belongs to, lines changed by edits, every tool
// call and whether it failed or you denied it, when you sent messages,
// compactions, the moments a plan limit was hit, the skills agents were offered
// and the ones used, and (unless search is off) the text of the conversations,
// for searching them. It powers the plan-limit estimate and the insights, and
// only rereads what changed.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { cacheEffect, contextUsed, costParts, usageCost, usageTokens } from './pricing.js';
import { REJECTED, resultText } from './claude.js';
import { applyCodexRecord, codexId } from './codex-usage.js';
import { createCodexNames, notePrompt } from './titles.js';

const DAY = 86_400_000;
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const CACHE_EXPIRY_MS = 5 * 60_000; // the default cache lifetime
const CHUNK_BYTES = 4 * 1024 * 1024;
// What search keeps of each message: plenty to find it by, without holding whole essays.
const TEXT_CAP = { you: 4000, agent: 6000 };
const SKILL_DIR = 'Base directory for this skill: ';

/**
 * The skills a Claude Code session was offered, from its skill_listing: their
 * names, and a line about each from the listing's text ("- name: what it does").
 */
function skillListing(a) {
  const names = Array.isArray(a.names) ? a.names.filter((n) => typeof n === 'string' && n.length <= 120) : [];
  const about = {};
  const byLength = [...names].sort((x, y) => y.length - x.length);
  for (const chunk of String(a.content || '').split(/\n(?=- )/)) {
    const line = chunk.replace(/^- /, '');
    const name = byLength.find((n) => line.startsWith(`${n}: `));
    if (name) about[name] = line.slice(name.length + 2).replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  return { names, about };
}

/** A message's text for search: one line of it, trimmed to what search keeps. */
export const searchable = (text, who) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP[who] || 4000);

/** A query as the words (or "quoted phrases") every match must have, lowercased. */
export function queryTerms(q) {
  const terms = [];
  for (const m of String(q || '').toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term) terms.push(term);
  }
  return terms.slice(0, 8);
}

/** A short piece of `text` around the first of the terms, cut at word boundaries, without Markdown's ** and `. */
export function snippet(raw, terms, width = 150) {
  const text = raw.replace(/\*\*|__|`+/g, '');
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (text.length <= width) return text;
  // A few words before the match, so it's near the start where a narrow row still shows it.
  let from = Math.max(0, at - 28);
  let to = Math.min(text.length, from + width);
  from = Math.max(0, to - width);
  if (from > 0) from = text.indexOf(' ', from) + 1 || from;
  if (to < text.length) to = text.lastIndexOf(' ', to) > from ? text.lastIndexOf(' ', to) : to;
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

function projectName(cwd) {
  if (!cwd) return null;
  if (cwd.includes('/scratch-workspaces/')) return 'No folder';
  return path.basename(cwd);
}

function lineCount(text) {
  if (!text) return 0;
  const s = String(text);
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}

// Commands that are better told apart by their first argument, like `npm test` or `git push`.
const SUBCOMMANDS = new Set(['npm', 'pnpm', 'yarn', 'npx', 'bun', 'git', 'node', 'python', 'python3', 'go', 'cargo', 'docker', 'make', 'gh', 'kubectl']);

/**
 * The program whose exit code a shell command reports, without its arguments:
 * the last command (the last part of a pipeline), since that's where the exit
 * code comes from. `cd app && npm test` → `npm test`. `simple` is false for
 * multi-step commands, where the failing step can't be known.
 */
function shellInfo(command) {
  const lines = String(command || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const line = (lines.some((l) => l.includes('<<')) ? lines[0] : lines[lines.length - 1]) || '';
  const statements = line.split(/&&|\|\||;/).map((x) => x.trim()).filter(Boolean);
  const parts = (statements[statements.length - 1] || '').split(/\s\|\s/);
  const words = parts[parts.length - 1].split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && w !== 'sudo');
  const name = words[0]?.split('/').pop() || null;
  return {
    program: name && SUBCOMMANDS.has(name) && words[1] && !words[1].startsWith('-') ? `${name} ${words[1]}` : name,
    simple: lines.length === 1 && statements.length === 1 && parts.length === 1,
  };
}

// Exit code 1 from these means "no match" or "they differ", not that something broke.
const NO_MATCH = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'diff', 'cmp', 'test', '[', 'pgrep', 'which']);
const EXIT_REASONS = { 124: 'Timed out', 126: 'Not allowed to run', 127: 'Command not found', 130: 'Interrupted', 137: 'Killed (memory or time limit)', 143: 'Stopped' };
const OUTPUT_REASONS = [
  [/no such file or directory|cannot access|does not exist/i, 'File or folder not found'],
  [/no matches found/i, 'A file pattern matched nothing'],
  [/command not found/i, 'Command not found'],
  [/permission denied|operation not permitted/i, 'Blocked by file permissions'],
  [/illegal option|invalid option|unrecognized (option|argument)|unknown option|usage:/i, 'Wrong command options'],
  [/Traceback \(most recent call last\)/, 'Python error'],
  [/\d+ (failing|failed)\b|Tests?:\s+\d+ failed|^FAIL\s/im, 'Tests failed'],
  [/error TS\d+|\d+ problems? \(\d+ errors?/i, 'Type or lint errors'],
];

/** A short, groupable reason for a failed tool call; null when it didn't really fail, '' when unknown. */
function failReason(call, text) {
  const tag = text.match(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/);
  if (tag) return tag[1].split(/(?<=\.)\s/)[0].trim().slice(0, 80);
  const exit = text.match(/^Exit code (\d+)/);
  if (!exit) return '';
  const code = Number(exit[1]);
  if (code === 1 && NO_MATCH.has(call.program)) return null;
  if (EXIT_REASONS[code]) return EXIT_REASONS[code];
  for (const [pattern, reason] of OUTPUT_REASONS) if (pattern.test(text)) return reason;
  return call.simple && call.program ? `${call.program} exited with code ${code}` : `Multi-step shell command exited with code ${code}`;
}

const text = (v, n) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, n) : null);

/** What a tool call was about, to show with the message that set it off: the file it read or changed, the command it ran, the search. */
export function callSubject(name, input = {}) {
  const file = text(input.file_path, 400) || text(input.notebook_path, 400) || null;
  let what = null;
  if (name === 'Bash') what = text(input.command, 200);
  else if (name === 'Grep' || name === 'Glob') what = text(input.pattern, 100);
  else if (name === 'WebFetch') what = text(input.url, 200);
  else if (name === 'WebSearch') what = text(input.query, 120);
  else if (name === 'Task' || name === 'Agent') what = text(input.description, 120) || text(input.subagent_type, 60);
  else if (name === 'Skill') what = text(input.skill, 80);
  return { file, what };
}

function editLines(name, input = {}) {
  switch (name) {
    case 'Edit': return [lineCount(input.new_string), lineCount(input.old_string)];
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return [edits.reduce((n, e) => n + lineCount(e.new_string), 0), edits.reduce((n, e) => n + lineCount(e.old_string), 0)];
    }
    case 'Write': return [lineCount(input.content), 0];
    case 'NotebookEdit': return [lineCount(input.new_source), 0];
  }
  return [0, 0];
}

export function createUsageIndex({ claudeDir, codexDir, days = 31, keepText = true }) {
  // path → record. Events are [t, cost, tokens, model, record, detail], where detail
  // holds cache use and context size; edits are [t, added, removed, record].
  const files = new Map();
  const codexNames = createCodexNames(codexDir);
  let textOn = keepText;
  let busy = false;
  let version = 0;
  const cache = { version: -1 };
  let scanned = false;
  const scoped = new Map();

  function record(file, info) {
    return {
      file, source: 'claude', ...info,
      size: 0, mtimeMs: 0, offset: 0, leftover: null,
      seen: new Set(), events: [], hits: [], edits: [], compactions: [], lastT: 0,
      calls: [], callById: new Map(), prompts: [],
      project: null, rooted: false, cwd: null, title: null, customTitle: null, aiTitle: null, agentName: null, firstPrompt: null,
      work: [], model: null, tokenTotal: null, quotas: {}, quotaLog: [],
      // Skills: [t, name, 'you' | 'agent', id, dir]; the latest list it was offered; and search's text, [t, 'you' | 'agent', text].
      skills: [], skillList: null, keepText: textOn, texts: [], textSeen: new Set(),
      // Lines already read: a transcript can have its conversation written into it
      // again (the Claude app does when a session moves folder), with the same ids.
      lineSeen: new Set(),
    };
  }

  /** A message's text, for search; each only once, however often its line is written. */
  function addText(f, t, who, text, key) {
    if (!t || !text) return;
    if (key) {
      if (f.textSeen.has(key)) return;
      f.textSeen.add(key);
    }
    const kept = searchable(text, who);
    if (kept) f.texts.push([t, who, kept]);
  }

  function parseLines(f, text) {
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (f.source === 'codex') {
        try { applyCodexRecord(f, JSON.parse(line), addText); } catch {}
        continue;
      }
      const interesting = line.includes('"usage"') || line.includes('quotaLimits') || line.includes('"custom-title"') || line.includes('"ai-title"') || line.includes('compact_boundary')
        || line.includes('"agent-name"') || line.includes('"is_error":true') || line.includes('"skill_listing"') || (line.includes('"type":"user"') && !line.includes('"tool_result"'));
      if (!interesting) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      // Claude Code files each session under the folder it was started in (its path with
      // every other character turned into '-'); that folder names the project.
      if (ev.cwd && !f.rooted) {
        if (ev.cwd.replace(/[^a-zA-Z0-9]/g, '-') === f.dirName) {
          f.project = projectName(ev.cwd);
          f.cwd = ev.cwd; // the folder the session was started in
          f.rooted = true;
        } else {
          f.project = projectName(ev.cwd);
          f.cwd ||= ev.cwd;
        }
      }
      // Its title: the one you gave it, else the one Claude Code wrote for it.
      if (ev.type === 'custom-title' || ev.type === 'ai-title') {
        if (ev.type === 'custom-title') f.customTitle = ev.customTitle || f.customTitle;
        else f.aiTitle = ev.aiTitle || f.aiTitle;
        f.title = f.customTitle || f.aiTitle;
        continue;
      }
      // Your messages, notices and compactions count once, however often they're written.
      if ((ev.type === 'user' || ev.type === 'system') && ev.uuid) {
        if (f.lineSeen.has(ev.uuid)) continue;
        f.lineSeen.add(ev.uuid);
      }
      if (ev.type === 'agent-name') { f.agentName = ev.agentName || f.agentName; continue; }
      const t = ev.timestamp ? Date.parse(ev.timestamp) : null;
      // The skills this session was offered; a later listing only adds to the first.
      if (ev.type === 'attachment' && ev.attachment?.type === 'skill_listing') {
        const listed = skillListing(ev.attachment);
        if (ev.attachment.isInitial !== false || !f.skillList) f.skillList = { t, ...listed };
        else f.skillList = { t, names: [...new Set([...f.skillList.names, ...listed.names])], about: { ...f.skillList.about, ...listed.about } };
        continue;
      }
      if (ev.type === 'user') {
        const c = ev.message?.content;
        const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : '';
        // A skill you ran as a command (it's told apart from other commands later,
        // by the skills on offer), and where a skill that loaded lives.
        const command = raw.includes('<command-name>/') && raw.match(/<command-name>\/([^<\s]{1,120})<\/command-name>/);
        if (command && t) f.skills.push([t, command[1], 'you', `${t}:${command[1]}`, null]);
        if (raw.startsWith(SKILL_DIR)) {
          const dir = raw.slice(SKILL_DIR.length).split('\n')[0].trim();
          const last = f.skills[f.skills.length - 1];
          if (last && !last[4] && Math.abs(last[0] - t) < 60_000) last[4] = dir;
        }
        // A failed tool call, or one you said no to.
        for (const b of Array.isArray(c) ? c : []) {
          if (b.type !== 'tool_result' || !b.is_error) continue;
          const call = f.callById.get(b.tool_use_id);
          if (!call) continue;
          const text = resultText(b);
          if (REJECTED.test(text)) {
            call.status = 'denied';
            continue;
          }
          const reason = failReason(call, text);
          if (reason === null) continue;
          call.status = 'error';
          call.reason = reason || null;
        }
        // A message starts a stretch of work: one from you, an interruption, or
        // something else like a background task finishing (or a subagent's task).
        if (!ev.isMeta && !ev.isCompactSummary) {
          const text2 = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : '';
          const clean = text2.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const interrupt = clean.startsWith('[Request interrupted');
          if (clean && t) {
            const origin = ev.origin?.kind;
            const kind = interrupt ? 'interrupt' : origin === 'human' || (!origin && !ev.isVisibleInTranscriptOnly) ? 'human' : 'other';
            f.prompts.push([t, f, kind, kind === 'human' ? clean.slice(0, 90) : null]);
            if (kind === 'human' && f.keepText && !f.sub) addText(f, t, 'you', clean, ev.uuid);
          }
          if (clean && !interrupt) notePrompt(f, clean.slice(0, 70));
        }
      }
      if (!t) continue;
      const q = ev.quotaLimits;
      if (q && q.status === 'rejected' && q.resetsAt && !f.hits.some((h) => h.t === t)) {
        f.hits.push({ t, type: q.rateLimitType || 'five_hour', resetsAt: q.resetsAt > 1e10 ? q.resetsAt : q.resetsAt * 1000 });
      }
      if (ev.type === 'system' && ev.subtype === 'compact_boundary') {
        const meta = ev.compactMetadata || {};
        f.compactions.push({ t, trigger: meta.trigger || 'auto', before: meta.preTokens || 0, rec: f });
        continue;
      }
      const m = ev.message;
      if (ev.type !== 'assistant' || !m || m.model === '<synthetic>') continue;
      // Each content block is its own line, so edits are read from every line…
      for (const b of Array.isArray(m.content) ? m.content : []) {
        // A tool call counts once, by its id, and so do the lines its edit changed.
        if (b.type === 'tool_use' && b.id && !f.callById.has(b.id)) {
          const shell = b.name === 'Bash' ? shellInfo(b.input?.command) : {};
          const { file, what } = callSubject(b.name, b.input);
          const call = { t, name: b.name, program: shell.program || null, simple: !!shell.simple, status: 'ok', reason: null, rec: f, file, what };
          f.calls.push(call);
          f.callById.set(b.id, call);
          // A skill the agent chose to use.
          if (b.name === 'Skill' && typeof b.input?.skill === 'string') f.skills.push([t, b.input.skill.replace(/^\//, '').slice(0, 120), 'agent', b.id, null]);
          if (EDIT_TOOLS.has(b.name)) {
            const [added, removed] = editLines(b.name, b.input);
            if (added || removed) f.edits.push([t, added, removed, f, file]);
          }
        }
        if (b.type === 'text' && f.keepText && !f.sub) addText(f, t, 'agent', b.text, `${m.id}:${String(b.text || '').slice(0, 40)}`);
      }
      // …but the usage they repeat is counted once per message.
      if (!m.usage) continue;
      const key = m.id || ev.requestId;
      if (key) {
        if (f.seen.has(key)) continue;
        f.seen.add(key);
      }
      const u = usageTokens(m.usage);
      const write = u.write5m + u.write1h;
      const tokens = u.input + u.output + u.cacheRead + write;
      const cost = usageCost(m.model, m.usage);
      const { saved, writeCost } = cacheEffect(m.model, m.usage);
      // A rebuild: most of the prompt had to be written to the cache again. That
      // happens when a session starts, after a compaction, or after a pause long
      // enough for the cache to expire.
      const rebuild = write > 20_000 && write > (write + u.cacheRead + u.input) / 2
        ? (!f.lastT ? 'start' : t - f.lastT > CACHE_EXPIRY_MS ? 'pause' : 'other')
        : null;
      f.lastT = t;
      const detail = { read: u.cacheRead, write, fresh: u.input, output: u.output, saved, writeCost, context: contextUsed(m.usage), rebuild, costKnown: cost != null, parts: costParts(m.model, m.usage) };
      if (tokens || cost) f.events.push([t, cost || 0, tokens, m.model || 'unknown', f, detail]);
    }
    version++;
  }

  async function readFile(file, st, info) {
    let f = files.get(file);
    // Search was turned back on: read the whole file again for its text, while the old record stands in.
    const again = f && textOn && !f.keepText;
    if (f && !again && f.size === st.size && f.mtimeMs === st.mtimeMs) return;
    const fresh = !f || again || st.size < f.offset;
    if (fresh) f = record(file, info);
    const fh = await fsp.open(file, 'r');
    try {
      // In pieces, so a big transcript never sits in memory all at once. Lines are
      // cut at newline bytes, which never fall inside a multi-byte character.
      while (f.offset < st.size) {
        const len = Math.min(CHUNK_BYTES, st.size - f.offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, f.offset);
        if (!bytesRead) break;
        f.offset += bytesRead;
        const data = f.leftover ? Buffer.concat([f.leftover, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        const cut = data.lastIndexOf(10);
        f.leftover = Buffer.from(cut === -1 ? data : data.subarray(cut + 1));
        if (cut !== -1) parseLines(f, data.subarray(0, cut).toString('utf8'));
      }
    } finally {
      await fh.close();
    }
    f.size = st.size;
    f.mtimeMs = st.mtimeMs;
    if (fresh) {
      files.set(file, f);
      version++;
    }
  }

  async function scan() {
    if (busy) return;
    busy = true;
    const cutoff = Date.now() - days * DAY;
    const alive = new Set();
    try {
      let projects = [];
      try { projects = await fsp.readdir(claudeDir, { withFileTypes: true }); } catch {}
      for (const p of projects) {
        if (!p.isDirectory()) continue;
        const pdir = path.join(claudeDir, p.name);
        let entries = [];
        try { entries = await fsp.readdir(pdir, { withFileTypes: true }); } catch { continue; }
        const candidates = [];
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith('.jsonl')) {
            candidates.push([path.join(pdir, e.name), { session: path.basename(e.name, '.jsonl'), sub: false, dirName: p.name }]);
          } else if (e.isDirectory()) {
            const sdir = path.join(pdir, e.name, 'subagents');
            let subs = [];
            try { subs = await fsp.readdir(sdir); } catch { continue; }
            for (const s of subs) if (s.endsWith('.jsonl')) candidates.push([path.join(sdir, s), { session: e.name, sub: true, dirName: p.name }]);
          }
        }
        for (const [file, info] of candidates) {
          let st;
          try { st = await fsp.stat(file); } catch { continue; }
          if (st.mtimeMs < cutoff) continue;
          alive.add(file);
          try { await readFile(file, st, info); } catch {}
        }
      }
      for (const file of files.keys()) {
        if (files.get(file).source === 'codex') continue;
        if (!alive.has(file)) {
          files.delete(file);
          version++;
        }
      }
      // Scan all date folders: resuming an old chat appends to its original file.
      async function walk(dir) {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const file = path.join(dir, e.name);
          if (e.isDirectory()) { await walk(file); continue; }
          if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
          const st = await fsp.stat(file).catch(() => null);
          if (!st || st.mtimeMs < cutoff) continue;
          alive.add(file);
          const native = e.name.match(/([0-9a-f-]{36})\.jsonl$/)?.[1];
          if (!native) continue;
          await readFile(file, st, { source: 'codex', id: codexId(native), session: codexId(native), nativeId: native, sub: false }).catch(() => {});
        }
      }
      if (codexDir) await walk(codexDir);
      for (const [file, rec] of files) if (rec.source === 'codex' && !alive.has(file)) { files.delete(file); version++; }
      // Codex keeps its chats' names apart from their transcripts.
      await codexNames.refresh();
      for (const f of files.values()) {
        if (f.source !== 'codex') continue;
        const name = codexNames.get(f.nativeId);
        if (f.title !== name) { f.title = name; version++; }
      }
      // Resolve nested subagents to their root session after all metadata is read.
      const byId = new Map([...files.values()].filter((f) => f.id).map((f) => [f.id, f]));
      for (const f of files.values()) if (f.parentId) {
        let parent = f.parentId; const visited = new Set([f.id]);
        while (byId.get(parent)?.parentId && !visited.has(parent)) { visited.add(parent); parent = byId.get(parent).parentId; }
        f.session = parent;
      }
      scanned = true;
    } finally {
      busy = false;
    }
  }

  function merged() {
    if (cache.version === version) return cache;
    const events = [];
    const edits = [];
    const hits = [];
    const compactions = [];
    const calls = [];
    const prompts = [];
    const quotaLog = [];
    const skills = [];
    const skillSeen = new Set(); // a forked session repeats its parent's skills
    for (const f of files.values()) {
      for (const x of f.skills) {
        const key = `${f.source}:${x[3]}`;
        if (skillSeen.has(key)) continue;
        skillSeen.add(key);
        skills.push({ t: x[0], name: x[1], by: x[2], dir: x[4], rec: f });
      }
      for (const e of f.events) events.push(e);
      for (const q of f.quotaLog || []) quotaLog.push(q);
      for (const e of f.edits) edits.push(e);
      for (const c of f.calls) calls.push(c);
      for (const p of f.prompts) prompts.push(p);
      hits.push(...f.hits);
      compactions.push(...f.compactions);
    }
    events.sort((a, b) => a[0] - b[0]);
    edits.sort((a, b) => a[0] - b[0]);
    calls.sort((a, b) => a.t - b.t);
    prompts.sort((a, b) => a[0] - b[0]);
    hits.sort((a, b) => a.t - b.t);
    compactions.sort((a, b) => a.t - b.t);
    quotaLog.sort((a, b) => a[0] - b[0]);
    skills.sort((a, b) => a.t - b.t);
    Object.assign(cache, { version, events, edits, hits, compactions, calls, prompts, quotaLog, skills });
    return cache;
  }

  /** The main session's record, for titles; falls back to any record of that session. */
  function sessionRecord(session) {
    let fallback = null;
    for (const f of files.values()) {
      if (f.session !== session) continue;
      if (!f.sub) return f;
      fallback ||= f;
    }
    return fallback;
  }

  // Subagents often run inside a subfolder, so they belong to their session's project.
  const projectCache = { version: -1, bySession: new Map() };
  function projectOf(rec) {
    if (projectCache.version !== version) {
      projectCache.version = version;
      projectCache.bySession = new Map();
      for (const f of files.values()) if (!f.sub && f.project) projectCache.bySession.set(f.session, f.project);
    }
    return projectCache.bySession.get(rec.session) || rec.project || 'Unknown';
  }

  const api = {
    scan,
    events: () => merged().events,
    edits: () => merged().edits,
    hits: () => merged().hits,
    compactions: () => merged().compactions,
    calls: () => merged().calls,
    prompts: () => merged().prompts,
    /** Every skill used: { t, name, by: 'you' | 'agent', dir, rec }, oldest first. Commands that aren't skills are in here too, until checked against the skills on offer. */
    skills: () => merged().skills,
    /** The latest list of skills each session was offered: { t, names, about, files?, rec }. */
    skillLists: () => [...files.values()].filter((f) => f.skillList).map((f) => ({ ...f.skillList, rec: f })),
    /** Whether search keeps the conversations' text. Turning it back on reads every transcript again. */
    searchOn: () => textOn,
    setSearch(on) {
      if (on === textOn) return;
      textOn = on;
      // Off: forget the text now. On: the next scan reads every file again for it.
      if (!on) for (const f of files.values()) { f.keepText = false; f.texts = []; f.textSeen = new Set(); }
      version++;
    },
    /** The full text of a message you sent at `t` in `rec`, while search keeps it. */
    youTextAt(rec, t) {
      if (!rec?.texts?.length) return null;
      if (rec.textIndex?.length !== rec.texts.length) rec.textIndex = { length: rec.texts.length, byT: new Map(rec.texts.filter((x) => x[1] === 'you').map((x) => [x[0], x[2]])) };
      return rec.textIndex.byT.get(t) || null;
    },
    /** How much text search holds: messages and characters. */
    searchStats() {
      let messages = 0;
      let chars = 0;
      for (const f of files.values()) for (const x of f.texts) { messages++; chars += x[2].length; }
      return { on: textOn, messages, chars };
    },
    /**
     * Messages with every word of `q` in them (or "a phrase"), from your side
     * and the agents', grouped by session, the latest first. Main sessions only.
     */
    search(q, { source = 'all', limit = 40, perSession = 3 } = {}) {
      const terms = queryTerms(q);
      if (!terms.length || !textOn) return { terms, results: [], total: 0 };
      const bySession = new Map();
      let total = 0;
      for (const f of files.values()) {
        if (f.sub || (source !== 'all' && f.source !== source)) continue;
        for (const [t, who, text] of f.texts) {
          const lower = text.toLowerCase();
          if (!terms.every((term) => lower.includes(term))) continue;
          total++;
          let s = bySession.get(f.session);
          if (!s) bySession.set(f.session, (s = { session: f.session, source: f.source, rec: f, count: 0, lastAt: 0, hits: [] }));
          s.count++;
          s.lastAt = Math.max(s.lastAt, t);
          s.hits.push([t, who, text]);
        }
      }
      const results = [...bySession.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, limit).map((s) => ({
        session: s.session,
        source: s.source,
        title: s.rec.agentName || s.rec.title || s.rec.firstPrompt || null,
        project: projectOf(s.rec),
        count: s.count,
        lastAt: s.lastAt,
        hits: s.hits.sort((a, b) => b[0] - a[0]).slice(0, perSession).map(([t, who, text]) => ({ t, who, text: snippet(text, terms) })),
      }));
      return { terms, results, total, sessions: bySession.size };
    },
    /** Every reading of Codex's plan windows, oldest first: [t, bucket, kind, % used, resets at]. */
    quotaLog: () => merged().quotaLog,
    sessionRecord,
    /** Every record of one session: its main transcript and its subagents'. */
    recordsOf: (session) => [...files.values()].filter((f) => f.session === session || f.id === session),
    projectOf,
    version: () => version,
    ready: () => scanned,
    work: () => [...files.values()].flatMap((f) => f.work.map((w) => ({ ...w, rec: f, sub: f.sub }))),
    /** The latest report of each Codex quota bucket across all sessions, as one set; null before the first. */
    quota() {
      const latest = {};
      for (const f of files.values()) {
        for (const [bucket, q] of Object.entries(f.quotas || {})) if (!latest[bucket] || q.t > latest[bucket].t) latest[bucket] = q;
      }
      const reports = Object.values(latest);
      if (!reports.length) return null;
      return {
        t: Math.max(...reports.map((q) => q.t)),
        value: { rateLimitsByLimitId: Object.fromEntries(Object.entries(latest).map(([bucket, q]) => [bucket, q.value])) },
      };
    },
    /** Every main session of the last 31 days: its folder, first and last activity, and title. */
    sessions() {
      const out = [];
      for (const f of files.values()) {
        if (f.sub) continue;
        const firstAt = Math.min(f.prompts[0]?.[0] ?? Infinity, f.events[0]?.[0] ?? Infinity);
        const lastAt = Math.max(f.prompts[f.prompts.length - 1]?.[0] ?? 0, f.events[f.events.length - 1]?.[0] ?? 0);
        out.push({ id: f.session, nativeId: f.nativeId || f.session, source: f.source, cwd: f.cwd, dir: f.dirName, firstAt: Number.isFinite(firstAt) ? firstAt : null, lastAt: lastAt || null, title: f.agentName || f.title || f.firstPrompt || null, project: projectOf(f) });
      }
      return out;
    },
    scope(source) {
      if (!source || source === 'all') return api;
      if (scoped.has(source)) return scoped.get(source);
      const view = { ...api, source };
      for (const [key, recordOf] of Object.entries({ events: (e) => e[4], edits: (e) => e[3], calls: (e) => e.rec, prompts: (e) => e[1], compactions: (e) => e.rec, work: (e) => e.rec, skills: (e) => e.rec, skillLists: (e) => e.rec })) {
        let v = -1, items = [];
        view[key] = () => { if (v !== version) { items = api[key]().filter((e) => recordOf(e).source === source); v = version; } return items; };
      }
      view.hits = () => source === 'claude' ? api.hits() : [];
      view.sessions = () => api.sessions().filter((s) => s.source === source);
      scoped.set(source, view);
      return view;
    },
  };
  return api;
}
