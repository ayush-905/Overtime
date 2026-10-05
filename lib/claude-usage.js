// Claude Code transcripts, read for the usage index: `applyClaudeLine` turns one
// line into the record's history (cost, messages, tool calls, edits, skills,
// compactions, plan-limit hits). The live view is claude.js.

import { REJECTED, resultText } from './claude.js';
import { projectName } from './agents.js';
import { cacheEffect, contextUsed, costParts, usageCost, usageTokens } from './pricing.js';
import { failReason, shellInfo } from './tool-failures.js';
import { notePrompt } from './titles.js';

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const CACHE_EXPIRY_MS = 5 * 60_000; // the default cache lifetime
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
    if (name)
      about[name] = line
        .slice(name.length + 2)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
  }
  return { names, about };
}

function lineCount(text) {
  if (!text) return 0;
  const s = String(text);
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
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
    case 'Edit':
      return [lineCount(input.new_string), lineCount(input.old_string)];
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return [
        edits.reduce((n, e) => n + lineCount(e.new_string), 0),
        edits.reduce((n, e) => n + lineCount(e.old_string), 0),
      ];
    }
    case 'Write':
      return [lineCount(input.content), 0];
    case 'NotebookEdit':
      return [lineCount(input.new_source), 0];
  }
  return [0, 0];
}

// Lines worth parsing; the rest (tool results that went fine, bookkeeping) are skipped unread.
const interesting = (line) =>
  line.includes('"usage"') ||
  line.includes('quotaLimits') ||
  line.includes('"custom-title"') ||
  line.includes('"ai-title"') ||
  line.includes('compact_boundary') ||
  line.includes('"agent-name"') ||
  line.includes('"is_error":true') ||
  line.includes('"skill_listing"') ||
  (line.includes('"type":"user"') && !line.includes('"tool_result"'));

/** One line of a Claude Code transcript, into the index record `f`; `addText` keeps a message's text for search. */
export function applyClaudeLine(f, line, addText) {
  if (!interesting(line)) return;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
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
    return;
  }
  // Your messages, notices and compactions count once, however often they're written.
  if ((ev.type === 'user' || ev.type === 'system') && ev.uuid) {
    if (f.lineSeen.has(ev.uuid)) return;
    f.lineSeen.add(ev.uuid);
  }
  if (ev.type === 'agent-name') {
    f.agentName = ev.agentName || f.agentName;
    return;
  }
  const t = ev.timestamp ? Date.parse(ev.timestamp) : null;
  // The skills this session was offered; a later listing only adds to the first.
  if (ev.type === 'attachment' && ev.attachment?.type === 'skill_listing') {
    const listed = skillListing(ev.attachment);
    if (ev.attachment.isInitial !== false || !f.skillList) f.skillList = { t, ...listed };
    else
      f.skillList = {
        t,
        names: [...new Set([...f.skillList.names, ...listed.names])],
        about: { ...f.skillList.about, ...listed.about },
      };
    return;
  }
  if (ev.type === 'user') {
    const c = ev.message?.content;
    const raw =
      typeof c === 'string'
        ? c
        : Array.isArray(c)
          ? c
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join(' ')
          : '';
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
      const result = resultText(b);
      if (REJECTED.test(result)) {
        call.status = 'denied';
        continue;
      }
      const reason = failReason(call, result);
      if (reason === null) continue;
      call.status = 'error';
      call.reason = reason || null;
    }
    // A message starts a stretch of work: one from you, an interruption, or
    // something else like a background task finishing (or a subagent's task).
    if (!ev.isMeta && !ev.isCompactSummary) {
      const clean = raw
        .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const interrupt = clean.startsWith('[Request interrupted');
      if (clean && t) {
        const origin = ev.origin?.kind;
        const kind = interrupt
          ? 'interrupt'
          : origin === 'human' || (!origin && !ev.isVisibleInTranscriptOnly)
            ? 'human'
            : 'other';
        f.prompts.push([t, f, kind, kind === 'human' ? clean.slice(0, 90) : null]);
        if (kind === 'human' && f.keepText && !f.sub) addText?.(f, t, 'you', clean, ev.uuid);
      }
      if (clean && !interrupt) notePrompt(f, clean.slice(0, 70));
    }
  }
  if (!t) return;
  const q = ev.quotaLimits;
  if (q && q.status === 'rejected' && q.resetsAt && !f.hits.some((h) => h.t === t)) {
    f.hits.push({
      t,
      type: q.rateLimitType || 'five_hour',
      resetsAt: q.resetsAt > 1e10 ? q.resetsAt : q.resetsAt * 1000,
    });
  }
  if (ev.type === 'system' && ev.subtype === 'compact_boundary') {
    const meta = ev.compactMetadata || {};
    f.compactions.push({ t, trigger: meta.trigger || 'auto', before: meta.preTokens || 0, rec: f });
    return;
  }
  const m = ev.message;
  if (ev.type !== 'assistant' || !m || m.model === '<synthetic>') return;
  // Each content block is its own line, so edits are read from every line…
  for (const b of Array.isArray(m.content) ? m.content : []) {
    // A tool call counts once, by its id, and so do the lines its edit changed.
    if (b.type === 'tool_use' && b.id && !f.callById.has(b.id)) {
      const shell = b.name === 'Bash' ? shellInfo(b.input?.command) : {};
      const { file, what } = callSubject(b.name, b.input);
      const call = {
        t,
        name: b.name,
        program: shell.program || null,
        simple: !!shell.simple,
        status: 'ok',
        reason: null,
        rec: f,
        file,
        what,
      };
      f.calls.push(call);
      f.callById.set(b.id, call);
      // A skill the agent chose to use.
      if (b.name === 'Skill' && typeof b.input?.skill === 'string')
        f.skills.push([t, b.input.skill.replace(/^\//, '').slice(0, 120), 'agent', b.id, null]);
      if (EDIT_TOOLS.has(b.name)) {
        const [added, removed] = editLines(b.name, b.input);
        if (added || removed) f.edits.push([t, added, removed, f, file]);
      }
    }
    if (b.type === 'text' && f.keepText && !f.sub)
      addText?.(f, t, 'agent', b.text, `${m.id}:${String(b.text || '').slice(0, 40)}`);
  }
  // …but the usage they repeat is counted once per message.
  if (!m.usage) return;
  const key = m.id || ev.requestId;
  if (key) {
    if (f.seen.has(key)) return;
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
  const rebuild =
    write > 20_000 && write > (write + u.cacheRead + u.input) / 2
      ? !f.lastT
        ? 'start'
        : t - f.lastT > CACHE_EXPIRY_MS
          ? 'pause'
          : 'other'
      : null;
  f.lastT = t;
  const detail = {
    read: u.cacheRead,
    write,
    fresh: u.input,
    output: u.output,
    saved,
    writeCost,
    context: contextUsed(m.usage),
    rebuild,
    costKnown: cost != null,
    parts: costParts(m.model, m.usage),
  };
  if (tokens || cost) f.events.push([t, cost || 0, tokens, m.model || 'unknown', f, detail]);
}
