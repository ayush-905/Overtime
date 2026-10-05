// Following one fixture transcript as it's written, through the watcher, the
// way the server does: the first lines are there when it first looks, then
// each next() writes more and reads them.

import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFeed, view } from '../../lib/agents.js';
import { createWatcher } from '../../lib/watcher.js';
import { scratch } from '../helpers.js';
import { ROOT, fixtureFile, fixtureFiles, fixtureLines, placeOf, timeline } from './index.js';

const PREFIX = { claude: '', codex: 'codex-', pi: 'pi-' };

/**
 * Follow the fixture of session (or subagent) `id`, starting with its first
 * `start` lines. `view('09:00:05')` is the agent as the page would see it then.
 */
export async function follow(t, harness, id, { start = 1 } = {}) {
  const root = await scratch(t, 'overtime-follow-');
  const dirs = { claude: path.join(root, 'claude'), codex: path.join(root, 'codex', 'sessions'), pi: path.join(root, 'pi', 'sessions') };
  const { shift, clock } = timeline();
  const rel = await fixtureFile(harness, id);
  const lines = await fixtureLines(rel, shift);
  const file = placeOf(rel, dirs);
  await mkdir(path.dirname(file), { recursive: true });
  // What sits beside it: a subagent's meta file, Codex's names for its chats.
  for (const other of await fixtureFiles(harness)) {
    if (!other.endsWith('.meta.json') && !other.endsWith('session_index.jsonl')) continue;
    const dest = placeOf(other, dirs);
    await mkdir(path.dirname(dest), { recursive: true });
    if (other.endsWith('.jsonl')) await writeFile(dest, (await fixtureLines(other, shift)).join('\n') + '\n');
    else await copyFile(path.join(ROOT, other), dest);
  }
  await writeFile(file, lines.slice(0, start).join('\n') + '\n');
  const feed = createFeed();
  const watcher = createWatcher({ [`${harness}Dir`]: dirs[harness], piHome: path.join(root, 'pi-home'), feed });
  await watcher.discover();
  let written = start;
  const agentId = `${PREFIX[harness]}${id}`;
  const f = {
    feed,
    watcher,
    clock,
    get agent() { return watcher.agents.get(agentId); },
    /** Write the next `n` lines, read them, and give the agent. */
    async next(n = 1) {
      await appendFile(file, lines.slice(written, written + n).join('\n') + '\n');
      written += n;
      await watcher.tick();
      return f.agent;
    },
    /** Write the rest. */
    rest: () => f.next(lines.length - written),
    /** The agent's view at a clock time ('09:00:05'), or a time in ms. */
    view: (time) => view(f.agent, typeof time === 'number' ? time : clock(time)),
    /** The text of what it did lately, as the page shows it, newest last. */
    recent: () => view(f.agent, Date.now()).recent.map((r) => r.text),
  };
  return f;
}
