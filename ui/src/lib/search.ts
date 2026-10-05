// Finding things: the words of a search (as the server reads them), where they
// fall in a piece of text, and how well a name matches what you typed in ⌘K.

/** A query as the words (or "quoted phrases") every match must have, as the server reads it. */
export function queryTerms(q: string | null | undefined) {
  const terms: string[] = [];
  for (const m of String(q || '')
    .toLowerCase()
    .matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term) terms.push(term);
  }
  return terms.slice(0, 8);
}

/** Text in pieces, each marked if it's one of the terms: for <mark>ing matches. */
export function highlightParts(text: string | null | undefined, terms: string[]): { text: string; mark: boolean }[] {
  const t = String(text || '');
  if (!terms.length) return [{ text: t, mark: false }];
  const lower = t.toLowerCase();
  const marks: [number, number][] = [];
  for (const term of terms) {
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + term.length))
      marks.push([i, i + term.length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at) continue;
    if (a > at) out.push({ text: t.slice(at, a), mark: false });
    out.push({ text: t.slice(a, b), mark: true });
    at = b;
  }
  if (at < t.length) out.push({ text: t.slice(at), mark: false });
  return out;
}

/** How well `text` matches the query: a start beats a word's start beats anywhere; 0 is no match. */
export function score(text: string | null | undefined, q: string) {
  const t = String(text || '').toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 4;
  if (t.includes(` ${q}`) || t.includes(`-${q}`)) return 3;
  if (t.includes(q)) return 2;
  // Letters in order, like "rsh" for "recipe search", only once there are enough of them to mean something.
  if (q.length < 3) return 0;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}
