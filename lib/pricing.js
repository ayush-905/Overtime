// Turning tokens into dollars at API list prices, to estimate what a session
// would cost at pay-as-you-go rates. Subscription plans bill differently, so the
// UI labels these as estimates. The models and their prices are in models.js;
// this is how each provider's prices apply (its `rule` there).

import { findModel } from './models.js';

const WEB_SEARCH_USD = 0.01;

/** A model's list prices and the window Claude Code would give it; null if the catalog doesn't know it. */
export function modelInfo(model) {
  const found = findModel(model);
  if (!found) return null;
  const { input, output, cacheRead, window } = found.row;
  return { input, output, cacheRead, window: /\[1m\]/i.test(model) ? 1_000_000 : window };
}

// Each provider's pricing: the cost of each part of a request, plus `plainCached`,
// what its cached tokens would have cost as fresh input. Null for a token type
// the provider lists no price for.
const RULES = {
  openai(row, { fresh, cacheRead, write5m, write1h, output, flat }) {
    const write = write5m + write1h;
    if (write && row.cacheWrite == null) return null;
    // `flat` prices a long request as if it weren't, to see what the long-context rate added.
    const long = !flat && fresh + cacheRead + write > row.longFrom;
    const inF = long ? 2 : 1;
    const outF = long ? 1.5 : 1;
    return {
      output: (output * row.output * outF) / 1e6,
      cacheRead: (cacheRead * row.cacheRead * inF) / 1e6,
      cacheWrite: (write * (row.cacheWrite || 0) * inF) / 1e6,
      input: (fresh * row.input * inF) / 1e6,
      search: 0,
      plainCached: ((cacheRead + write) * row.input * inF) / 1e6,
    };
  },
  anthropic(row, { fresh, cacheRead, write5m, write1h, output, searches, fast }) {
    const f = fast && row.fast ? 2 : 1;
    return {
      output: (output * row.output * f) / 1e6,
      cacheRead: (cacheRead * row.cacheRead * f) / 1e6,
      cacheWrite: ((write5m * 1.25 + write1h * 2) * row.input * f) / 1e6,
      input: (fresh * row.input * f) / 1e6,
      search: searches * WEB_SEARCH_USD,
      plainCached: ((cacheRead + write5m + write1h) * row.input * f) / 1e6,
    };
  },
};

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
 * The one place tokens become dollars, for every model in the catalog: the cost
 * of each part of a request, plus `plainCached`, what its cached tokens would
 * have cost as fresh input. Null for a model (or a token type) with no price.
 */
export function priceTokens(model, { fresh = 0, cacheRead = 0, write5m = 0, write1h = 0, output = 0, searches = 0, fast = false, flat = false } = {}) {
  const found = findModel(model);
  return found ? RULES[found.family.rule](found.row, { fresh, cacheRead, write5m, write1h, output, searches, fast, flat }) : null;
}

/** Where a model's long-context rate starts, in tokens of input; null if it has none. */
export function longContextFrom(model) {
  const from = findModel(model)?.row.longFrom;
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
