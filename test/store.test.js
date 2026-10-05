import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'overtime-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** console.error's lines while `t` runs. */
function quiet(t) {
  const said = [];
  const error = console.error;
  console.error = (...parts) => said.push(parts.join(' '));
  t.after(() => {
    console.error = error;
  });
  return said;
}

test('no file gives the fallback, and a saved one comes back as it was', async (t) => {
  const dir = await scratch(t);
  const store = createStore({ dir });
  assert.deepEqual(await store.read('history.json', { days: {} }), { days: {} });
  store.write('history.json', { days: { '2026-09-01': { all: { cost: 1 } } } });
  await store.flush();
  assert.deepEqual(await store.read('history.json', null), { days: { '2026-09-01': { all: { cost: 1 } } } });
  // Nothing half-written is left behind.
  assert.deepEqual(await readdir(dir), ['history.json']);
});

test("a file that isn't JSON any more is put aside, never written over", async (t) => {
  const dir = await scratch(t);
  const said = quiet(t);
  await writeFile(path.join(dir, 'history.json'), '{"version":1,"days":{"2025-01-0');
  const store = createStore({ dir });
  assert.deepEqual(await store.read('history.json', { days: {} }), { days: {} });
  const aside = (await readdir(dir)).find((name) => name.startsWith('history.json.bad-'));
  assert.ok(aside);
  assert.equal(await readFile(path.join(dir, aside), 'utf8'), '{"version":1,"days":{"2025-01-0');
  assert.match(said[0], /kept as history\.json\.bad-/);
  // Starting afresh writes a new one beside it.
  store.write('history.json', { days: {} });
  await store.flush();
  assert.deepEqual((await readdir(dir)).sort(), [aside, 'history.json'].sort());
});

test("a file that's there but can't be read is left alone", async (t) => {
  const dir = await scratch(t);
  const said = quiet(t);
  const file = path.join(dir, 'settings.json');
  await writeFile(file, '{"version":1,"values":{"overtime-theme":"dark"}}');
  await chmod(file, 0o000);
  const store = createStore({ dir });
  assert.equal(await store.read('settings.json', null), null);
  store.write('settings.json', { version: 1, values: {} });
  await store.flush();
  await chmod(file, 0o644);
  assert.equal(await readFile(file, 'utf8'), '{"version":1,"values":{"overtime-theme":"dark"}}');
  assert.match(said[0], /won't save over it/);
});

test('flush writes what was waiting at once, the latest of each', async (t) => {
  const dir = await scratch(t);
  const store = createStore({ dir });
  store.write('prefs.json', { workdayHour: 5 });
  store.write('prefs.json', { workdayHour: 6 });
  store.write('settings.json', { version: 1, values: { 'overtime-theme': 'light' } });
  await store.flush();
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'prefs.json'), 'utf8')), { workdayHour: 6 });
  assert.equal(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).values['overtime-theme'], 'light');
  // Nothing is left to go off later.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual((await readdir(dir)).sort(), ['prefs.json', 'settings.json']);
});
