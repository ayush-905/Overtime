import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUsageIndex, queryTerms, snippet } from '../lib/usage-index.js';
import { skillUsage } from '../lib/skills.js';
import { codexSkillList, skillReads } from '../lib/codex-usage.js';

const id = '12345678-1234-1234-1234-123456789012';
const MINUTE = 60_000;

/** A Claude Code session this morning: offered some skills, ran one as a command, the agent picked another. */
async function session(t, { keepText = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const start = Date.now() - 2 * 3_600_000;
  const at = (ms) => new Date(start + ms).toISOString();
  const lines = [
    { type: 'attachment', timestamp: at(0), cwd: '/work/shop', attachment: { type: 'skill_listing', isInitial: true, names: ['standup', 'pdf-tools:pdf', 'never-used'], content: '- standup: Write my standup.\n- pdf-tools:pdf: Read and make PDFs.\n- never-used: Nobody calls this one.' } },
    { type: 'user', timestamp: at(MINUTE), cwd: '/work/shop', uuid: 'u1', message: { content: '<command-message>standup</command-message>\n<command-name>/standup</command-name>' } },
    { type: 'user', timestamp: at(MINUTE), cwd: '/work/shop', uuid: 'u2', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill: /home/me/.claude/skills/standup\n\n# Standup' }] } },
    // A built-in command isn't a skill.
    { type: 'user', timestamp: at(2 * MINUTE), cwd: '/work/shop', uuid: 'u3', message: { content: '<command-name>/model</command-name>' } },
    { type: 'user', timestamp: at(3 * MINUTE), cwd: '/work/shop', uuid: 'u4', message: { content: 'Please fix the Checkout timezone bug in the invoice PDF' } },
    { type: 'assistant', timestamp: at(4 * MINUTE), cwd: '/work/shop', message: { id: 'a1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'pdf-tools:pdf' } }] } },
    { type: 'assistant', timestamp: at(5 * MINUTE), cwd: '/work/shop', message: { id: 'a2', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'The **timezone** offset was applied twice, so invoices showed the wrong day.' }] } },
  ];
  await writeFile(path.join(claudeDir, 'project', `${id}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const idx = createUsageIndex({ claudeDir, codexDir: path.join(root, 'none'), keepText });
  await idx.scan();
  return idx;
}

test('skills: what was offered, what was used and how, and what never was', async (t) => {
  const idx = await session(t);
  const k = skillUsage(idx);
  assert.equal(k.offered, 3);
  assert.deepEqual(k.used.map((s) => s.name).sort(), ['pdf-tools:pdf', 'standup']);
  assert.equal(k.uses, 2);
  const byName = Object.fromEntries(k.used.map((s) => [s.name, s]));
  assert.equal(byName.standup.you, 1);
  assert.equal(byName['pdf-tools:pdf'].agent, 1);
  assert.equal(byName['pdf-tools:pdf'].kind, 'plugin');
  assert.equal(byName['pdf-tools:pdf'].plugin, 'pdf-tools');
  // /model isn't on offer as a skill, so it isn't counted as one.
  assert.ok(!byName.model);
  assert.deepEqual(k.unused.map((s) => s.name), ['never-used']);
  assert.equal(k.unused[0].about, 'Nobody calls this one.');
});

test('search finds every word, or a phrase, in what you wrote and what the agent replied', async (t) => {
  const idx = await session(t);
  assert.deepEqual(queryTerms('Timezone "invoice PDF"'), ['timezone', 'invoice pdf']);
  const both = idx.search('timezone');
  assert.equal(both.total, 2);
  assert.equal(both.results.length, 1);
  assert.equal(both.results[0].session, id);
  assert.deepEqual(both.results[0].hits.map((h) => h.who), ['agent', 'you']);
  // Markdown's emphasis is left out of what's shown.
  assert.ok(!both.results[0].hits[0].text.includes('**'));
  assert.equal(idx.search('"invoice pdf" checkout').total, 1);
  assert.equal(idx.search('timezone refund').total, 0);
  assert.equal(idx.search(' ').results.length, 0);
});

test('search off keeps no text, and back on reads it again', async (t) => {
  const idx = await session(t);
  assert.ok(idx.searchStats().messages > 0);
  idx.setSearch(false);
  assert.deepEqual(idx.searchStats(), { on: false, messages: 0, chars: 0 });
  assert.equal(idx.search('timezone').total, 0);
  // The rest of the index is untouched.
  assert.ok(idx.events().length > 0);
  idx.setSearch(true);
  await idx.scan();
  assert.equal(idx.search('timezone').total, 2);

  const off = await session(t, { keepText: false });
  assert.equal(off.searchStats().messages, 0);
  assert.equal(skillUsage(off).usedCount, 2);
});

test('a snippet starts a few words before the match', () => {
  const text = `${'Some words before. '.repeat(10)}Here is the match we want, and plenty after it ${'so the end is cut. '.repeat(10)}`;
  const s = snippet(text, ['match']);
  assert.ok(s.startsWith('…'));
  assert.ok(s.endsWith('…'));
  assert.ok(s.indexOf('match') < 40);
  assert.equal(snippet('Short text', ['short']), 'Short text');
});

test("Codex: the skills in its instructions, and the ones a tool call reads", () => {
  const text = '<skills_instructions>\n## Skills\n### Available skills\n- imagegen: Make images. (file: /home/me/.codex/skills/.system/imagegen/SKILL.md)\n- pdf:pdf: Read PDFs. (file: r3/pdf/1.0/skills/pdf/SKILL.md)\n### How to use skills\n';
  const list = codexSkillList(text);
  assert.deepEqual(list.names, ['imagegen', 'pdf:pdf']);
  assert.equal(list.about['pdf:pdf'], 'Read PDFs.');
  assert.deepEqual(skillReads('{"cmd":"cat /home/me/.codex/skills/.system/imagegen/SKILL.md"}', list).map(([name]) => name), ['imagegen']);
  // A plugin's skill is listed by a relative path, and named with its plugin.
  assert.deepEqual(skillReads('sed -n 1,80p /home/me/.codex/.tmp/plugins/r3/pdf/1.0/skills/pdf/SKILL.md', list).map(([name]) => name), ['pdf:pdf']);
  // Editing a skill isn't using it.
  assert.deepEqual(skillReads('*** Begin Patch\n*** Update File: /x/skills/imagegen/SKILL.md', list), []);
});

test('a message opens with what it led to: its replies, tool calls and cost', async (t) => {
  const { turnDetail } = await import('../lib/insights.js');
  const idx = await session(t);
  const hit = idx.search('offset twice').results[0].hits[0];
  const turn = turnDetail(idx, id, hit.t);
  assert.equal(turn.text, 'Please fix the Checkout timezone bug in the invoice PDF');
  assert.equal(turn.whole, true);
  assert.deepEqual(turn.replies.map((r) => r.t), [hit.t]);
  assert.deepEqual(turn.tools, [['Skill', 1]]);
  assert.ok(turn.cost > 0);
  assert.equal(turn.next, null);
  // Any moment before your first message opens that one.
  assert.equal(turnDetail(idx, id, 0).t, turnDetail(idx, id, hit.t - 60_000 * 10).t);
});
