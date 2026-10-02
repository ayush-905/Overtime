// Codex transcripts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Tool calls are usually a small script run through an `exec` tool, so the
// activity is worked out from the commands and patches inside it.

import path from 'node:path';
import { closeTool, endTurn, noteCwd, oneLine, setContext, startTool, startTurn, touch, day } from './agents.js';
import { codexId, codexParent, codexPrompt, codexEdits, codexToolResult } from './codex-usage.js';
import { notePrompt } from './titles.js';

const READ_CMD = /^(cat|sed -n|head|tail|wc|ls|tree|pwd|less|bat|git (log|show|diff|status|blame))\b/;
const SEARCH_CMD = /^(rg|grep|find|fd|ag|ack)\b/;
const WEB_CMD = /^(curl|wget|http|xh)\b/;

function firstCommand(text) {
  const m = text.match(/\b(?:cmd|command)\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/s);
  if (m) return m[2].replace(/\\n/g, ' ').replace(/\\(["'`])/g, '$1');
  return null;
}

/** Map one Codex tool call to an office category, detail and optional edit. */
function classify(name, raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  if (name === 'update_plan') return { category: 'plan', detail: 'updating the plan' };
  if (name === 'view_image') return { category: 'read', detail: 'an image' };
  if (name === 'web_search') return { category: 'web', detail: oneLine(raw?.query || 'searching', 60) };
  const edit = codexEdits(name, raw)[0];
  if (edit) {
    return { category: 'edit', detail: edit ? path.basename(edit.path) : 'a patch', edit };
  }
  let cmd = firstCommand(text);
  if (!cmd && name === 'shell') {
    try { cmd = [].concat(JSON.parse(text).command || []).join(' '); } catch {}
  }
  if (!cmd) return { category: 'bash', detail: 'a script' };
  const clean = cmd.replace(/^bash -lc\s+/, '').trim();
  const category = SEARCH_CMD.test(clean) ? 'search' : READ_CMD.test(clean) ? 'read' : WEB_CMD.test(clean) ? 'web' : 'bash';
  return { category, detail: oneLine(clean, 60) };
}

function textOf(content) {
  return (Array.isArray(content) ? content : [])
    .map((c) => c?.text || '')
    .filter(Boolean);
}

export function applyCodexEvent(feed, a, ev) {
  const t = ev.timestamp ? Date.parse(ev.timestamp) : null;
  const p = ev.payload || {};
  switch (ev.type) {
    case 'session_meta':
      a.nativeId = p.id || p.session_id;
      if (codexParent(p)) { a.kind = 'sub'; a.parentId = codexId(codexParent(p)); }
      noteCwd(a, p.cwd);
      a.branch = p.git?.branch || a.branch;
      a.entrypoint = 'codex';
      if (p.context_window) a.context.window = p.context_window;
      break;
    case 'turn_context':
      noteCwd(a, p.cwd);
      a.model = p.model || a.model;
      break;
    case 'event_msg':
      if (p.type === 'task_started') {
        startTurn(feed, a, t);
        if (p.model_context_window) a.context.window = p.model_context_window;
      } else if (p.type === 'task_complete') {
        if (p.last_agent_message) a.snippet = oneLine(p.last_agent_message, 160);
        endTurn(feed, a, t);
      } else if (p.type === 'turn_aborted') {
        endTurn(feed, a, t, 'interrupted');
      } else if (p.type === 'token_count' && p.info) {
        const last = p.info.last_token_usage || {};
        const total = p.info.total_token_usage || {};
        const used = (last.input_tokens || 0) + (last.output_tokens || 0);
        const window = p.info.model_context_window || a.context.window || 272_000;
        if (used) setContext(a, used, window);
        const before = a.tokens.input + a.tokens.output + a.tokens.cacheRead;
        a.tokens.input = Math.max(0, (total.input_tokens || 0) - (total.cached_input_tokens || 0));
        a.tokens.cacheRead = total.cached_input_tokens || 0;
        a.tokens.output = total.output_tokens || 0;
        const after = a.tokens.input + a.tokens.output + a.tokens.cacheRead;
        if (after > before) day(a, t).tokens += after - before;
      }
      break;
    case 'response_item':
      if (p.type === 'reasoning') a.status = 'thinking';
      else if (p.type === 'message' && p.role === 'assistant') {
        const text = textOf(p.content).join(' ');
        if (text) {
          a.status = 'replying';
          a.snippet = oneLine(text, 160);
        }
      } else if (p.type === 'message' && p.role === 'user') {
        const prompt = codexPrompt(p);
        if (prompt) notePrompt(a, oneLine(prompt, 70));
      } else if ((p.type === 'custom_tool_call' || p.type === 'function_call') && p.name !== 'wait') {
        const { category, detail, edit } = classify(p.name, p.input ?? p.arguments);
        startTool(feed, a, { id: p.call_id || p.id, name: p.name, category, detail, t, edit });
      } else if (p.type === 'web_search_call') {
        startTool(feed, a, { id: p.id, name: 'web_search', category: 'web', detail: oneLine(p.action?.query || 'searching', 60), t });
        closeTool(a, p.id, t);
      } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
        const { error, denied } = codexToolResult(p);
        closeTool(a, p.call_id, t, { error: error || denied, rejected: denied });
        a.status = a.pending.size ? 'working' : 'thinking';
      }
      break;
  }
  touch(a, t);
}
