// Pi (pi.dev): <sessions>/--<folder>--/<time>_<id>.jsonl, a folder per project,
// or all in one with its sessionDir setting. Its sessions are read by pi.js
// (live) and pi-usage.js (history).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { applyPiEvent } from '../pi.js';
import { applyPiRecord, piAgentDir, piFileId, piId, piSessionsDir, refreshPiWindows } from '../pi-usage.js';

export default {
  id: 'pi',
  name: 'Pi',
  prefix: 'pi-',
  // A uuid, or the name you gave it with --session-id (which Pi allows only in this shape).
  nativeId: /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/,
  folder: (env) => env.PI_SESSIONS_DIR || piSessionsDir(env),

  /** `piHome` is Pi's own folder, for the context windows it works with (tests pass their own). */
  open({ dir, env = process.env, piHome = piAgentDir(env) }) {
    async function* files(folder, since) {
      let entries = [];
      try { entries = await fsp.readdir(folder, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const file = path.join(folder, e.name);
        if (e.isDirectory() && folder === dir) {
          yield* files(file, since);
          continue;
        }
        const native = e.isFile() && e.name.endsWith('.jsonl') && piFileId(e.name);
        if (!native) continue;
        const st = await fsp.stat(file).catch(() => null);
        if (st && st.mtimeMs >= since) yield { file, st, id: piId(native), nativeId: native, session: piId(native), sub: false, parentId: null };
      }
    }
    return {
      dir,
      transcripts: (since) => files(dir, since),
      refresh: () => refreshPiWindows(piHome),
      live: applyPiEvent,
      indexLine: (f, line, addText) => applyPiRecord(f, JSON.parse(line), addText),
    };
  },

  resume: { command: (id) => `pi --session ${id}` },
  // Pi names its process `pi`, which also hides its arguments, so a resumed
  // session is the one in its folder that's been active since it started.
  process: { exe: 'pi', script: /\/pi-coding-agent\//, byActivity: true },
  commands: {
    dir: () => path.join(piAgentDir(), 'prompts'),
    use: (name) => `/${name}`,
    noun: 'Pi prompt template',
  },
  tools: {
    reads: new Set(['read', 'grep', 'find', 'ls']),
    writes: new Set(['edit', 'write']),
    command: (name) => name === 'bash' || name === 'powershell',
    delegate: () => false,
  },
};
