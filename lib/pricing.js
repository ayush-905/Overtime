// API list prices in USD per million tokens, used to estimate what a session
// would cost at pay-as-you-go rates. Subscription plans bill differently, so the
// UI labels these as estimates.
//
// Cache writes cost 1.25x the input price for the 5-minute TTL and 2x for the
// 1-hour TTL. Cache reads are listed per model because a few are not 0.1x.

// Checked 2026-09-30: https://platform.claude.com/docs/en/about-claude/pricing
const MODELS = [
  // pattern, input, output, cache read, context window
  [/^(fable-5-1|mythos-5-1)$/, 10, 50, 0.25, 1_000_000],
  [/^(fable-5|mythos-5)$/, 10, 50, 1.0, 1_000_000],
  [/^opus-5-5$/, 4, 20, 0.2, 1_000_000],
  [/^opus-5$/, 5, 25, 0.5, 1_000_000],
  [/^opus-4-[678]$/, 5, 25, 0.5, 1_000_000],
  [/^opus-4-5$/, 5, 25, 0.5, 200_000],
  [/^opus-4(?:-1)?$/, 15, 75, 1.5, 200_000],
  [/^sonnet-5-5$/, 2, 10, 0.2, 1_000_000],
  [/^sonnet-5$/, 2, 10, 0.2, 1_000_000],
  [/^sonnet-4-6$/, 3, 15, 0.3, 1_000_000],
  [/^sonnet-4(?:-5)?$/, 3, 15, 0.3, 200_000],
  [/^haiku-4-5$/, 1, 5, 0.1, 200_000],
  [/^3-5-haiku$/, 0.8, 4, 0.08, 200_000],
];

// OpenAI models, as Codex uses them (and Claude Code, through a gateway). Their
// cache writes have their own price where one is listed; past the long-context
// mark, the whole request costs 2x for input and 1.5x for output. Checked
// 2026-09-30: https://developers.openai.com/api/docs/pricing and model pages at
// https://developers.openai.com/api/docs/models/<name> (including older models).
const OPENAI_MODELS = [
  // name, input, cache read, output, cache write (null: not listed), long context from
  ['gpt-6-astra', 10, 1, 50, 12.5, 272_000],
  ['gpt-6.1-sol', 2, 0.1, 10, 2.5, 272_000],
  ['gpt-6-sol', 2, 0.2, 10, 2.5, 272_000],
  ['gpt-6-luna', 0.1, 0.01, 0.5, 0.125, 272_000],
  ['gpt-5.6-sol', 4, 0.4, 20, 5, 272_000],
  ['gpt-5.6', 4, 0.4, 20, 5, 272_000], // documented Sol alias
  ['gpt-5.6-terra', 2, 0.2, 12, 2.5, 272_000],
  ['gpt-5.6-luna', 0.2, 0.02, 1.2, 0.25, 272_000],
  ['gpt-5.6-cyber', 12.5, 1.25, 75, 15.625, Infinity],
  ['gpt-5.5', 5, 0.5, 30, null, 272_000],
  ['gpt-5.4', 2.5, 0.25, 15, null, 272_000],
  ['gpt-5.4-mini', 0.75, 0.075, 4.5, null, Infinity],
  ['gpt-5.4-nano', 0.2, 0.02, 1.25, null, Infinity],
  ['gpt-5.3-codex', 1.75, 0.175, 14, null, Infinity],
  ['chat-latest', 5, 0.5, 30, null, Infinity],
];

// Claude fast mode runs supported Opus models at double the per-token price.
const FAST_MODE = /^(opus-5-5|opus-5|opus-4-8)$/;
const WEB_SEARCH_USD = 0.01;

// Strip only documented alias/snapshot suffixes, preserving the model version.
// Exact matching keeps an unlisted version from inheriting an older model's rate.
function claudeName(model) {
  return String(model || '').replace(/\[1m\]$/i, '').replace(/-(?:\d{8}|latest)$/, '').replace(/^claude-/, '');
}

export function modelInfo(model) {
  if (!model) return null;
  const name = claudeName(model);
  for (const [pattern, input, output, cacheRead, window] of MODELS) {
    if (pattern.test(name)) return { input, output, cacheRead, window: /\[1m\]/i.test(model) ? 1_000_000 : window };
  }
  return null;
}

function openaiPrice(model) {
  const name = String(model || '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const row = OPENAI_MODELS.find(([n]) => n === name);
  return row && { input: row[1], cacheRead: row[2], output: row[3], cacheWrite: row[4], longFrom: row[5] };
}

/** Tokens in one assistant message's `usage`, split the way they are billed. */
export function usageTokens(usage = {}) {
  const creation = usage.cache_creation || {};
  const write1h = creation.ephemeral_1h_input_tokens || 0;
  const write5m = creation.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - write1h);
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    write5m,
    write1h,
  };
}

/**
 * The one place tokens become dollars, for Claude and OpenAI models alike: the
 * cost of each part of a request, plus `plainCached`, what its cached tokens
 * would have cost as fresh input. Null for a model (or a token type) with no price.
 */
export function priceTokens(model, { fresh = 0, cacheRead = 0, write5m = 0, write1h = 0, output = 0, searches = 0, fast = false, flat = false } = {}) {
  const openai = openaiPrice(model);
  if (openai) {
    const write = write5m + write1h;
    if (write && openai.cacheWrite == null) return null;
    // `flat` prices a long request as if it weren't, to see what the long-context rate added.
    const long = !flat && fresh + cacheRead + write > openai.longFrom;
    const inF = long ? 2 : 1;
    const outF = long ? 1.5 : 1;
    return {
      output: (output * openai.output * outF) / 1e6,
      cacheRead: (cacheRead * openai.cacheRead * inF) / 1e6,
      cacheWrite: (write * (openai.cacheWrite || 0) * inF) / 1e6,
      input: (fresh * openai.input * inF) / 1e6,
      search: 0,
      plainCached: ((cacheRead + write) * openai.input * inF) / 1e6,
    };
  }
  const price = modelInfo(model);
  if (!price) return null;
  const f = fast && FAST_MODE.test(claudeName(model)) ? 2 : 1;
  return {
    output: (output * price.output * f) / 1e6,
    cacheRead: (cacheRead * price.cacheRead * f) / 1e6,
    cacheWrite: ((write5m * 1.25 + write1h * 2) * price.input * f) / 1e6,
    input: (fresh * price.input * f) / 1e6,
    search: searches * WEB_SEARCH_USD,
    plainCached: ((cacheRead + write5m + write1h) * price.input * f) / 1e6,
  };
}

/** Where a model's long-context rate starts, in tokens of input; null if it has none. */
export function longContextFrom(model) {
  const from = openaiPrice(model)?.longFrom;
  return Number.isFinite(from) ? from : null;
}

/**
 * What the long-context rate added to one request, from the tokens the usage
 * index keeps for it ({ fresh, read, write, output }): its cost minus the same
 * request at the normal rate. 0 for a request under the mark, or a model without one.
 */
export function longContextSurcharge(model, { fresh = 0, read = 0, write = 0, output = 0 } = {}) {
  const from = longContextFrom(model);
  if (from == null || fresh + read + write <= from) return 0;
  const tokens = { fresh, cacheRead: read, write5m: write, output };
  const long = priceTokens(model, tokens);
  const flat = priceTokens(model, { ...tokens, flat: true });
  return long && flat ? partsTotal(long) - partsTotal(flat) : 0;
}

/** A Claude Code `usage` block, as priceTokens wants it. */
function claudeParts(model, usage = {}) {
  const t = usageTokens(usage);
  return priceTokens(model, {
    fresh: t.input,
    cacheRead: t.cacheRead,
    write5m: t.write5m,
    write1h: t.write1h,
    output: t.output,
    searches: usage.server_tool_use?.web_search_requests || 0,
    fast: usage.speed === 'fast',
  });
}

/** What the parts of a request add up to. */
export const partsTotal = (p) => p.output + p.cacheRead + p.cacheWrite + p.input + p.search;

/** Estimated USD for one assistant message, or null for an unknown model. */
export function usageCost(model, usage = {}) {
  const parts = claudeParts(model, usage);
  return parts ? partsTotal(parts) : null;
}

/** One message's estimated cost split by what was billed: output, cache reads, cache writes, fresh input, web searches. */
export function costParts(model, usage = {}) {
  const { plainCached, ...parts } = claudeParts(model, usage) || { output: 0, cacheRead: 0, cacheWrite: 0, input: 0, search: (usage.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_USD };
  return parts;
}

/**
 * What prompt caching did for one message: `saved` is what the same tokens would
 * cost at the plain input price minus what the cache reads and writes cost, and
 * `writeCost` is what writing to the cache cost.
 */
export function cacheEffect(model, usage = {}) {
  const parts = claudeParts(model, usage);
  if (!parts) return { saved: 0, writeCost: 0 };
  return { saved: parts.plainCached - parts.cacheRead - parts.cacheWrite, writeCost: parts.cacheWrite };
}

/** Tokens the conversation occupies after this message: everything sent plus the reply. */
export function contextUsed(usage = {}) {
  return (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.output_tokens || 0);
}

export function contextWindow(model, used) {
  const window = modelInfo(model)?.window || 200_000;
  return used > window ? 1_000_000 : window;
}
