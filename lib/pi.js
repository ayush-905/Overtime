// pi transcripts, followed live: <sessions>/--<folder>--/<time>_<id>.jsonl.
// pi writes a reply once it's finished, with the tool calls in it, and each
// tool's result after it runs, so the office sees each step as it lands.

import path from 'node:path';
import { addUsage, categorize, closeTool, compacted, endTurn, noteCwd, oneLine, setContext, startTool, startTurn, touch } from './agents.js';
import { PI_TURN_ENDS, piEdit, piText, piUsage, piWindow } from './pi-usage.js';

const CATEGORY = { read: 'read', grep: 'search', find: 'search', ls: 'search', bash: 'bash', powershell: 'bash', edit: 'edit', write: 'edit' };

/** An office category and a few words for one of pi's tool calls. */
function classify(name, args = {}) {
  const category = CATEGORY[name] || categorize(name).key;
  let detail = '';
  if (name === 'bash' || name === 'powershell') detail = oneLine(args.command, 60);
  else if (name === 'grep') detail = oneLine(`"${args.pattern ?? ''}"`, 60);
  else if (name === 'find') detail = oneLine(args.pattern, 60);
  else if (name === 'ls') detail = args.path ? path.basename(String(args.path)) : 'the folder';
  else if (typeof args.path === 'string') detail = path.basename(args.path);
  else if (typeof args.url === 'string') detail = oneLine(args.url, 60);
  return { category, detail };
}

function count(a, t, usage) {
  const d = piUsage(a.model, usage);
  addUsage(a, t, { input: d.fresh, output: d.output, cacheRead: d.read, write5m: d.write - d.write1h, write1h: d.write1h }, d.cost);
  return d;
}

export function applyPiEvent(feed, a, ev) {
  const t = ev.timestamp ? Date.parse(ev.timestamp) : null;
  // Each entry once: Pi rewrites a whole file when it brings an old one up to date.
  if (ev.id) {
    if (a.seenMessages.has(ev.id)) return;
    a.seenMessages.add(ev.id);
  }
  switch (ev.type) {
    case 'session':
      a.nativeId = ev.id;
      a.entrypoint = 'pi';
      noteCwd(a, ev.cwd);
      a.forkStart = ev.parentSession ? t : null;
      return;
    case 'session_info':
      a.title = typeof ev.name === 'string' && ev.name.trim() ? ev.name.trim() : null;
      return;
    case 'model_change':
      a.model = ev.modelId || a.model;
      a.provider = ev.provider || a.provider;
      return;
  }
  // A fork's copy of the conversation it came from isn't its own work.
  if (a.forkStart && t && t < a.forkStart) return;
  if (ev.type === 'compaction') {
    compacted(feed, a, t);
    if (ev.usage) count(a, t, ev.usage);
  } else if (ev.type === 'branch_summary' || ev.type === 'usage') {
    if (ev.usage) count(a, t, ev.usage);
  } else if (ev.type === 'message' && ev.message) {
    const m = ev.message;
    if (m.role === 'user') startTurn(feed, a, t, piText(m.content));
    else if (m.role === 'assistant') {
      a.model = m.model || a.model;
      a.provider = m.provider || a.provider;
      if (m.usage) {
        const d = count(a, t, m.usage);
        if (d.context) setContext(a, d.context, piWindow(a.provider, a.model, Math.max(d.context, a.context.used)));
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type === 'thinking') a.status = 'thinking';
        else if (b?.type === 'text' && b.text?.trim()) {
          a.status = 'replying';
          a.snippet = oneLine(b.text, 160);
        } else if (b?.type === 'toolCall' && b.id) {
          const args = b.arguments || {};
          const { category, detail } = classify(b.name, args);
          startTool(feed, a, { id: b.id, name: b.name, category, detail, t, edit: piEdit(b.name, args, a.startCwd || a.cwd) });
        }
      }
      if (PI_TURN_ENDS.has(m.stopReason)) endTurn(feed, a, t, m.stopReason === 'aborted' ? 'interrupted' : 'done');
    } else if (m.role === 'toolResult') {
      closeTool(a, m.toolCallId, t, { error: m.isError === true });
      if (m.usage) count(a, t, m.usage);
      a.status = a.pending.size ? 'working' : 'thinking';
    }
  }
  touch(a, t);
}
