// The agents Overtime reads: which are on this Mac, which have plan limits, and
// how the weekly digest splits the cost between them.

import { describe, expect, test } from 'vitest';
import { andList, plansIn, sourceInfo, sourcesIn } from './sources';
import { quotaItems, providerName, type LimitsInput } from './limits';
import { digestNotes, type Digest } from './digest';

describe('sources', () => {
  test('the ones on this Mac are the views the server sent, in order, and Claude Code at least', () => {
    expect(sourcesIn({ all: {}, pi: {}, claude: {} })).toEqual(['claude', 'pi']);
    expect(sourcesIn({ all: {} })).toEqual(['claude']);
    expect(sourcesIn(null)).toEqual(['claude']);
  });

  test('Pi has no plan of its own, so its view has none to show', () => {
    expect(plansIn('all', ['claude', 'codex', 'pi'])).toEqual(['claude', 'codex']);
    expect(plansIn('all', ['claude', 'pi'])).toEqual(['claude']);
    expect(plansIn('codex', ['claude', 'codex'])).toEqual(['codex']);
    expect(plansIn('pi', ['claude', 'pi'])).toEqual([]);
    const inp = {
      now: Date.now(),
      limits: null,
      exactOn: false,
      exact: null,
      codexRecorded: null,
      codexExactOn: false,
      codexExact: null,
    } as unknown as LimitsInput;
    expect(quotaItems(inp, 'pi')).toEqual([]);
  });

  test('names', () => {
    expect(andList(['Claude Code', 'Codex', 'Pi'])).toBe('Claude Code, Codex and Pi');
    expect(andList(['Pi'])).toBe('Pi');
    expect(providerName('pi')).toBe('Pi');
    expect(providerName('all')).toBe('All providers');
    expect(sourceInfo('pi').name).toBe('Pi');
    expect(sourceInfo(undefined).name).toBe('Claude Code');
  });

  test('the digest gives each provider its share of the cost', () => {
    const base = {
      cost: 100,
      projects: [],
      busiest: null,
      days: 7,
      waitMs: 0,
      waits: 0,
      agentMs: 0,
      activeMs: 0,
      hits: { claude: 0, codex: 0 },
      tools: 0,
      failed: 0,
    } as unknown as Digest;
    expect(digestNotes({ ...base, bySource: { claude: 93, codex: 7, pi: 0 } })).toContain(
      'Codex was 7% of the cost, Claude Code the rest.',
    );
    expect(digestNotes({ ...base, bySource: { claude: 60, codex: 10, pi: 30 } })).toContain(
      'Of the cost, Claude Code was 60%, Pi was 30% and Codex was 10%.',
    );
  });
});
