import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, scratch as scratchIn, startServer } from './helpers.js';

const scratch = (t) => scratchIn(t, 'overtime-desktop-');

test('the server takes any free port with PORT=0, says who it is there, and only answers to that port', async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, 'claude', 'project'), { recursive: true });
  const sessionId = '12345678-1234-1234-1234-123456789012';
  await writeFile(
    path.join(dir, 'claude', 'project', `${sessionId}.jsonl`),
    JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      cwd: '/work/shop',
      message: { content: 'Private fixture prompt' },
    }) + '\n',
  );
  const { port } = await startServer(t, dir, 0);
  assert.ok(port > 0 && port !== 4777);
  const hello = await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json();
  assert.equal(hello.app, 'overtime');
  assert.equal(hello.version, JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version);
  assert.equal(hello.desktop, false);
  const target = await fetch(`http://127.0.0.1:${port}/api/session-target?id=${sessionId}`);
  assert.equal(target.status, 200);
  assert.equal(target.headers.get('cache-control'), 'no-store');
  const targetBody = await target.json();
  assert.equal(targetBody.terminal, true);
  assert.ok(!JSON.stringify(targetBody).includes('Private fixture prompt'));
  for (const id of ['not-an-id', '00000000-0000-0000-0000-000000000000']) {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/session-target?id=${id}`)).status, 404);
  }
  // A page pointing some other name at 127.0.0.1 is still turned away.
  const status = await new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/api/hello', headers: { Host: 'evil.example' } }, (res) =>
        resolve(res.statusCode),
      )
      .on('error', reject);
  });
  assert.equal(status, 403);

  // A second one on the same port says what's there, and stops.
  const second = await startServer(t, dir, port);
  assert.equal(second.code, 1);
  assert.match(second.out, new RegExp(`Port ${port} is taken`));
});

test("the server keeps going after a request it can't read and a transcript line it can't make sense of", async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, 'claude', 'project'), { recursive: true });
  const now = new Date().toISOString();
  const lines = [
    { type: 'user', timestamp: now, cwd: '/work/shop', message: { content: 'Tidy the shop' } },
    {
      type: 'assistant',
      timestamp: now,
      cwd: '/work/shop',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', input: {} }] },
    },
  ];
  await writeFile(
    path.join(dir, 'claude', 'project', '12345678-1234-1234-1234-123456789012.jsonl'),
    lines.map((x) => JSON.stringify(x)).join('\n') + '\n',
  );
  const { port, code, out } = await startServer(t, dir, 0);
  assert.ok(port, `it started: ${code} ${out}`);
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '//[' }, (res) => resolve(res.statusCode)).on('error', reject);
  });
  assert.equal(status, 400);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).app, 'overtime');
});

test('settings changed just before the server stops are saved', async (t) => {
  const dir = await scratch(t);
  const { child, port } = await startServer(t, dir, 0);
  const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Overtime': '1' },
    body: JSON.stringify({ set: { 'overtime-theme': 'dark' } }),
  });
  assert.equal(res.status, 204);
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  const saved = JSON.parse(await readFile(path.join(dir, 'data', 'settings.json'), 'utf8'));
  assert.equal(saved.values['overtime-theme'], 'dark');
});

test('the app knows Overtime on a port, and nothing else', async (t) => {
  const { hello } = await import('../desktop/hello.js');
  /** A stand-in on a free port, answering with `routes[path]` or a 404. */
  const serve = (routes) =>
    new Promise((resolve) => {
      const server = http
        .createServer((req, res) => {
          const body = routes[req.url];
          res
            .writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
            .end(body ? JSON.stringify(body) : 'Not found');
        })
        .listen(0, '127.0.0.1', () => resolve(server.address().port));
      t.after(() => server.close());
    });
  const current = await serve({ '/api/hello': { app: 'overtime', version: '0.3.0' } });
  assert.equal((await hello(current)).version, '0.3.0');
  // Anything else on the port, even another app's /api/hello, isn't it.
  const other = await serve({ '/api/hello': { app: 'something-else', version: '1.0.0' } });
  assert.equal(await hello(other), null);
  const free = await serve({});
  assert.equal(await hello(free), null);
});

test("the app's PATH keeps the one it had, even when the login shell doesn't answer", async (t) => {
  const before = [process.env.SHELL, process.env.PATH];
  t.after(() => {
    process.env.SHELL = before[0];
    process.env.PATH = before[1];
  });
  process.env.SHELL = '/nonexistent/shell';
  process.env.PATH = '/usr/bin:/bin:/usr/bin';
  const { loginPath } = await import('../desktop/shell-path.js');
  const found = (await loginPath({ timeoutMs: 1000 })).split(':');
  assert.deepEqual(found.slice(0, 2), ['/usr/bin', '/bin']);
  assert.equal(new Set(found).size, found.length);
});

test("the app's settings: what's saved is checked, and anything unknown falls back", async (t) => {
  const dir = await scratch(t);
  const before = process.env.OVERTIME_DIR;
  process.env.OVERTIME_DIR = dir;
  t.after(() => {
    if (before == null) delete process.env.OVERTIME_DIR;
    else process.env.OVERTIME_DIR = before;
  });
  const { readPrefs, savePrefs } = await import(`../desktop/prefs.js?${Date.now()}`);
  assert.deepEqual(readPrefs(), {
    menuBarShows: 'limits',
    hideDockWhenClosed: false,
    bounds: null,
    officeBounds: null,
  });
  savePrefs({ menuBarShows: 'cost', bounds: { x: 10, y: 20, width: 900, height: 700 } });
  assert.equal(JSON.parse(await readFile(path.join(dir, 'desktop.json'), 'utf8')).menuBarShows, 'cost');
  const next = savePrefs({
    menuBarShows: 'loud',
    hideDockWhenClosed: 'yes',
    officeBounds: { x: 0, y: 0, width: 5, height: 5 },
  });
  assert.equal(next.menuBarShows, 'limits');
  assert.equal(next.hideDockWhenClosed, false);
  assert.equal(next.officeBounds, null);
  assert.deepEqual(next.bounds, { x: 10, y: 20, width: 900, height: 700 });
});

test('an update is read from what electron-builder writes, and only a newer version counts', async () => {
  const { parseYaml, isNewer, pickZip, updateSource } = await import('../desktop/update-info.js');
  const info = parseYaml(`version: 0.4.0
files:
  - url: overtime-0.4.0-arm64.zip
    sha512: abc+/=
    size: 114251795
  - url: overtime-0.4.0-x64.zip
    sha512: def
    size: 120000000
  - url: overtime-0.4.0-arm64.dmg
    sha512: ghi
    size: 114428411
path: overtime-0.4.0-arm64.zip
sha512: abc+/=
releaseDate: '2026-09-29T10:00:00.000Z'
`);
  assert.equal(info.version, '0.4.0');
  assert.equal(info.files.length, 3);
  assert.equal(info.releaseDate, '2026-09-29T10:00:00.000Z');
  assert.deepEqual(pickZip(info, 'arm64'), { url: 'overtime-0.4.0-arm64.zip', sha512: 'abc+/=', size: 114251795 });
  assert.equal(pickZip(info, 'x64').url, 'overtime-0.4.0-x64.zip');
  assert.equal(pickZip({ files: [] }, 'arm64'), null);

  assert.equal(isNewer('0.4.0', '0.3.9'), true);
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
  assert.equal(isNewer('v1.0.0', '1.0.0-beta.2'), true);
  assert.equal(isNewer('1.0.0-beta.10', '1.0.0-beta.2'), true);
  assert.equal(isNewer('0.3.0', '0.3.0'), false);
  assert.equal(isNewer('0.2.9', '0.3.0'), false);

  const github = updateSource(
    parseYaml('owner: ayush-905\nrepo: overtime\nprovider: github\nupdaterCacheDirName: overtime-updater\n'),
  );
  assert.equal(github.feed, 'https://github.com/ayush-905/overtime/releases/latest/download/');
  assert.equal(
    new URL('overtime-0.4.0-arm64.zip', github.feed).href,
    'https://github.com/ayush-905/overtime/releases/latest/download/overtime-0.4.0-arm64.zip',
  );
  assert.equal(updateSource({ provider: 'generic', url: 'http://insecure.example/updates' }), null);
  assert.equal(
    updateSource({ provider: 'generic', url: 'https://example.com/updates' }).feed,
    'https://example.com/updates/',
  );
});

test('the swap waits for the app to quit, puts the new one in its place, and puts the old one back if it must', async (t) => {
  const { SWAP_SCRIPT } = await import('../desktop/update-info.js');
  const { execFileSync } = await import('node:child_process');
  const { writeFile, readFile: read, access } = await import('node:fs/promises');
  const dir = await scratch(t);
  const make = async (where, text) => {
    await mkdir(path.join(where, 'Contents'), { recursive: true });
    await writeFile(path.join(where, 'Contents', 'version'), text);
  };
  const running = path.join(dir, 'Overtime.app');
  const downloads = path.join(dir, 'updates');
  const next = path.join(downloads, 'v2', 'Overtime.app');
  await make(running, '1');
  await make(next, '2');
  // The "app" quits a moment later, and the swap has to wait for it. Started by a
  // shell that leaves at once, like the real app it's nobody's child here.
  const pid = String(execFileSync('/bin/sh', ['-c', 'sleep 0.6 >/dev/null 2>&1 & echo $!'])).trim();
  const started = Date.now();
  execFileSync('/bin/sh', ['-c', SWAP_SCRIPT, 'test', pid, running, next, '0', downloads]);
  assert.ok(Date.now() - started >= 400);
  assert.equal(await read(path.join(running, 'Contents', 'version'), 'utf8'), '2');
  await assert.rejects(access(`${running}.replaced`));
  await assert.rejects(access(downloads));

  // Nothing to move in: the app it had stays.
  execFileSync('/bin/sh', [
    '-c',
    SWAP_SCRIPT,
    'test',
    '999999',
    running,
    path.join(dir, 'missing.app'),
    '0',
    downloads,
  ]);
  assert.equal(await read(path.join(running, 'Contents', 'version'), 'utf8'), '2');
  await assert.rejects(access(`${running}.replaced`));
});

test('the dashboard is at / and /mini, with your settings in its page and its built files kept a year', async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, 'claude'), { recursive: true });
  const { port } = await startServer(t, dir, 0);
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /window\.overtimeSettings = /);
  // /mini is the same page, in its compact layout.
  assert.match(await (await fetch(`${base}/mini`)).text(), /overtimeSettings/);
  const script = html.match(/src="\.\/(assets\/[\w.-]+\.js)"/)?.[1];
  assert.ok(script, 'the page names its script');
  const asset = await fetch(`${base}/${script}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  // Nothing outside web/app can be reached from there.
  for (const bad of [
    '/assets/../../../server.js',
    '/%2e%2e/server.js',
    '/assets/x/y.js',
    '/assets/..%2fserver.js',
    '/dashboard/app.js',
  ]) {
    assert.equal((await fetch(`${base}${bad}`)).status, 404, bad);
  }
});
