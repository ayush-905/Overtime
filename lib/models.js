// Every model Overtime knows by name, in one place: who makes it, what to call
// it, and its API list prices in USD per million tokens. Prices are for the
// harnesses that don't record a cost themselves (Claude Code and Codex; Pi
// prices each request itself). A model that isn't here still counts toward
// tokens and time, with its cost left out.
//
// Context windows are mostly not here, since they differ by plan and harness:
// Codex records its own and Pi keeps its own. Claude Code records none, so the
// Anthropic rows carry each model's documented window, which Overtime raises to
// 1M when a session goes past it.
//
// Adding a model is a row. Adding a provider is a family: how to read its ids
// (one model is spelled differently by Claude Code, Bedrock, Vertex, OpenRouter
// and Copilot), its rows, and which pricing rule in pricing.js it follows.

/** `name` is what the dashboard calls it; the rest are the family's columns, per million tokens. */
const rows = (columns, list) => list.map((values) => Object.fromEntries(columns.map((c, i) => [c, values[i]])));

export const FAMILIES = [
  {
    provider: 'openai',
    // Cache writes have their own price where one is listed (null: none listed, so
    // a request that writes the cache is left unpriced); past `longFrom` tokens of
    // input, the whole request costs 2x for input and 1.5x for output.
    rule: 'openai',
    // gpt-6.1-sol, gpt-6.1-sol-2026-09-30, openai/gpt-6.1-sol
    key: (id) => id.replace(/^openai\//, '').replace(/-\d{4}-\d{2}-\d{2}$/, ''),
    // Checked 2026-09-30: https://developers.openai.com/api/docs/pricing and model
    // pages at https://developers.openai.com/api/docs/models/<name> (older ones too).
    models: rows(['key', 'name', 'input', 'cacheRead', 'output', 'cacheWrite', 'longFrom'], [
      ['gpt-6-astra', 'GPT-6 Astra', 10, 1, 50, 12.5, 272_000],
      ['gpt-6.1-sol', 'GPT-6.1 Sol', 2, 0.1, 10, 2.5, 272_000],
      ['gpt-6-sol', 'GPT-6 Sol', 2, 0.2, 10, 2.5, 272_000],
      ['gpt-6-luna', 'GPT-6 Luna', 0.1, 0.01, 0.5, 0.125, 272_000],
      ['gpt-5.6-sol', 'GPT-5.6 Sol', 4, 0.4, 20, 5, 272_000],
      ['gpt-5.6', 'GPT-5.6', 4, 0.4, 20, 5, 272_000], // documented Sol alias
      ['gpt-5.6-terra', 'GPT-5.6 Terra', 2, 0.2, 12, 2.5, 272_000],
      ['gpt-5.6-luna', 'GPT-5.6 Luna', 0.2, 0.02, 1.2, 0.25, 272_000],
      ['gpt-5.6-cyber', 'GPT-5.6 Cyber', 12.5, 1.25, 75, 15.625, Infinity],
      ['gpt-5.5', 'GPT-5.5', 5, 0.5, 30, null, 272_000],
      ['gpt-5.4', 'GPT-5.4', 2.5, 0.25, 15, null, 272_000],
      ['gpt-5.4-mini', 'GPT-5.4 Mini', 0.75, 0.075, 4.5, null, Infinity],
      ['gpt-5.4-nano', 'GPT-5.4 Nano', 0.2, 0.02, 1.25, null, Infinity],
      ['gpt-5.3-codex', 'GPT-5.3 Codex', 1.75, 0.175, 14, null, Infinity],
      ['chat-latest', 'ChatGPT (latest)', 5, 0.5, 30, null, Infinity],
    ]),
  },
  {
    provider: 'anthropic',
    // Cache writes cost 1.25x input for the 5-minute lifetime and 2x for the hour;
    // `fast` models cost double in fast mode; web searches are $0.01 each.
    rule: 'anthropic',
    // claude-opus-4-5, claude-opus-4-5-20251101, claude-opus-4-5[1m] (Claude Code),
    // us.anthropic.claude-opus-4-5-20251101-v1:0 (Bedrock), claude-opus-4-5@20251101
    // (Vertex), anthropic/claude-opus-4.5 (OpenRouter), claude-opus-4.5 (Copilot): all opus-4-5.
    key: (id) => id
      .replace(/^anthropic\//, '')
      .replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '')
      .replace(/-v\d+(?::\d+)?$/, '')
      .replace(/@\d{8}$/, '')
      .replace(/\[1m\]$/i, '')
      .replace(/-(?:\d{8}|latest)$/, '')
      .replace(/^claude-/, '')
      .replace(/(\d)\.(\d)/g, '$1-$2'),
    // Checked 2026-09-30: https://platform.claude.com/docs/en/about-claude/pricing
    models: rows(['key', 'name', 'input', 'output', 'cacheRead', 'window', 'fast'], [
      ['fable-5-1', 'Fable 5.1', 10, 50, 0.25, 1_000_000],
      ['mythos-5-1', 'Mythos 5.1', 10, 50, 0.25, 1_000_000],
      ['fable-5', 'Fable 5', 10, 50, 1.0, 1_000_000],
      ['mythos-5', 'Mythos 5', 10, 50, 1.0, 1_000_000],
      ['opus-5-5', 'Opus 5.5', 4, 20, 0.2, 1_000_000, true],
      ['opus-5', 'Opus 5', 5, 25, 0.5, 1_000_000, true],
      ['opus-4-8', 'Opus 4.8', 5, 25, 0.5, 1_000_000, true],
      ['opus-4-7', 'Opus 4.7', 5, 25, 0.5, 1_000_000],
      ['opus-4-6', 'Opus 4.6', 5, 25, 0.5, 1_000_000],
      ['opus-4-5', 'Opus 4.5', 5, 25, 0.5, 200_000],
      ['opus-4-1', 'Opus 4.1', 15, 75, 1.5, 200_000],
      ['opus-4', 'Opus 4', 15, 75, 1.5, 200_000],
      ['sonnet-5-5', 'Sonnet 5.5', 2, 10, 0.2, 1_000_000],
      ['sonnet-5', 'Sonnet 5', 2, 10, 0.2, 1_000_000],
      ['sonnet-4-6', 'Sonnet 4.6', 3, 15, 0.3, 1_000_000],
      ['sonnet-4-5', 'Sonnet 4.5', 3, 15, 0.3, 200_000],
      ['sonnet-4', 'Sonnet 4', 3, 15, 0.3, 200_000],
      ['haiku-4-5', 'Haiku 4.5', 1, 5, 0.1, 200_000],
      ['3-5-haiku', 'Haiku 3.5', 0.8, 4, 0.08, 200_000],
    ]),
    // A version the table doesn't list yet is named like its siblings: opus-6-1 → Opus 6.1.
    name: (key) => {
      const m = key.match(/^([a-z]+)-(\d+)(?:-(\d+))?$/);
      return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : null;
    },
  },
];

for (const f of FAMILIES) f.byKey = new Map(f.models.map((m) => [m.key, m]));

/** The catalog's row for a model id, with its family; null for a model it doesn't know. */
export function findModel(id) {
  if (!id) return null;
  for (const family of FAMILIES) {
    const row = family.byKey.get(family.key(String(id)));
    if (row) return { family, row };
  }
  return null;
}

// Names worked out before, by id: the insights ask for one per request, every pass,
// and the catalog doesn't change while the server runs.
const names = new Map();

/**
 * What the dashboard calls a model: the catalog's name, else one made from its
 * id that keeps the whole version (gemini-2.5-pro → Gemini 2.5 Pro, never just
 * "Gemini 2"). "unknown" stays as it is: it marks usage with no model.
 */
export function modelName(id) {
  let name = names.get(id);
  if (name === undefined) {
    name = nameOf(id);
    if (names.size > 1000) names.clear();
    names.set(id, name);
  }
  return name;
}

function nameOf(id) {
  if (!id || id === 'unknown') return 'unknown';
  const found = findModel(id);
  if (found) return found.row.name;
  for (const family of FAMILIES) {
    const name = family.name?.(family.key(String(id)));
    if (name) return name;
  }
  // A provider's own prefix (openrouter's vendor/, Bedrock's region.vendor.) and a dated snapshot say nothing about the model.
  const bare = String(id).replace(/^.*\//, '').replace(/^(?:[a-z]{2,6}\.)?[a-z]+\.(?=[a-z])/, '').replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, '');
  return bare
    .split('-')
    .filter(Boolean)
    .map((w, i) => (i === 0 && /^gpt$/i.test(w) ? 'GPT' : /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/^GPT (?=\d)/, 'GPT-');
}
