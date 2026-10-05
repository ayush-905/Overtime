// An app opened from the Dock or Finder gets a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// without Homebrew, npm's global folder or ~/.local/bin, so the server couldn't
// start the `codex` command for your Codex limits. This asks your login shell,
// once at start, for the PATH you have in Terminal, and keeps the usual places
// on it too in case the shell is slow or says nothing.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARK = '__OVERTIME_PATH__';
const home = os.homedir();
const USUAL = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  path.join(home, '.local', 'bin'),
  path.join(home, '.npm-global', 'bin'),
  path.join(home, '.bun', 'bin'),
  path.join(home, '.volta', 'bin'),
];

/** Every folder once, in the order first seen. */
const join = (...lists) => [...new Set(lists.flatMap((l) => String(l || '').split(':')).filter(Boolean))].join(':');

/** What your login shell's PATH is, or null if it doesn't answer in time. */
function askShell(timeoutMs) {
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    // -i and -l, so it reads .zshrc and .zprofile as Terminal does. The marks
    // keep out anything those print on their own.
    execFile(
      shell,
      ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`],
      { timeout: timeoutMs, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (error, stdout) => {
        const found = String(stdout || '').split(MARK)[1];
        resolve(found || null);
      },
    );
  });
}

/** The PATH the server should run with. */
export async function loginPath({ timeoutMs = 4000 } = {}) {
  if (process.platform === 'win32') return process.env.PATH || '';
  const fromShell = await askShell(timeoutMs);
  return join(fromShell, process.env.PATH, USUAL.filter((dir) => existsSync(dir)).join(':'));
}
