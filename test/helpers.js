// What the tests that run the server share: a scratch folder, and server.js started in it.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function scratch(t, prefix = 'overtime-test-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** server.js on a port, reading only what's in `dir`; resolves once it says where it is. */
export function startServer(t, dir, port) {
  const env = { ...process.env, PORT: String(port), OVERTIME_DIR: path.join(dir, 'data'), CLAUDE_PROJECTS_DIR: path.join(dir, 'claude'), CODEX_SESSIONS_DIR: path.join(dir, 'codex'), PI_SESSIONS_DIR: path.join(dir, 'pi') };
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start: ${out}`)), 10_000);
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/open at http:\/\/localhost:(\d+)/);
      if (m) done({ child, port: Number(m[1]) });
    });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => done({ child, code, out }));
  });
}
