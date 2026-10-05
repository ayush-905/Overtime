#!/usr/bin/env node
// Signs a build for updates, and puts it in a draft release on GitHub. Run after
// `electron-builder --publish never` (npm run app:release does both):
//
//   node desktop/release.js sign [--dist <folder>]     sign latest-mac.yml there
//   node desktop/release.js publish [--dist <folder>]  sign, check, and upload to a new draft
//
// The private key is ~/.config/overtime/release-key.pem, or the file
// OVERTIME_RELEASE_KEY names; it never goes in the repo. Publishing needs
// GH_TOKEN, a token for the account in package.json's build.publish. It makes
// one draft with every file (electron-builder's own publishing raced itself into
// two), and leaves publishing it, with its notes, to you on GitHub.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNATURE_FILE, parseYaml, signFeed, verifyFeed } from './update-info.js';
import { UPDATE_KEY } from './update-key.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const keyFile = () =>
  process.env.OVERTIME_RELEASE_KEY || path.join(os.homedir(), '.config', 'overtime', 'release-key.pem');

/** Sign latest-mac.yml in `dist`, writing the signature beside it; the feed's text and what it says. */
export async function signBuild(dist, { key = keyFile() } = {}) {
  const feed = path.join(dist, 'latest-mac.yml');
  if (!existsSync(feed)) throw new Error(`There's no latest-mac.yml in ${dist}. Build first.`);
  if (!existsSync(key))
    throw new Error(
      `There's no release key at ${key}. It's the private half of desktop/update-key.js; without it, copies won't install the update.`,
    );
  const text = await fsp.readFile(feed, 'utf8');
  const signature = signFeed(text, await fsp.readFile(key, 'utf8'));
  // A key that isn't the app's would make a release no copy installs.
  if (!verifyFeed(text, signature, UPDATE_KEY))
    throw new Error(`${key} isn't the key that desktop/update-key.js checks for.`);
  await fsp.writeFile(path.join(dist, SIGNATURE_FILE), `${signature}\n`);
  return { text, info: parseYaml(text) };
}

const sha512 = async (file) =>
  createHash('sha512')
    .update(await fsp.readFile(file))
    .digest('base64');

/** The files a release has, each checked against what latest-mac.yml says of it. */
async function releaseFiles(dist, info) {
  const version = String(info.version);
  if (version !== pkg.version)
    throw new Error(`The build in ${dist} is ${version}, but package.json says ${pkg.version}.`);
  const files = ['latest-mac.yml', SIGNATURE_FILE];
  for (const f of info.files || []) {
    const file = path.join(dist, f.url);
    const st = await fsp.stat(file).catch(() => null);
    if (!st) throw new Error(`latest-mac.yml lists ${f.url}, which isn't in ${dist}.`);
    if (Number(f.size) !== st.size || (await sha512(file)) !== f.sha512)
      throw new Error(`${f.url} isn't the file latest-mac.yml describes. Build again.`);
    files.push(f.url);
    if (existsSync(`${file}.blockmap`)) files.push(`${f.url}.blockmap`);
  }
  if (!files.some((f) => f.endsWith('.zip')))
    throw new Error('The build has no zip, which is what copies update from.');
  return files;
}

async function github(url, { token, method = 'GET', body, type = 'application/json' }) {
  const res = await fetch(url.startsWith('https:') ? url : `https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': type } : {}),
    },
    body: body && type === 'application/json' ? JSON.stringify(body) : body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      `GitHub said ${res.status} to ${method} ${url}: ${data?.message || ''}${data?.errors ? ` ${JSON.stringify(data.errors)}` : ''}`,
    );
  return data;
}

async function publish(dist) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Publishing needs GH_TOKEN: a token for the account in package.json build.publish.');
  const { owner, repo } =
    (Array.isArray(pkg.build?.publish) ? pkg.build.publish : [pkg.build?.publish]).find(
      (p) => p?.provider === 'github',
    ) || {};
  if (!owner || !repo) throw new Error('package.json build.publish names no GitHub repo.');
  const { info } = await signBuild(dist);
  const files = await releaseFiles(dist, info);
  const tag = `v${pkg.version}`;
  const releases = await github(`/repos/${owner}/${repo}/releases?per_page=100`, { token });
  const there = releases.find((r) => r.tag_name === tag);
  if (there)
    throw new Error(
      `There's already a${there.draft ? ' draft' : ''} release for ${tag}: ${there.html_url}. Delete it first to make it again.`,
    );
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const release = await github(`/repos/${owner}/${repo}/releases`, {
    token,
    method: 'POST',
    body: { tag_name: tag, target_commitish: commit, name: `Overtime ${pkg.version}`, draft: true },
  });
  for (const name of files) {
    const data = await fsp.readFile(path.join(dist, name));
    await github(
      `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      { token, method: 'POST', body: data, type: 'application/octet-stream' },
    );
    console.log(`uploaded ${name} (${Math.round(data.length / 1024)} KB)`);
  }
  console.log(
    `\nA draft release for ${tag} is ready, signed: ${release.html_url}\nAdd its notes and publish it there; every copy finds it once it's published.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const at = rest.indexOf('--dist');
  const dist = path.resolve(at === -1 ? path.join(ROOT, 'dist') : rest[at + 1]);
  const run =
    command === 'sign'
      ? () => signBuild(dist).then(({ info }) => console.log(`Signed latest-mac.yml for ${info.version} in ${dist}`))
      : command === 'publish'
        ? () => publish(dist)
        : null;
  if (!run) {
    console.error('Use: node desktop/release.js sign|publish [--dist <folder>]');
    process.exit(2);
  }
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
