import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { priceTokens, usageCost, modelInfo, longContextFrom, longContextSurcharge } from '../lib/pricing.js';
import { codexUsage } from '../lib/codex-usage.js';
import { createUsageIndex } from '../lib/usage-index.js';
import { sessionDetail } from '../lib/insights.js';
import { spendSummary } from '../lib/limits.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('OpenAI standard rates distinguish versions, cached input and cache writes', () => {
  // Official USD per million tokens, checked 2026-09-30.
  const rates = [
    ['gpt-6.1-sol', 2, 0.1, 10, 2.5],
    ['gpt-6-sol', 2, 0.2, 10, 2.5],
    ['gpt-6-astra', 10, 1, 50, 12.5],
    ['gpt-6-luna', 0.1, 0.01, 0.5, 0.125],
    ['gpt-5.6-sol', 4, 0.4, 20, 5],
    ['gpt-5.6', 4, 0.4, 20, 5],
    ['gpt-5.6-terra', 2, 0.2, 12, 2.5],
    ['gpt-5.6-luna', 0.2, 0.02, 1.2, 0.25],
    ['gpt-5.6-cyber', 12.5, 1.25, 75, 15.625],
    ['gpt-5.5', 5, 0.5, 30, null],
    ['gpt-5.4', 2.5, 0.25, 15, null],
    ['gpt-5.4-mini', 0.75, 0.075, 4.5, null],
    ['gpt-5.4-nano', 0.2, 0.02, 1.25, null],
    ['gpt-5.3-codex', 1.75, 0.175, 14, null],
    ['chat-latest', 5, 0.5, 30, null],
  ];
  for (const [model, input, read, output, write] of rates) {
    const parts = priceTokens(model, { fresh: 1000, cacheRead: 2000, output: 500 });
    assert.ok(parts, model);
    close(parts.input, input / 1000);
    close(parts.cacheRead, read / 500);
    close(parts.output, output / 2000);
    const creation = priceTokens(model, { write5m: 1000 });
    if (write == null) assert.equal(creation, null, model);
    else close(creation.cacheWrite, write / 1000);
  }
});

test('GPT-6.1 snapshots and both transcript formats use the same price', () => {
  const usage = {
    input_tokens: 1000,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 1000,
    output_tokens: 500,
  };
  const expected = 0.0097;
  close(usageCost('gpt-6.1-sol', usage), expected);
  close(usageCost('gpt-6.1-sol-2026-09-30', usage), expected);
  close(
    codexUsage('gpt-6.1-sol', {
      input_tokens: 4000,
      cached_input_tokens: 2000,
      cache_write_input_tokens: 1000,
      output_tokens: 500,
    }).cost,
    expected,
  );
});

test('long-context pricing includes cached tokens and applies to the whole request', () => {
  assert.equal(longContextFrom('gpt-6.1-sol'), 272_000);
  close(priceTokens('gpt-6.1-sol', { fresh: 272_000, output: 1000 }).input, 0.544);
  const long = priceTokens('gpt-6.1-sol', { fresh: 270_000, cacheRead: 2000, write5m: 1, output: 1000 });
  close(long.input, 1.08);
  close(long.cacheRead, 0.0004);
  close(long.cacheWrite, 0.000005);
  close(long.output, 0.015);
  close(longContextSurcharge('gpt-6.1-sol', { fresh: 270_000, read: 2000, write: 1, output: 1000 }), 0.5452025);
  // Output alone cannot push a request into the long-input tier.
  close(priceTokens('gpt-6.1-sol', { fresh: 1000, output: 300_000 }).output, 3);
  assert.equal(longContextFrom('gpt-5.6-cyber'), null);
});

test('Claude current and legacy rates include both cache TTLs and snapshot IDs', () => {
  const rates = [
    ['fable-5-1', 10, 50, 0.25],
    ['mythos-5-1', 10, 50, 0.25],
    ['fable-5', 10, 50, 1],
    ['mythos-5', 10, 50, 1],
    ['opus-5-5', 4, 20, 0.2],
    ['opus-5', 5, 25, 0.5],
    ['opus-4-8', 5, 25, 0.5],
    ['opus-4-7', 5, 25, 0.5],
    ['opus-4-6', 5, 25, 0.5],
    ['opus-4-5', 5, 25, 0.5],
    ['opus-4-1', 15, 75, 1.5],
    ['opus-4', 15, 75, 1.5],
    ['sonnet-5-5', 2, 10, 0.2],
    ['sonnet-5', 2, 10, 0.2],
    ['sonnet-4-6', 3, 15, 0.3],
    ['sonnet-4-5', 3, 15, 0.3],
    ['sonnet-4', 3, 15, 0.3],
    ['haiku-4-5', 1, 5, 0.1],
    ['3-5-haiku', 0.8, 4, 0.08],
  ];
  for (const [name, input, output, read] of rates) {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 3000,
      cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
    };
    const expected = (1000 * input + 500 * output + 2000 * read + 1000 * input * 1.25 + 2000 * input * 2) / 1e6;
    close(usageCost(`claude-${name}`, usage), expected);
    close(usageCost(`claude-${name}-20260930`, usage), expected);
  }
  assert.equal(modelInfo('claude-sonnet-5-5').window, 1_000_000);
  assert.equal(modelInfo('claude-haiku-4-5-20251001').window, 200_000);
  assert.equal(modelInfo('claude-sonnet-4-5[1m]').window, 1_000_000);
});

test('Claude fast mode applies only to supported versions, including dated Opus 5', () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 1000,
  };
  for (const model of ['claude-opus-5-5', 'claude-opus-5-20260930', 'claude-opus-4-8']) {
    close(usageCost(model, { ...usage, speed: 'fast' }), 2 * usageCost(model, usage));
  }
  close(usageCost('claude-opus-4-6', { ...usage, speed: 'fast' }), usageCost('claude-opus-4-6', usage));
});

test('unlisted model versions remain unpriced instead of matching a substring', () => {
  for (const model of [
    'claude-opus-5-50',
    'claude-opus-4-9',
    'claude-sonnet-5-6',
    'claude-fable-5-2',
    'custom-opus-5-5',
    'gpt-6.2-sol',
  ]) {
    assert.equal(usageCost(model, { input_tokens: 1000 }), null, model);
  }
});

test('latest models flow through the usage index into session and spend costs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-pricing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude'),
    codexDir = path.join(root, 'codex');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  await mkdir(codexDir);
  const now = Date.now(),
    timestamp = new Date(now - 1000).toISOString();
  const claudeId = '12345678-1234-1234-1234-123456789012';
  const codexId = '87654321-4321-4321-4321-210987654321';
  await writeFile(
    path.join(claudeDir, 'project', `${claudeId}.jsonl`),
    JSON.stringify({
      type: 'assistant',
      timestamp,
      cwd: '/test',
      message: { id: 'm', model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 500 } },
    }) + '\n',
  );
  const records = [
    { type: 'session_meta', payload: { id: codexId, cwd: '/test', model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    {
      type: 'token_usage_record',
      payload: { response_id: 'r', usage: { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 500 } },
    },
  ];
  await writeFile(
    path.join(codexDir, `rollout-${codexId}.jsonl`),
    records.map((r) => JSON.stringify({ ...r, timestamp })).join('\n') + '\n',
  );
  const index = createUsageIndex({ claudeDir, codexDir });
  await index.scan();
  for (const [id, cost] of [
    [claudeId, 0.007],
    [`codex-${codexId}`, 0.0072],
  ]) {
    const detail = sessionDetail(index, id);
    close(detail.cost, cost);
    assert.equal(detail.partial, false);
  }
  const spend = spendSummary(index, now);
  close(spend.today.cost, 0.0142);
  assert.equal(spend.today.partial, false);
});
