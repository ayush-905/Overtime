import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, findModel, modelName } from '../lib/models.js';
import { usageCost } from '../lib/pricing.js';

test('one Claude model, however a harness or cloud spells it, has one price and one name', () => {
  const usage = { input_tokens: 1000, output_tokens: 500 };
  const spellings = [
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-5[1m]',
    'us.anthropic.claude-sonnet-4-5-20250929-v1:0', // Bedrock
    'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'claude-sonnet-4-5@20250929', // Vertex
    'anthropic/claude-sonnet-4.5', // OpenRouter
    'claude-sonnet-4.5', // Copilot
  ];
  for (const id of spellings) {
    assert.equal(findModel(id)?.row.key, 'sonnet-4-5', id);
    assert.equal(modelName(id), 'Sonnet 4.5', id);
    assert.equal(usageCost(id, usage), usageCost('claude-sonnet-4-5', usage), id);
  }
  assert.equal(modelName('openai/gpt-6.1-sol'), 'GPT-6.1 Sol');
  assert.equal(modelName('gpt-6.1-sol-2026-09-30'), 'GPT-6.1 Sol');
});

test('a model the catalog lacks keeps its whole name, and stays unpriced', () => {
  // Two Gemini models are two rows on the dashboard, never one "Gemini 2".
  assert.equal(modelName('gemini-2.5-pro'), 'Gemini 2.5 Pro');
  assert.equal(modelName('gemini-2.0-flash'), 'Gemini 2.0 Flash');
  assert.equal(modelName('google/gemini-2.5-pro'), 'Gemini 2.5 Pro');
  assert.equal(modelName('kimi-k2'), 'Kimi K2');
  assert.equal(modelName('gpt-6.2-sol'), 'GPT-6.2 Sol');
  assert.equal(modelName('claude-opus-6-1'), 'Opus 6.1'); // a Claude version the table doesn't list yet
  assert.equal(modelName('unknown'), 'unknown');
  assert.equal(modelName(null), 'unknown');
  for (const id of ['gemini-2.5-pro', 'claude-opus-6-1', 'gpt-6.2-sol'])
    assert.equal(usageCost(id, { input_tokens: 1000 }), null, id);
});

test('every row is complete for its pricing rule, and no id belongs to two families', () => {
  const need = {
    openai: ['input', 'cacheRead', 'output', 'longFrom'],
    anthropic: ['input', 'output', 'cacheRead', 'window'],
  };
  const keys = new Set();
  for (const family of FAMILIES) {
    for (const row of family.models) {
      assert.ok(row.name, row.key);
      for (const column of need[family.rule])
        assert.ok(Number.isFinite(row[column]) || row[column] === Infinity, `${row.key} ${column}`);
      assert.ok(!keys.has(row.key), row.key);
      keys.add(row.key);
      assert.equal(findModel(row.key)?.row, row, row.key);
    }
  }
});
