// @ts-check
// The pages' own files. Each page is a folder under web/, and all use web/shared.
// Only plain file names are served, so nothing outside those folders can be
// reached. The dashboard (web/app, built from ui/) keeps its files in assets/,
// with the hash of what's in them in their names, so they can be kept a year.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { newNonce, pagePolicy, withNonce } from './page-policy.js';

const MOUNTS = [
  ['/office/', 'office'],
  ['/shared/', 'shared'],
  ['/', 'app'],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
};

/** The file an address names under `webDir`, as [path, type, whether it can be kept a year]; null for anything else. */
export function staticFile(webDir, pathname) {
  const [prefix, dir] = MOUNTS.find(([p]) => pathname.startsWith(p)) || [];
  if (!dir) return null;
  let name = pathname.slice(prefix.length) || 'index.html';
  // The compact view for a menu bar: the dashboard's page, in its mini layout.
  if (dir === 'app' && /^mini\/?$/.test(name)) name = 'index.html';
  const type = TYPES[path.extname(name)];
  const plain = dir === 'app' ? /^(assets\/)?[\w-]+(\.[\w-]+)*$/ : /^[\w-]+(\.[\w-]+)*$/;
  return plain.test(name) && type
    ? [path.join(webDir, dir, name), type, dir === 'app' && name.startsWith('assets/')]
    : null;
}

/**
 * Answer with the file an address names, or Not found. `page(html)` fills in a
 * page (index.html) before it goes, and a page goes with its policy (page-policy.js)
 * and a nonce of its own on its scripts.
 */
export async function serveFile(res, webDir, pathname, page) {
  const entry = staticFile(webDir, pathname);
  let body;
  try {
    body = entry && (await fsp.readFile(entry[0]));
  } catch {}
  if (!entry || !body) {
    res.writeHead(404).end('Not found');
    return;
  }
  const headers = {
    'Content-Type': entry[1],
    'Cache-Control': entry[2] ? 'public, max-age=31536000, immutable' : 'no-store',
  };
  if (!entry[0].endsWith('index.html')) {
    res.writeHead(200, headers).end(body);
    return;
  }
  const nonce = newNonce();
  res
    .writeHead(200, {
      ...headers,
      'Content-Security-Policy': pagePolicy(nonce),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
    .end(withNonce(page(body), nonce));
}
