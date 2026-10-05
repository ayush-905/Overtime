import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staticFile } from '../lib/static-files.js';

test("only plain file names in the pages' folders are served", () => {
  const web = '/srv/web';
  assert.deepEqual(staticFile(web, '/'), [path.join(web, 'app', 'index.html'), 'text/html; charset=utf-8', false]);
  assert.deepEqual(staticFile(web, '/mini/')?.[0], path.join(web, 'app', 'index.html'));
  assert.deepEqual(staticFile(web, '/assets/Chart-B9.js'), [
    path.join(web, 'app', 'assets', 'Chart-B9.js'),
    'text/javascript; charset=utf-8',
    true,
  ]);
  assert.deepEqual(staticFile(web, '/office/')?.[0], path.join(web, 'office', 'index.html'));
  assert.deepEqual(staticFile(web, '/shared/live.js')?.[2], false);
  for (const p of ['/shared/../server.js', '/office/assets/x.js', '/assets/a/b.js', '/nope', '/api/unknown', '/x.exe'])
    assert.equal(staticFile(web, p), null, p);
});
