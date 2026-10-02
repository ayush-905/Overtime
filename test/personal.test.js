import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUsageIndex } from '../lib/usage-index.js';
import { computeInsights, setWorkdayHour } from '../lib/insights.js';
import { cleanPrefs, mergeHistory, historyDays, dayKey } from '../lib/store.js';

const id = '12345678-1234-1234-1234-123456789012';
const MINUTE = 60_000;

/** A Claude Code transcript with three of your messages this morning, the last after a long break. */
async function morning(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-personal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const start = noon.getTime() - 3 * 3_600_000; // 9am
  const at = (ms) => new Date(start + ms).toISOString();
  const user = (ms, text) => ({ type: 'user', timestamp: at(ms), message: { content: text }, cwd: '/work/shop' });
  const reply = (ms, n) => ({ type: 'assistant', timestamp: at(ms), message: { id: `a${n}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 20 } } });
  // Worked 5 minutes, waited 3 for you, worked 5 more; then a 2-hour break before the last message.
  const lines = [
    user(0, 'First'), reply(2 * MINUTE, 1), reply(5 * MINUTE, 2),
    user(8 * MINUTE, 'Second'), reply(13 * MINUTE, 3),
    user(13 * MINUTE + 2 * 3_600_000, 'Third'), reply(14 * MINUTE + 2 * 3_600_000, 4),
  ];
  await writeFile(path.join(claudeDir, 'project', `${id}.jsonl`), lines.map(JSON.stringify).join('\n') + '\n');
  const idx = createUsageIndex({ claudeDir, codexDir: path.join(root, 'none') });
  await idx.scan();
  return { idx, start, now: noon.getTime() };
}

test("today's timeline has a lane per session: its work, your messages and the waits between", async (t) => {
  const { idx, start, now } = await morning(t);
  const { timeline } = computeInsights({ index: idx, agents: new Map(), now });
  assert.equal(timeline.lanes.length, 1);
  const lane = timeline.lanes[0];
  assert.equal(lane.id, id);
  assert.equal(lane.project, 'shop');
  assert.deepEqual(lane.messages, [start, start + 8 * MINUTE, start + 13 * MINUTE + 2 * 3_600_000]);
  // The 3-minute wait counts; the 2-hour break was you stepping away, so it doesn't.
  assert.deepEqual(lane.waits, [[start + 5 * MINUTE, start + 8 * MINUTE]]);
  assert.equal(lane.work[0][0], start);
  assert.ok(lane.busyMs >= 11 * MINUTE);
  assert.ok(lane.cost > 0);
  assert.ok(timeline.you.length >= 1);
  assert.equal(timeline.others.sessions, 0);
});

test('the daily summaries add up each day, for the heatmap', async (t) => {
  const { idx, now } = await morning(t);
  const { daily } = computeInsights({ index: idx, agents: new Map(), now });
  assert.equal(daily.length, 30);
  const today = daily[29];
  assert.equal(dayKey(today.day), dayKey(now));
  assert.equal(today.messages, 3);
  assert.equal(today.sessions, 1);
  assert.ok(today.activeMs > 0 && today.agentMs > 0 && today.cost > 0);
  assert.ok(daily.slice(0, 29).every((d) => d.messages === 0 && d.cost === 0));
});

test('observed turn durations use the same indexed transcripts as the existing analytics', async (t) => {
  const { idx, now } = await morning(t);
  const { turnPerformance } = computeInsights({ index: idx, agents: new Map(), now });
  assert.equal(turnPerformance.count, 3);
  assert.equal(turnPerformance.medianMs, 5 * MINUTE);
  assert.equal(turnPerformance.p90Ms, 5 * MINUTE);
  assert.equal(turnPerformance.inferred, 3);
  assert.equal(turnPerformance.buckets.reduce((n, bucket) => n + bucket.count, 0), 3);
});

test('the working day starts at the hour you choose', async (t) => {
  const { idx, now } = await morning(t);
  try {
    setWorkdayHour(6);
    const six = computeInsights({ index: idx, agents: new Map(), now }).hours.days.at(-1);
    assert.equal(new Date(six.start).getHours(), 6);
    setWorkdayHour(10);
    // A day that starts at 10am puts the two messages before 10 on the day before.
    const ten = computeInsights({ index: idx, agents: new Map(), now }).hours.days;
    assert.equal(new Date(ten.at(-1).start).getHours(), 10);
    assert.equal(ten.at(-1).messages, 1);
    assert.equal(ten.at(-2).messages, 2);
  } finally {
    setWorkdayHour(4);
  }
});

test('kept history takes the settled days, leaves out today and the oldest, and gives way to fresh numbers', () => {
  const now = new Date(2026, 8, 28, 15).getTime();
  const day = (ago) => new Date(2026, 8, 28 - ago).getTime();
  const fresh = { all: Array.from({ length: 30 }, (_, i) => ({ day: day(29 - i), cost: i, messages: 1 })), claude: [], codex: [] };
  const { history, changed } = mergeHistory({ days: { '2025-01-01': { all: { cost: 5 } } } }, fresh, now);
  assert.ok(changed);
  const keys = Object.keys(history.days).sort();
  // Today isn't over, the days over 28 back may have lost transcripts, and over 400 days is dropped.
  assert.ok(!keys.includes(dayKey(now)));
  assert.ok(!keys.includes(dayKey(day(28))) && !keys.includes(dayKey(day(29))));
  assert.ok(keys.includes(dayKey(day(27))) && keys.includes(dayKey(day(1))));
  assert.equal(keys.length, 27);
  assert.ok(!keys.includes('2025-01-01'));
  assert.equal(mergeHistory(history, fresh, now).changed, false);
  // Older kept days come first, and the fresh 30 days win where both have a day.
  const kept = { days: { ...history.days, [dayKey(day(40))]: { all: { cost: 9, messages: 2 } }, [dayKey(day(3))]: { all: { cost: 99 } } } };
  const days = historyDays(kept, fresh, 'all');
  assert.equal(days[0].cost, 9);
  assert.equal(days[0].kept, true);
  assert.equal(days.find((d) => dayKey(d.day) === dayKey(day(3))).cost, 26);
  assert.equal(days.length, 31);
});

test('settings the server takes are checked, and a bad value keeps the one before', () => {
  assert.deepEqual(cleanPrefs({ workdayHour: 6 }), { workdayHour: 6, search: true });
  assert.deepEqual(cleanPrefs({ workdayHour: '0' }), { workdayHour: 0, search: true });
  assert.deepEqual(cleanPrefs({ workdayHour: 99 }, { workdayHour: 7 }), { workdayHour: 7, search: true });
  assert.deepEqual(cleanPrefs({ workdayHour: 2.5 }, { workdayHour: 7 }), { workdayHour: 7, search: true });
  assert.deepEqual(cleanPrefs({ workdayHour: null }, { workdayHour: 7 }), { workdayHour: 7, search: true });
  assert.deepEqual(cleanPrefs(null), { workdayHour: 4, search: true });
  // Search is on or off, and anything else leaves it as it was.
  assert.deepEqual(cleanPrefs({ search: false }, { workdayHour: 7, search: true }), { workdayHour: 7, search: false });
  assert.deepEqual(cleanPrefs({ search: 'no' }, { workdayHour: 7, search: false }), { workdayHour: 7, search: false });
});

test('settings are kept by name, only the dashboard\'s own, and go back into the page safely', async () => {
  const { applySettings, settingsScript, isSetting } = await import('../lib/store.js');
  assert.ok(isSetting('overtime-theme'));
  assert.ok(!isSetting('overtime-page')); // where you were last stays with each browser
  assert.ok(!isSetting('something-else'));
  const first = applySettings({}, { 'overtime-theme': 'dark', 'overtime-page': 'cost', other: 'x', 'overtime-clock': 24 });
  assert.deepEqual(first.values, { 'overtime-theme': 'dark' });
  assert.ok(first.changed);
  assert.equal(applySettings(first.values, { 'overtime-theme': 'dark' }).changed, false);
  assert.deepEqual(applySettings(first.values, { 'overtime-theme': null }).values, {});
  assert.ok(applySettings({}, { 'overtime-x': 'y'.repeat(300_000) }).values['overtime-x'] === undefined);
  // A value can't end the script it's written into.
  const script = settingsScript({ initialized: true, values: { 'overtime-session-names': '{"a":"</script><img src=x>"}' } });
  assert.equal(script.match(/<\/script>/g).length, 1);
  assert.ok(script.includes('\\u003c/script>'));
});

test('resuming in Terminal writes a script from the session itself, safely quoted, and opens it', async (t) => {
  const { resumeInTerminal, resumeOptions } = await import('../lib/resume.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'overtime-resume-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let opened = null;
  const r = await resumeInTerminal({ source: 'claude', nativeId: id, cwd: "/work/it's here" }, dir, { open: async (file) => { opened = file; } });
  assert.equal(r.command, `claude --resume ${id}`);
  assert.equal(opened, r.file);
  const { readFile, stat } = await import('node:fs/promises');
  const script = await readFile(r.file, 'utf8');
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.ok(script.includes(`cd '/work/it'\\''s here'`));
  assert.ok(script.includes(`claude --resume ${id}`));
  assert.equal((await stat(r.file)).mode & 0o777, 0o700);
  const codex = await resumeInTerminal({ source: 'codex', nativeId: id }, dir, { open: async () => {} });
  assert.equal(codex.command, `codex resume ${id}`);
  await assert.rejects(resumeInTerminal({ source: 'claude', nativeId: 'x; rm -rf ~' }, dir, { open: async () => {} }));
  assert.equal((await resumeOptions({ source: 'claude', nativeId: 'not-an-id' })).terminal, false);
});

test('app targets use the exact native session and fall back for missing apps and unmatched Claude sessions', async () => {
  const { resumeOptions } = await import('../lib/resume.js');
  const installed = { appInstalled: () => true, getDesktopSessions: async () => new Map([[id, 'local_abc-123']]) };
  assert.deepEqual((await resumeOptions({ source: 'claude', nativeId: id }, installed)).app,
    { name: 'Claude', url: 'claude://code/continue?session=local_abc-123' });
  assert.deepEqual((await resumeOptions({ source: 'codex', nativeId: id }, installed)).app,
    { name: 'Codex', url: `codex://threads/${id}` });
  const unmatched = await resumeOptions({ source: 'claude', nativeId: id }, { ...installed, getDesktopSessions: async () => new Map() });
  assert.equal(unmatched.app, null);
  assert.equal(unmatched.terminal, true);
  for (const source of ['claude', 'codex']) {
    assert.equal((await resumeOptions({ source, nativeId: id }, { appInstalled: () => false })).app, null);
    assert.deepEqual(await resumeOptions({ source, nativeId: 'invalid' }, installed), { terminal: false, app: null });
  }
});

test('live updates rebuild the whole snapshot from changes, keeping what didn\'t change', async () => {
  const { createMerger } = await import('../web/shared/live.js');
  const merge = createMerger();
  let s = merge({ patch: 1, now: 1, changes: [[['agents'], [{ id: 'a' }]], [['analytics', 'all', 'insights', 'trend'], { days: [1] }], [['analytics', 'all', 'spend'], { today: 2 }]] });
  const trend = s.analytics.all.insights.trend;
  const agents = s.agents;
  s = merge({ patch: 1, now: 2, changes: [[['analytics', 'all', 'insights', 'hours'], { h: 3 }]] });
  assert.equal(s.now, 2);
  assert.equal(s.agents, agents);
  assert.equal(s.analytics.all.insights.trend, trend);
  assert.deepEqual(s.analytics.all.insights.hours, { h: 3 });
  assert.deepEqual(s.analytics.all.spend, { today: 2 });
  // A whole snapshot (the demo, or an older server) replaces it, keeping analytics it left out.
  s = merge({ now: 3, agents: [] });
  assert.deepEqual(s.agents, []);
  assert.equal(s.analytics.all.insights.trend, trend);
});
