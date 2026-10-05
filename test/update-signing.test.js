import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signFeed, trustedFeed, verifyFeed } from '../desktop/update-info.js';
import { UPDATE_KEY } from '../desktop/update-key.js';
import { signBuild } from '../desktop/release.js';
import { scratch } from './helpers.js';

const FEED = `version: 0.7.0
files:
  - url: overtime-0.7.0-arm64.zip
    sha512: abc==
    size: 10
path: overtime-0.7.0-arm64.zip
`;

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
};

test("a release's latest-mac.yml counts only with its key's signature of exactly that text", () => {
  const ours = keys();
  const theirs = keys();
  const signature = signFeed(FEED, ours.priv);
  assert.equal(verifyFeed(FEED, signature, ours.pub), true);
  assert.equal(trustedFeed(FEED, signature, ours.pub).version, '0.7.0');
  // One changed character, another key, no signature or a broken one: none of it counts.
  assert.equal(trustedFeed(FEED.replace('size: 10', 'size: 11'), signature, ours.pub), null);
  assert.equal(trustedFeed(FEED, signFeed(FEED, theirs.priv), ours.pub), null);
  assert.equal(trustedFeed(FEED, '', ours.pub), null);
  assert.equal(trustedFeed(FEED, 'not base64 at all!', ours.pub), null);
  assert.equal(trustedFeed(FEED, `${signature}\n`, ours.pub).version, '0.7.0');
});

test("the app's key is an Ed25519 public key, and the release script won't sign with any other", async (t) => {
  assert.match(UPDATE_KEY, /^-----BEGIN PUBLIC KEY-----\n[\w+/=]+\n-----END PUBLIC KEY-----\n$/);
  const dist = await scratch(t, 'overtime-release-');
  const key = path.join(dist, 'other-key.pem');
  await writeFile(key, keys().priv);
  await assert.rejects(signBuild(dist, { key }), /no latest-mac\.yml/);
  await writeFile(path.join(dist, 'latest-mac.yml'), FEED);
  await assert.rejects(signBuild(dist, { key: path.join(dist, 'missing.pem') }), /no release key/);
  await assert.rejects(signBuild(dist, { key }), /isn't the key that desktop\/update-key\.js checks for/);
});
