import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { watchFolders } from '../lib/folder-watch.js';
import { scratch } from './helpers.js';

const until = async (check, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 25)))
    if (check()) return true;
  return false;
};

test('a change anywhere under a watched folder is told, deep down too', async (t) => {
  const dir = await scratch(t, 'overtime-watch-');
  await mkdir(path.join(dir, '2026', '10', '04'), { recursive: true });
  let changes = 0;
  const watch = watchFolders(() => changes++);
  t.after(() => watch.close());
  watch.set([dir]);
  assert.equal(watch.ok, true);
  // Setting it counts as a change: whatever came before the watch is unknown.
  assert.equal(changes, 1);
  // The same folders again change nothing.
  watch.set([dir]);
  assert.equal(changes, 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const file = path.join(dir, '2026', '10', '04', 'rollout.jsonl');
  await writeFile(file, '{}\n');
  assert.ok(await until(() => changes > 1), 'a new file deep down was told');
  const before = changes;
  await appendFile(file, '{}\n');
  assert.ok(await until(() => changes > before), 'a file growing was told');
});

test("a folder that isn't there can't be watched, so the server keeps looking as before", async (t) => {
  const dir = await scratch(t, 'overtime-watch-');
  const watch = watchFolders(() => {});
  t.after(() => watch.close());
  watch.set([path.join(dir, 'missing')]);
  assert.equal(watch.ok, false);
  watch.set([]);
  assert.equal(watch.ok, false);
});
