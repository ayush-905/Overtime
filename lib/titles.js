// What a session is called, when you haven't named it here: the name you gave it
// in Claude Code (/rename) or Codex, else the one the app wrote for it (Claude
// Code's ai-title, Codex's thread name, the name you gave a Pi session with /name),
// else your first message, passing over one too slight to go by ("hi", "ok",
// "exit") when a later one says more, and never one that's only punctuation (".").
// Codex keeps its chats' names in a file of their own, read by its harness
// (lib/harnesses/codex.js).

const SLIGHT =
  /^(?:hi+|hey+|hello+|hiya|yo|sup|test(?:ing)?|ok(?:ay)?|thanks?|thank you|continue|go on|go ahead|yes|no|\/?(?:exit|quit|bye))[\s!.?]*$/i;
// No letters or digits at all, like "." sent to see if it's working.
const EMPTY = /^[^\p{L}\p{N}]*$/u;

/** A message that says nothing about the work. */
export const isSlight = (text) => SLIGHT.test(String(text || '').trim());

/**
 * Keep `text` as `x.firstPrompt`, what the session is called without a title: the
 * first message, or the first after only slight ones.
 */
export function notePrompt(x, text) {
  if (!text || EMPTY.test(text) || (x.firstPrompt && !x.slightPrompt)) return;
  const slight = isSlight(text);
  if (x.firstPrompt && slight) return;
  x.firstPrompt = text;
  x.slightPrompt = slight;
}
