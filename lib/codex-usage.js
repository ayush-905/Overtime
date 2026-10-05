// Codex transcripts, read two ways: `applyCodexRecord` builds the usage index's
// history (cost, messages, tool calls, edits, working time, recorded quotas),
// and the helpers below are shared with the live watcher in codex.js. Both use
// the session's native id, prefixed `codex-`, so history and live views agree.

import { partsTotal, priceTokens } from './pricing.js';
import { notePrompt } from './titles.js';
import { projectName } from './agents.js';

export const codexId = (id) => (id?.startsWith('codex-') ? id : `codex-${id}`);

/** The thread a subagent was spawned from, if it is one. */
export function codexParent(meta) {
  return meta.parent_thread_id || meta.source?.subagent?.thread_spawn?.parent_thread_id || null;
}

/**
 * One request's tokens, split the way they are billed, and what they would cost
 * at API list prices. Codex counts cached tokens inside input_tokens, and
 * reasoning inside output_tokens.
 */
export function codexUsage(model, u = {}) {
  const read = Math.max(0, u.cached_input_tokens || 0);
  const write = Math.max(0, u.cache_write_input_tokens || 0);
  const fresh = Math.max(0, (u.input_tokens || 0) - read - write);
  const output = Math.max(0, u.output_tokens || 0);
  const parts = priceTokens(model, { fresh, cacheRead: read, write5m: write, output });
  const { plainCached, ...billed } = parts || {};
  return {
    fresh,
    read,
    write,
    output,
    context: Math.max(0, u.input_tokens || 0) + output,
    parts: parts ? billed : null,
    costKnown: !!parts,
    cost: parts ? partsTotal(parts) : null,
    saved: parts ? plainCached - parts.cacheRead - parts.cacheWrite : null,
    writeCost: parts ? parts.cacheWrite : null,
    rebuild: null,
    tokens: fresh + read + write + output,
  };
}

// Setup Codex adds to a conversation, which isn't something you typed.
const INJECTED =
  /^\s*(<environment_context>|<permissions|<turn_aborted>|# AGENTS\.md|<INSTRUCTIONS>|<subagent_notification>|<recommended_plugins>)/i;
// With files attached, the Codex app lists them first and puts your words under this.
const ATTACHED = /^\s*# Files mentioned by the user:[\s\S]*?## My request:\s*/;

/** What you typed in a user message (its first `max` characters), or null for context Codex injected. */
export function codexPrompt(p, max = 90) {
  const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds;
  if (kinds?.length && !kinds.some((k) => k.startsWith('user.'))) return null;
  const blocks = Array.isArray(p.content) ? p.content : [];
  const text = blocks
    .filter((b, i) => !kinds?.length || kinds[i]?.startsWith('user.'))
    .filter((b) => b.type === 'input_text' || b.type === 'text')
    .map((b) => b.text || '')
    .join(' ')
    .replace(ATTACHED, '')
    .trim();
  if (!text || INJECTED.test(text)) return null;
  return text.replace(/\s+/g, ' ').slice(0, max);
}

/** The skills a Codex session was offered, from its instructions: "- name: what it does (file: …/SKILL.md)". */
export function codexSkillList(text) {
  const at = text.indexOf('### Available skills');
  if (at === -1) return null;
  const names = [];
  const about = {};
  const files = {};
  for (const m of text.slice(at).matchAll(/^- (\S{1,120}?): (.*) \(file: ([^\n)]*SKILL\.md)\)\s*$/gm)) {
    if (files[m[1]]) continue;
    names.push(m[1]);
    about[m[1]] = m[2].replace(/\s+/g, ' ').trim().slice(0, 160);
    files[m[1]] = m[3];
  }
  return names.length ? { names, about, files } : null;
}

/** Skills a tool call reads the instructions of (…/name/SKILL.md), by the name they were offered under. */
export function skillReads(raw, list) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
  if (!text.includes('SKILL.md') || text.includes('*** Begin Patch')) return [];
  // Plugins' skills are listed by a path relative to where Codex keeps plugins, and a name like "pdf:pdf".
  const listed = Object.entries(list?.files || {});
  const nameOf = (file, folder) =>
    listed.find(([, f]) => file === f || file.endsWith(`/${f}`))?.[0] ||
    listed.find(([name]) => name === folder || name.split(':').pop() === folder)?.[0] ||
    folder;
  const out = new Map();
  for (const m of text.matchAll(/([^\s"'`()=]*\/([^/\s"'`]+)\/SKILL\.md)/g)) {
    const name = nameOf(m[1], m[2]);
    if (!out.has(name)) out.set(name, m[1]);
  }
  return [...out];
}

/** Files a patch touches, with the lines it adds and removes in each. */
export function patchEdits(raw) {
  const text = String(raw || '').replace(/\\n/g, '\n');
  if (!text.includes('*** Begin Patch')) return [];
  const files = [];
  let edit = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (m) {
      edit = { path: m[1], added: 0, removed: 0 };
      files.push(edit);
    } else if (edit && line.startsWith('+') && !line.startsWith('+++')) edit.added++;
    else if (edit && line.startsWith('-') && !line.startsWith('---')) edit.removed++;
  }
  return files;
}

/**
 * The edits a tool call makes: an apply_patch call, or apply_patch invoked from
 * the desktop app's code tool. A patch quoted in a test, a shell command or a
 * document is not an edit.
 */
export function codexEdits(name, raw) {
  let args = raw;
  if (typeof raw === 'string') {
    try {
      args = JSON.parse(raw);
    } catch {}
  }
  if (/(?:^|[_.])apply_patch$/.test(name || '')) return patchEdits(args?.patch || args?.input || raw);
  const code = typeof args === 'string' ? args : args?.code || '';
  const edits = [];
  for (const m of code.matchAll(/\btools\.apply_patch\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)/g)) {
    if (!m[2].startsWith('*** Begin Patch')) continue;
    let patch = m[2];
    if (m[1] === '"') {
      try {
        patch = JSON.parse(`"${patch}"`);
      } catch {}
    }
    edits.push(...patchEdits(patch));
  }
  return edits;
}

/** The command a Codex tool call ran, to show with the message that set it off. */
export function codexCommand(raw) {
  let args = raw;
  if (typeof raw === 'string') {
    try {
      args = JSON.parse(raw);
    } catch {}
  }
  const cmd = typeof args === 'object' && args ? (args.cmd ?? args.command) : null;
  let line = Array.isArray(cmd) ? cmd.join(' ') : typeof cmd === 'string' ? cmd : null;
  // The desktop app's code tool runs commands from its script: the first one names it.
  if (!line && typeof raw === 'string') line = raw.match(/exec_command\(\{\s*cmd:\s*("(?:\\.|[^"])*")/)?.[1] ?? null;
  if (line?.startsWith('"')) {
    try {
      line = JSON.parse(line);
    } catch {}
  }
  line =
    typeof line === 'string'
      ? line
          .replace(/^\/bin\/(?:ba|z)?sh -lc /, '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  return line ? line.slice(0, 200) : null;
}

/** How a tool call ended: failed, or turned down by you. */
export function codexToolResult(p) {
  const text = typeof p.output === 'string' ? p.output : JSON.stringify(p.output || '');
  const exit = text.match(/(?:Process exited with code|[Ee]xit code:?|"exit_code"\s*:)\s*(\d+)/);
  const denied =
    /^(?:Error: ?)?(?:tool (?:call|execution) (?:was )?)?(?:rejected by (?:the )?user|user (?:denied|rejected)|approval (?:denied|rejected)|permission denied)/i.test(
      text.trim(),
    );
  const error =
    p.is_error === true || !!(exit && +exit[1] !== 0) || /^Error:|Script failed\n|"isError"\s*:\s*true/.test(text);
  return { denied, error, exit };
}

const TOKEN_KEYS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens'];

function startRecord(f, p, ev) {
  const id = p.id || p.session_id;
  if (id) f.id = codexId(id);
  f.nativeId = id;
  f.source = 'codex';
  f.parentId = codexParent(p) ? codexId(codexParent(p)) : null;
  f.sub = !!f.parentId;
  f.session = f.parentId || f.id;
  f.cwd = p.cwd || f.cwd;
  f.project = projectName(f.cwd);
  f.dirName = f.cwd?.replace(/[^a-zA-Z0-9]/g, '-');
  f.modelProvider = p.model_provider || 'openai';
  // A forked chat starts with its parent's history; only what follows is its own.
  f.forkStart = p.forked_from_id ? Date.parse(p.timestamp || ev.timestamp) : null;
}

function addPrompt(f, t, text, full, addText) {
  f.lastPrompt = { t, text };
  f.prompts.push([t, f, f.sub ? 'other' : 'human', text]);
  notePrompt(f, text.slice(0, 70));
  if (full && f.keepText && !f.sub) addText?.(f, t, 'you', full, `u:${t}`);
}

/** One line of a Codex transcript, into the index record `f`; `addText` keeps a message's text for search. */
export function applyCodexRecord(f, ev, addText) {
  const p = ev.payload || {};
  const t = Date.parse(ev.timestamp);
  if (ev.type === 'session_meta') {
    startRecord(f, p, ev);
    return;
  }
  if (!Number.isFinite(t)) return;
  if (f.forkStart && t < f.forkStart) {
    // The parent's history: only its running token total matters, as the baseline.
    const inherited =
      ev.type === 'token_usage_record'
        ? p.thread_token_usage
        : p.type === 'token_count'
          ? p.info?.total_token_usage
          : null;
    if (inherited) f.tokenTotal = inherited;
    if (ev.type === 'turn_context') f.model = p.model || f.model;
    return;
  }
  // The window its model has, as Codex reports it, for how full the conversation is.
  const window = p.info?.model_context_window || p.model_context_window || p.context_window;
  if (window > 0) f.contextWindow = window;
  if (ev.type === 'turn_context') {
    f.model = p.model || f.model;
    return;
  }
  if (ev.type === 'compacted') {
    f.compactions.push({ t, trigger: 'unknown', before: 0, rec: f });
    return;
  }
  const repeat = (text) => f.lastPrompt?.text === text && Math.abs(t - f.lastPrompt.t) < 5000;
  if (ev.type === 'event_msg') {
    if (p.type === 'task_started') {
      f.activeTurn = { start: t, end: t, id: p.turn_id };
      f.work.push(f.activeTurn);
    }
    if (p.type === 'task_complete' || p.type === 'turn_aborted') {
      if (f.activeTurn) {
        f.activeTurn.end = t;
        f.activeTurn.completed = true;
      }
      f.activeTurn = null;
      if (p.type === 'turn_aborted') f.prompts.push([t, f, 'interrupt', null]);
    }
    if (p.type === 'user_message' && p.message) {
      // Newer transcripts write the message twice; the response_item copy is
      // preferred, and this one only counts if no copy follows before the usage.
      const text = String(p.message).replace(/\s+/g, ' ').slice(0, 90);
      if (!repeat(text)) f.pendingPrompt = [t, text, String(p.message)];
    }
    if (p.type === 'token_count' && p.rate_limits) {
      // Codex reports one quota bucket at a time (the usual one, or another such
      // as "premium"); keep the latest report of each that has any windows, and
      // every reading of each window, for its pace.
      const q = p.rate_limits;
      const bucket = q.limit_id || 'codex';
      if (q.primary || q.secondary) f.quotas[bucket] = { t, value: q };
      for (const kind of ['primary', 'secondary']) {
        const used = Number(q[kind]?.used_percent);
        const reset = Number(q[kind]?.resets_at);
        if (Number.isFinite(used) && reset > 0)
          (f.quotaLog ||= []).push([t, bucket, kind, used, reset > 1e10 ? reset : reset * 1000]);
      }
    }
  }
  if (ev.type === 'response_item') {
    if (p.type === 'message' && (p.role === 'developer' || p.role === 'user')) {
      // The skills on offer come with the instructions.
      for (const b of Array.isArray(p.content) ? p.content : []) {
        if (typeof b.text !== 'string' || !b.text.includes('<skills_instructions>')) continue;
        const list = codexSkillList(b.text);
        if (list) f.skillList = { t, ...list };
      }
    }
    if (p.type === 'message' && p.role === 'user') {
      const text = codexPrompt(p);
      if (text && !repeat(text)) {
        addPrompt(f, t, text, codexPrompt(p, Infinity), addText);
        f.pendingPrompt = null;
      }
    }
    if (p.type === 'message' && p.role === 'assistant' && f.keepText && !f.sub) {
      const text = (Array.isArray(p.content) ? p.content : [])
        .filter((b) => b.type === 'output_text' || b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
      if (text.trim()) addText?.(f, t, 'agent', text, p.id || `a:${t}`);
    }
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const id = p.call_id || p.id;
      if (!f.callById.has(id)) {
        const raw = p.input || p.arguments;
        const call = {
          t,
          name: p.name,
          status: 'pending',
          reason: null,
          rec: f,
          edits: codexEdits(p.name, raw),
          file: null,
          what: codexCommand(raw),
        };
        f.callById.set(id, call);
        f.calls.push(call);
        // Reading a skill's instructions is how Codex uses it.
        for (const [name, file] of skillReads(raw, f.skillList))
          f.skills.push([t, name, 'agent', `${id}:${name}`, file]);
      }
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const call = f.callById.get(p.call_id);
      if (call) {
        const { denied, error, exit } = codexToolResult(p);
        call.status = denied ? 'denied' : error ? 'error' : 'ok';
        call.reason = denied
          ? 'Approval denied'
          : error
            ? exit
              ? `Command exited with code ${exit[1]}`
              : 'Tool reported an error'
            : null;
        // A patch only changed files if it went through.
        if (call.status === 'ok')
          for (const e of call.edits || []) f.edits.push([call.t, e.added, e.removed, f, e.path]);
        delete call.edits;
      }
    }
  }
  if (f.activeTurn && (ev.type === 'response_item' || ev.type === 'token_usage_record')) f.activeTurn.end = t;

  // Token usage: newer transcripts write a record per response, older ones a
  // running total; either becomes an increment over what was already counted.
  const isRecord = ev.type === 'token_usage_record';
  const info = ev.type === 'event_msg' && p.type === 'token_count' ? p.info : null;
  if (!isRecord && !info) return;
  if (f.pendingPrompt) {
    addPrompt(f, ...f.pendingPrompt, addText);
    f.pendingPrompt = null;
  }
  const total = isRecord ? p.thread_token_usage : info.total_token_usage;
  let usage;
  if (total) {
    usage = Object.fromEntries(TOKEN_KEYS.map((k) => [k, Math.max(0, (total[k] || 0) - (f.tokenTotal?.[k] || 0))]));
    // A duplicate or late report must not move the running total backwards.
    f.tokenTotal = Object.fromEntries(TOKEN_KEYS.map((k) => [k, Math.max(total[k] || 0, f.tokenTotal?.[k] || 0)]));
  } else if (isRecord && p.response_id && !f.seen.has(p.response_id)) {
    usage = p.usage;
    f.seen.add(p.response_id);
  } else return;
  const d = codexUsage(f.modelProvider === 'openai' ? f.model : null, usage);
  if (!d.tokens) return;
  // How big the conversation is now, which isn't the same as this request's increment.
  d.context = (isRecord ? p.usage?.input_tokens : info.last_token_usage?.input_tokens) || d.context;
  f.events.push([t, d.cost || 0, d.tokens, f.model || 'unknown', f, d]);
  f.lastT = t;
}
