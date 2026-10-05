import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheRebuild, lineCount, settleCall, startCall, startSession } from '../lib/readers.js';
import { claudeEdit } from '../lib/claude-usage.js';
import { applyCodexRecord, codexToolResult } from '../lib/codex-usage.js';
import { applyCodexEvent } from '../lib/codex.js';
import { createFeed, newAgent } from '../lib/agents.js';

/** What the helpers need of a usage-index record. */
const record = (extra = {}) => ({ events: [], edits: [], calls: [], callById: new Map(), lastT: 0, ...extra });

test('lines are counted the same way for every harness, a last newline or not', () => {
  assert.deepEqual(['', null, 'a', 'a\n', 'a\nb', 'a\nb\n\n'].map(lineCount), [0, 0, 1, 1, 2, 3]);
});

test('a request that writes most of its prompt to the cache again is a rebuild: at the start, after a pause, or otherwise', () => {
  const f = record();
  const big = { write: 50_000, read: 1000, fresh: 10 };
  assert.equal(cacheRebuild(f, 1000, big), 'start');
  assert.equal(cacheRebuild(f, 2000, { write: 100, read: 50_000, fresh: 10 }), null);
  assert.equal(f.lastT, 2000);
  assert.equal(cacheRebuild(f, 2000 + 6 * 60_000, big), 'pause');
  assert.equal(cacheRebuild(f, 2000 + 7 * 60_000, big), 'other');
  // Not most of the prompt, however big.
  assert.equal(cacheRebuild(f, 2000 + 20 * 60_000, { write: 30_000, read: 40_000, fresh: 0 }), null);
});

test('a tool call counts once, and its edits only once it went through', () => {
  const f = record();
  const edits = [{ path: '/w/a.txt', added: 2, removed: 1 }];
  const ok = startCall(f, 'c1', { t: 10, name: 'edit', edits });
  assert.equal(ok.status, 'pending');
  assert.equal(startCall(f, 'c1', { t: 11, name: 'edit', edits }), null);
  const failed = startCall(f, 'c2', { t: 20, name: 'edit', edits });
  settleCall(f, failed, 'error', 'Blocked by file permissions');
  settleCall(f, ok, 'ok');
  // A second result for the same call changes how it ended, never what it changed.
  settleCall(f, ok, 'ok');
  assert.deepEqual(
    f.calls.map((c) => [c.t, c.status, c.reason]),
    [
      [10, 'ok', null],
      [20, 'error', 'Blocked by file permissions'],
    ],
  );
  assert.deepEqual(f.edits, [[10, 2, 1, f, '/w/a.txt']]);
});

test('a session starts with its id, the session it belongs to, and its folder', () => {
  const f = record({ cwd: null });
  startSession(f, {
    source: 'codex',
    id: 'codex-b',
    nativeId: 'b',
    parentId: 'codex-a',
    cwd: '/work/shop',
    forkStart: null,
  });
  assert.deepEqual([f.id, f.session, f.sub, f.project, f.dirName], ['codex-b', 'codex-a', true, 'shop', '-work-shop']);
  startSession(f, { source: 'pi', id: 'pi-c', nativeId: 'c', parentId: null, cwd: undefined, forkStart: 5 });
  assert.deepEqual([f.session, f.sub, f.cwd, f.forkStart], ['pi-c', false, '/work/shop', 5]);
});

test("Claude Code's edits are counted from the tool call, by the file it names", () => {
  assert.deepEqual(claudeEdit('Edit', { file_path: '/w/a.txt', old_string: 'x', new_string: 'y\nz' }), {
    path: '/w/a.txt',
    added: 2,
    removed: 1,
  });
  assert.deepEqual(
    claudeEdit('MultiEdit', {
      file_path: '/w/a.txt',
      edits: [
        { old_string: 'a', new_string: 'b\nc' },
        { old_string: 'd\ne', new_string: '' },
      ],
    }),
    { path: '/w/a.txt', added: 2, removed: 3 },
  );
  assert.deepEqual(claudeEdit('Write', { content: 'one\ntwo\n' }), { path: null, added: 2, removed: 0 });
  assert.deepEqual(claudeEdit('NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: 'x' }), {
    path: '/w/n.ipynb',
    added: 1,
    removed: 0,
  });
  assert.equal(claudeEdit('Read', { file_path: '/w/a.txt' }), null);
});

test("Codex's history counts how full a conversation is as its live view does: the last request and its reply", () => {
  const t = new Date().toISOString();
  const usage = { input_tokens: 9000, cached_input_tokens: 4000, output_tokens: 300 };
  const lines = [
    { timestamp: t, type: 'session_meta', payload: { id: 'c1', cwd: '/w' } },
    { timestamp: t, type: 'turn_context', payload: { model: 'gpt-5' } },
    {
      timestamp: t,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 258_400 },
      },
    },
  ];
  const f = record({ prompts: [], work: [], compactions: [], quotas: {}, seen: new Set() });
  for (const ev of lines) applyCodexRecord(f, ev);
  const a = newAgent('codex-c1', { source: 'codex' });
  for (const ev of lines) applyCodexEvent(createFeed(), a, ev);
  assert.equal(f.events.at(-1)[5].context, 9300);
  assert.equal(a.context.used, 9300);
});

test("a Codex script's output is read as text: it failed, a command in it failed, or you turned it down", () => {
  const out = (...texts) => ({ output: texts.map((text) => ({ type: 'input_text', text })) });
  const pick = ({ error, denied, applied }) => ({ error, denied, applied });
  // The script failed at its patch: nothing went in.
  assert.deepEqual(
    pick(
      codexToolResult(
        out('Script failed\nWall time 0.1 seconds\nOutput:\n', 'Script error: apply_patch verification failed'),
      ),
    ),
    { error: true, denied: false, applied: false },
  );
  // Its patch went in, then a command in it exited with 1: a failed call that still changed the file.
  assert.deepEqual(
    pick(
      codexToolResult(
        out(
          'Script completed\nWall time 1.2 seconds\nOutput:\n',
          '{}\n{"chunk_id":"a1","exit_code":1,"output":"1 failing"}',
        ),
      ),
    ),
    { error: true, denied: false, applied: true },
  );
  assert.deepEqual(pick(codexToolResult({ output: 'patch rejected by user' })), {
    error: false,
    denied: true,
    applied: false,
  });
  assert.deepEqual(pick(codexToolResult({ output: 'exec command rejected by user' })), {
    error: false,
    denied: true,
    applied: false,
  });
  assert.deepEqual(pick(codexToolResult({ output: 'Success. Updated the following files:\nM src/a.js' })), {
    error: false,
    denied: false,
    applied: true,
  });
});
