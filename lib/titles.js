// What a session is called, when you haven't named it here: the name you gave it
// in Claude Code (/rename) or Codex, else the one the app wrote for it (Claude
// Code's ai-title, Codex's thread name), else your first message, passing over
// one too slight to go by ("hi", "ok", "continue") when a later one says more.

import { promises as fsp } from 'node:fs';
import path from 'node:path';

const SLIGHT = /^(?:hi+|hey+|hello+|hiya|yo|sup|test(?:ing)?|ok(?:ay)?|thanks?|thank you|continue|go on|go ahead|yes|no)[\s!.?]*$/i;

/** A message that says nothing about the work. */
export const isSlight = (text) => SLIGHT.test(String(text || '').trim());

/**
 * Keep `text` as `x.firstPrompt`, what the session is called without a title: the
 * first message, or the first after only slight ones.
 */
export function notePrompt(x, text) {
  if (!text || (x.firstPrompt && !x.slightPrompt)) return;
  const slight = isSlight(text);
  if (x.firstPrompt && slight) return;
  x.firstPrompt = text;
  x.slightPrompt = slight;
}

/**
 * Codex's names for its chats, from session_index.jsonl beside its sessions
 * folder: a line for each name it gave or you gave, the latest last. Read again
 * only when the file changes; `refresh()` says whether it did.
 */
export function createCodexNames(codexDir) {
  const file = codexDir ? path.join(path.dirname(codexDir), 'session_index.jsonl') : null;
  let names = new Map();
  let seen = '';
  return {
    async refresh() {
      if (!file) return false;
      const st = await fsp.stat(file).catch(() => null);
      const stamp = st ? `${st.size}:${st.mtimeMs}` : '';
      if (stamp === seen) return false;
      seen = stamp;
      const next = new Map();
      const text = st ? await fsp.readFile(file, 'utf8').catch(() => '') : '';
      for (const line of text.split('\n')) {
        let x;
        try { x = JSON.parse(line); } catch { continue; }
        const name = typeof x?.thread_name === 'string' ? x.thread_name.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
        if (!x?.id || !name) continue;
        const at = Date.parse(x.updated_at) || 0;
        if (!next.has(x.id) || at >= next.get(x.id).at) next.set(x.id, { name, at });
      }
      names = next;
      return true;
    },
    /** The name of the chat with Codex's own id, or null. */
    get: (nativeId) => names.get(nativeId)?.name || null,
  };
}
