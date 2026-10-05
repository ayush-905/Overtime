// Updates from GitHub Releases, installed by the app itself. It looks where the
// build says (app-update.yml, from `publish` in package.json) half a minute
// after it starts and every 6 hours, or when you ask. A release counts only when
// its latest-mac.yml is signed with Overtime's release key (update-key.js), so
// nobody else can ship one, even with the GitHub account. A newer version
// downloads in the background and has to match the size and SHA-512 that signed
// file lists; unpacked, it has to be this app, at that version, with its code
// signature intact. Then it replaces this one when you quit, or at once if you
// restart to update.
//
// Electron's own updater (Squirrel) only installs updates to an app signed with
// an Apple Developer ID, so this swaps the app itself, as Sparkle does: a small
// script waits for the app to quit, moves the new one into place (and the old
// one back if that fails), and opens it again if you asked.

import { app, powerSaveBlocker } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { accessSync, constants, createWriteStream, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SIGNATURE_FILE, SWAP_SCRIPT, isNewer, parseYaml, pickZip, trustedFeed, updateSource } from './update-info.js';
import { UPDATE_KEY } from './update-key.js';

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 3_600_000;

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) =>
      error ? reject(new Error(String(stderr || error.message).trim())) : resolve(String(stdout).trim()),
    );
  });

/** Where to look: the build's app-update.yml, or for a trial a feed on this Mac (OVERTIME_UPDATE_FEED). */
function readSource() {
  const trial = process.env.OVERTIME_UPDATE_FEED;
  if (trial && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(trial))
    return { feed: trial, page: trial, where: new URL(trial).host };
  try {
    return updateSource(parseYaml(readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * `onChange(status)` hears each step. The status's `state` is idle, checking,
 * latest, downloading (with `progress`), ready, manual (newer, but it can't
 * replace itself where it is) or error (with `message`).
 */
export function createUpdater({ log = () => {}, onChange = () => {} } = {}) {
  // …/Overtime.app/Contents/MacOS/Overtime
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  const source = readSource();
  const supported = app.isPackaged && process.platform === 'darwin' && bundle.endsWith('.app') && !!source;
  const dir = path.join(app.getPath('userData'), 'updates');
  let status = { state: 'idle' };
  let installing = false;

  function set(next) {
    status = next;
    onChange(status);
    return status;
  }

  function fail(message, version) {
    log(`update: ${message}`);
    return set({ state: 'error', message, version });
  }

  /** Whether it can move itself aside: not from a disk image, a read-only folder, or where macOS put it to open it once. */
  function replaceable() {
    if (bundle.includes('/AppTranslocation/')) return false;
    try {
      accessSync(path.dirname(bundle), constants.W_OK);
      accessSync(bundle, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Download, check and unpack a version; the new app's path. */
  async function fetchUpdate(version, file) {
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    const zip = path.join(dir, `update-${version}.zip`);
    const res = await fetch(new URL(file.url, source.feed), { signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Couldn't download ${version} (${res.status}).`);
    const hash = createHash('sha512');
    const out = createWriteStream(zip);
    const total = file.size || Number(res.headers.get('content-length')) || 0;
    let got = 0;
    let shown = 0;
    for await (const chunk of Readable.fromWeb(res.body)) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct >= shown + 10) {
        shown = pct;
        set({ ...status, progress: pct });
      }
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    if (file.size && got !== file.size)
      throw new Error(`The download was ${got} bytes, not the ${file.size} its release lists.`);
    if (hash.digest('base64') !== file.sha512)
      throw new Error("The download doesn't match the checksum its release lists.");

    const into = path.join(dir, `v${version}`);
    await fsp.mkdir(into);
    await run('/usr/bin/ditto', ['-x', '-k', zip, into]);
    await fsp.rm(zip, { force: true });
    const name = (await fsp.readdir(into)).find((n) => n.endsWith('.app'));
    if (!name) throw new Error('The download has no app in it.');
    const next = path.join(into, name);
    const plist = (of, key) =>
      run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(of, 'Contents', 'Info.plist')]);
    const [id, ours, theirs] = await Promise.all([
      plist(next, 'CFBundleIdentifier'),
      plist(bundle, 'CFBundleIdentifier'),
      plist(next, 'CFBundleShortVersionString'),
    ]);
    if (id !== ours) throw new Error(`The download is a different app (${id}).`);
    if (theirs !== version) throw new Error(`The download is version ${theirs}, not ${version}.`);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', next]);
    return next;
  }

  /** Look for a newer version; one found starts downloading. Resolves once it knows, not once it's downloaded. */
  async function check() {
    if (!supported || ['checking', 'downloading', 'ready'].includes(status.state)) return status;
    set({ state: 'checking' });
    let info;
    try {
      const get = (name) => fetch(`${source.feed}${name}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
      const [res, sig] = await Promise.all([get('latest-mac.yml'), get(SIGNATURE_FILE)]);
      if (res.status === 404) throw new Error(`There's no release on ${source.where} yet.`);
      if (!res.ok) throw new Error(`${source.where} answered with ${res.status}.`);
      // Nothing in it counts until the signature says it's Overtime's own: not even the version.
      info = trustedFeed(await res.text(), sig.ok ? await sig.text() : '', UPDATE_KEY);
      if (!info)
        throw new Error(
          `The newest release on ${source.where} isn't signed with Overtime's release key, so it won't be installed.`,
        );
      if (!info.version) throw new Error(`The release on ${source.where} doesn't say its version.`);
    } catch (error) {
      if (error.name === 'TimeoutError') return fail(`${source.where} didn't answer.`);
      // fetch says only "fetch failed"; the reason is underneath, like ENOTFOUND when offline.
      return fail(
        error.cause ? `Couldn't reach ${source.where} (${error.cause.code || error.cause.message}).` : error.message,
      );
    }
    const version = String(info.version);
    if (!isNewer(version, app.getVersion())) return set({ state: 'latest', version, checkedAt: Date.now() });
    if (!replaceable())
      return set({
        state: 'manual',
        version,
        message: `It can't replace itself where it is (${path.dirname(bundle)}). Move it to Applications, or download the new version.`,
      });
    const file = pickZip(info);
    if (!file) return fail(`The release has no zip for this Mac (${process.arch}).`, version);
    log(`update: downloading ${version}`);
    set({ state: 'downloading', version, progress: 0 });
    // Left in the background, or with the screen locked, macOS naps the app, and a
    // download would all but stop; it stays awake until this one's done.
    const awake = powerSaveBlocker.start('prevent-app-suspension');
    fetchUpdate(version, file)
      .then(
        (next) => {
          log(`update: ${version} is ready`);
          set({ state: 'ready', version, app: next });
        },
        (error) => fail(error.message, version),
      )
      .finally(() => powerSaveBlocker.stop(awake));
    return status;
  }

  /** Swap in the downloaded version once the app has quit, and open it if `relaunch`. False if there's nothing to install. */
  function install({ relaunch = false } = {}) {
    if (status.state !== 'ready' || installing) return false;
    installing = true;
    spawn(
      '/bin/sh',
      ['-c', SWAP_SCRIPT, 'overtime-update', String(process.pid), bundle, status.app, relaunch ? '1' : '0', dir],
      { detached: true, stdio: 'ignore' },
    ).unref();
    log(`update: installing ${status.version} once the app quits${relaunch ? ', then opening it' : ''}`);
    return true;
  }

  function start() {
    if (!supported) return;
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    const tick = () => {
      check();
      setTimeout(tick, CHECK_EVERY_MS);
    };
    setTimeout(tick, process.env.OVERTIME_UPDATE_FEED ? 3000 : FIRST_CHECK_MS);
  }

  return { supported, source, status: () => status, check, install, start };
}
