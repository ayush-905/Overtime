// Picking a session back up, from its panel: in a new Terminal window, or in
// the app it belongs to. Terminal runs a small script Overtime writes to its
// own folder, which needs no permission to control Terminal. The Claude app can
// open a session it started itself, by its own id (local_…), which it keeps in
// a file per session next to the transcript's id; the Codex app opens any Codex
// thread by the id its transcript has. Both only read those files. pi has no
// app, so its sessions resume in Terminal.

import { promises as fsp, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A pi session id: a uuid, or the name you gave it with --session-id (which pi allows only in this shape).
const PI_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const resumable = (source, nativeId) => (source === 'pi' ? PI_ID : UUID).test(nativeId || '');
// What runs in the session's folder to pick it back up.
const COMMAND = { claude: (id) => `claude --resume ${id}`, codex: (id) => `codex resume ${id}`, pi: (id) => `pi --session ${id}` };
const DESKTOP_SESSIONS = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const RESCAN_MS = 30_000;

let desktop = { at: 0, byCli: new Map() };

/** The Claude app's sessions, by the transcript id each one runs: cliSessionId → local_… id. */
async function desktopSessions() {
  if (Date.now() - desktop.at < RESCAN_MS) return desktop.byCli;
  const byCli = new Map();
  // claude-code-sessions/<account>/<org>/local_<id>.json
  const walk = async (dir, depth) => {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (e.isFile() && /^local_[\w-]+\.json$/.test(e.name)) {
        try {
          const s = JSON.parse(await fsp.readFile(full, 'utf8'));
          if (UUID.test(s.cliSessionId || '') && /^local_[A-Za-z0-9-]{1,64}$/.test(s.sessionId || '') && !s.isArchived) byCli.set(s.cliSessionId, s.sessionId);
        } catch {}
      }
    }
  };
  await walk(DESKTOP_SESSIONS, 0);
  desktop = { at: Date.now(), byCli };
  return byCli;
}

const hasApp = (...names) => names.some((n) => existsSync(path.join('/Applications', n)));

/**
 * Where a session can be picked up from: a link that opens it in the Claude
 * app (only for a session the app started), or in the Codex app, and whether
 * Terminal can resume it. `nativeId` is the transcript's own id.
 */
export async function resumeOptions({ source, nativeId }, { appInstalled = hasApp, getDesktopSessions = desktopSessions } = {}) {
  if (!resumable(source, nativeId)) return { terminal: false, app: null };
  if (source === 'pi') return { terminal: true, app: null };
  if (source === 'codex') {
    const app = appInstalled('Codex.app', 'ChatGPT.app') ? { name: 'Codex', url: `codex://threads/${nativeId}` } : null;
    return { terminal: true, app };
  }
  const local = appInstalled('Claude.app') ? (await getDesktopSessions()).get(nativeId) : null;
  return {
    terminal: true,
    app: local ? { name: 'Claude', url: `claude://code/continue?session=${encodeURIComponent(local)}` } : null,
    appMissing: appInstalled('Claude.app') && !local ? 'started outside the Claude app' : null,
  };
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Resume a session in a new Terminal window, in its folder, in your login shell
 * (so `claude`, `codex` and `pi` are on the PATH as usual), and leave you in that shell
 * when it ends. The command is built here from the session's own id and folder,
 * never taken from the page.
 */
const openInTerminal = (file) => new Promise((resolve, reject) => execFile('open', ['-a', 'Terminal', file], (error) => (error ? reject(error) : resolve())));

export async function resumeInTerminal({ source, nativeId, cwd }, dataDir, { open = openInTerminal } = {}) {
  if (!resumable(source, nativeId)) throw new Error('Not a session that can be resumed');
  const command = (COMMAND[source] || COMMAND.claude)(nativeId);
  const dir = path.join(dataDir, 'resume');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${nativeId}.command`);
  const script = [
    '#!/bin/sh',
    '# Written by Overtime to resume a session; removed a minute after it opens.',
    cwd ? `cd ${shellQuote(cwd)} 2>/dev/null || cd "$HOME"` : 'cd "$HOME"',
    `exec "\${SHELL:-/bin/zsh}" -l -c ${shellQuote(`${command}; exec "\${SHELL:-/bin/zsh}" -l`)}`,
    '',
  ].join('\n');
  await fsp.writeFile(file, script, { mode: 0o700 });
  await open(file);
  setTimeout(() => fsp.unlink(file).catch(() => {}), 60_000).unref?.();
  return { ok: true, command, file };
}
