// Claude Code transcripts: ~/.claude/projects/<project>/<session>.jsonl, with
// subagents in <project>/<session>/subagents/agent-<id>.jsonl.

import path from 'node:path';
import {
  addUsage,
  closeTool,
  compacted,
  endTurn,
  hostOf,
  noteCwd,
  oneLine,
  resumeTurn,
  setContext,
  startTool,
  startTurn,
  touch,
} from './agents.js';
import { contextUsed, contextWindow, usageCost, usageTokens } from './pricing.js';

const END_REASONS = new Set(['end_turn', 'stop_sequence', 'refusal']);
const NOT_A_TURN =
  /^<(local-command-stdout|local-command-caveat|local-command-stderr|bash-input|bash-stdout|bash-stderr)>/;
export const REJECTED = /doesn't want to proceed|was rejected|user denied|permission to use .* was denied/i;

function lineCount(text) {
  if (!text) return 0;
  const s = String(text);
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}

function describe(name, input) {
  const file = input.file_path || input.notebook_path || input.path;
  switch (name) {
    case 'Bash':
      return oneLine(input.description || input.command, 60);
    case 'Grep':
      return oneLine(`"${input.pattern ?? ''}"`, 60);
    case 'Glob':
      return oneLine(input.pattern, 60);
    case 'WebFetch':
      return hostOf(input.url);
    case 'WebSearch':
      return oneLine(input.query, 60);
    case 'Agent':
    case 'Task':
      return oneLine(input.description || input.subagent_type, 60);
    case 'Skill':
      return oneLine(input.skill, 60);
    case 'AskUserQuestion':
      return oneLine(input.questions?.[0]?.question, 60);
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const current = todos.find((t) => t.status === 'in_progress');
      return oneLine(current ? current.activeForm || current.content : `${todos.length} todos`, 60);
    }
    case 'ExitPlanMode':
      return 'plan ready for review';
    case 'SubagentHandback':
      return '';
  }
  if (/browser|chrome|playwright|puppeteer/i.test(name)) {
    const url = input.url || (Array.isArray(input.actions) && input.actions.find((x) => x?.input?.url)?.input.url);
    return url ? hostOf(url) : 'a web page';
  }
  if (file) return path.basename(String(file));
  if (input.url) return hostOf(input.url);
  if (input.title) return oneLine(input.title, 60);
  return name.startsWith('mcp__') ? name.split('__').pop().replace(/_/g, ' ') : '';
}

/** Rough lines added and removed by a file-editing tool call. */
function editDelta(name, input) {
  const file = input.file_path || input.notebook_path;
  if (!file) return null;
  switch (name) {
    case 'Edit':
      return { path: file, added: lineCount(input.new_string), removed: lineCount(input.old_string) };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return {
        path: file,
        added: edits.reduce((n, e) => n + lineCount(e.new_string), 0),
        removed: edits.reduce((n, e) => n + lineCount(e.old_string), 0),
      };
    }
    case 'Write':
      return { path: file, added: lineCount(input.content), removed: 0 };
    case 'NotebookEdit':
      return { path: file, added: lineCount(input.new_source), removed: 0 };
  }
  return null;
}

export function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => x?.text || '').join(' ');
  return '';
}

function onUser(feed, a, ev, t) {
  const content = ev.message?.content;
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) {
    for (const b of content) {
      if (b.type !== 'tool_result') continue;
      const error = b.is_error === true;
      closeTool(a, b.tool_use_id, t, { error, rejected: error && REJECTED.test(resultText(b)) });
    }
    a.status = a.pending.size ? 'working' : 'thinking';
    touch(a, t);
    return;
  }
  if (ev.isMeta) return;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
        : '';
  if (/^\s*\[Request interrupted by user/.test(text)) {
    endTurn(feed, a, t, 'interrupted');
    touch(a, t);
    return;
  }
  if (NOT_A_TURN.test(text)) return;
  startTurn(feed, a, t, text.replace(/<[^>]+>/g, ' '));
  touch(a, t);
}

function onAssistant(feed, a, ev, t) {
  const m = ev.message || {};
  if (m.model && m.model !== '<synthetic>') a.model = m.model;

  // Claude Code writes one line per content block, all repeating the message's usage.
  const key = m.id || ev.requestId;
  // A new message after the turn ended means the agent was woken without a
  // prompt of its own (a background task finished, a hook fired, and so on).
  if (a.turnEnded && key && key !== a.endedMessage && m.model !== '<synthetic>') resumeTurn(feed, a, t);
  if (m.usage && key && !a.seenMessages.has(key)) {
    a.seenMessages.add(key);
    addUsage(a, t, usageTokens(m.usage), usageCost(a.model, m.usage));
    if (!ev.isSidechain || a.kind === 'sub') {
      const used = contextUsed(m.usage);
      setContext(a, used, contextWindow(a.model, Math.max(used, a.context.used)));
    }
  }

  for (const b of Array.isArray(m.content) ? m.content : []) {
    if (b.type === 'thinking' || b.type === 'redacted_thinking') a.status = 'thinking';
    else if (b.type === 'text' && b.text?.trim()) {
      a.status = 'replying';
      a.snippet = oneLine(b.text, 160);
    } else if (b.type === 'tool_use') {
      const input = b.input || {};
      startTool(feed, a, {
        id: b.id,
        name: b.name,
        detail: describe(b.name, input),
        t,
        edit: editDelta(b.name, input),
      });
    }
  }
  if ((END_REASONS.has(m.stop_reason) || m.model === '<synthetic>') && a.pending.size === 0) {
    endTurn(feed, a, t);
    a.endedMessage = key;
  }
  touch(a, t);
}

export function applyClaudeEvent(feed, a, ev) {
  const t = ev.timestamp ? Date.parse(ev.timestamp) : null;
  noteCwd(a, ev.cwd);
  if (ev.gitBranch && ev.gitBranch !== 'HEAD') a.branch = ev.gitBranch;
  if (ev.entrypoint) a.entrypoint = ev.entrypoint;
  switch (ev.type) {
    // The title you gave it, else the one Claude Code wrote for it.
    case 'custom-title':
      a.customTitle = ev.customTitle || a.customTitle;
      a.title = a.customTitle || a.aiTitle;
      return;
    case 'ai-title':
      a.aiTitle = ev.aiTitle || a.aiTitle;
      a.title = a.customTitle || a.aiTitle;
      return;
    case 'agent-name':
      a.agentName = ev.agentName || a.agentName;
      return;
    case 'cost-state':
      if (typeof ev.totalCostUSD === 'number') a.costState = ev.totalCostUSD;
      if (typeof ev.totalLinesAdded === 'number')
        a.linesState = { added: ev.totalLinesAdded, removed: ev.totalLinesRemoved || 0 };
      return;
    case 'user':
      onUser(feed, a, ev, t);
      return;
    case 'assistant':
      onAssistant(feed, a, ev, t);
      return;
    case 'system':
      if (ev.subtype === 'compact_boundary') compacted(feed, a, t);
      else if (ev.subtype === 'stop_hook_summary' && a.status !== 'working') endTurn(feed, a, t);
      touch(a, t);
      return;
    default:
      touch(a, t);
  }
}
