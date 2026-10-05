import test from 'node:test';
import assert from 'node:assert/strict';
import { pagePolicy, withNonce } from '../lib/page-policy.js';
import { scratch, startServer } from './helpers.js';

test('each script on a page gets the nonce, and one that already has one keeps it', () => {
  const html = '<script>a()</script><script type="module" src="./x.js"></script><script nonce="old">b()</script>';
  assert.equal(
    withNonce(html, 'n1'),
    '<script nonce="n1">a()</script><script nonce="n1" type="module" src="./x.js"></script><script nonce="old">b()</script>',
  );
  const policy = pagePolicy('n1');
  assert.match(policy, /script-src 'self' 'nonce-n1'(;|$)/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
});

test('the pages go out with a policy that lets only their own scripts run, with a new nonce each time', async (t) => {
  const dir = await scratch(t);
  const { port } = await startServer(t, dir, 0);
  const nonces = new Set();
  for (const page of ['/', '/mini', '/office/', '/']) {
    const res = await fetch(`http://127.0.0.1:${port}${page}`);
    assert.equal(res.status, 200, page);
    const policy = res.headers.get('content-security-policy');
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce, `${page} has a nonce in its policy`);
    nonces.add(nonce);
    const html = await res.text();
    const scripts = html.match(/<script\b[^>]*>/g) || [];
    assert.ok(scripts.length >= 2, `${page} has its scripts`);
    for (const tag of scripts) assert.ok(tag.includes(`nonce="${nonce}"`), `${page}: ${tag}`);
    // The settings the server puts in run too.
    assert.match(html, new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">\\s*// Your settings`));
  }
  assert.equal(nonces.size, 4);
  // Files other than pages need no policy.
  const css = await fetch(`http://127.0.0.1:${port}/office/style.css`);
  assert.equal(css.headers.get('content-security-policy'), null);
});
