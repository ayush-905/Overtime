// What electron-builder writes for updates, read without Electron so it can be
// tested: app-update.yml inside the built app (where to look, from `publish` in
// package.json) and latest-mac.yml in each release (the version, and each file
// with its size and SHA-512). Only the little YAML those two use.

const unquote = (v) => {
  const t = v.trim();
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(t)) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  return t;
};

/** `key: value` lines, and a list of `- key: value` blocks under a key with nothing after it. */
export function parseYaml(text) {
  const out = {};
  let list = null;
  let item = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const dash = line.startsWith('- ');
    const m = (dash ? line.slice(2) : line).match(/^([\w.-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (indent === 0 && !dash) {
      if (value === '') {
        list = out[key] = [];
        item = null;
      } else {
        out[key] = unquote(value);
        list = null;
      }
    } else if (list) {
      if (dash) list.push((item = {}));
      if (item) item[key] = unquote(value);
    }
  }
  return out;
}

const parts = (v) => {
  const [main, pre = ''] = String(v || '').replace(/^v/, '').split('-', 2);
  return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
};

/** Whether version `a` comes after `b`: 0.4.0 after 0.3.9, and 1.0.0 after 1.0.0-beta.2. */
export function isNewer(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (!x.pre) return true;
  if (!y.pre) return false;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true }) > 0;
}

/** The release's zip for this Mac's chip: { url, sha512, size }, or null. */
export function pickZip(info, arch = process.arch) {
  const zips = (Array.isArray(info?.files) ? info.files : []).filter((f) => /\.zip$/i.test(f.url || '') && f.sha512);
  const file = zips.find((f) => new RegExp(`[-_.]${arch}[-_.]`, 'i').test(f.url)) || (zips.length === 1 ? zips[0] : null);
  return file ? { url: file.url, sha512: file.sha512, size: Number(file.size) || 0 } : null;
}

/** Where releases are, from app-update.yml: { feed, page, where } for the newest one, or null. */
export function updateSource(config) {
  if (config?.provider === 'github' && config.owner && config.repo) {
    const repo = `https://github.com/${config.owner}/${config.repo}`;
    return { feed: `${repo}/releases/latest/download/`, page: `${repo}/releases/latest`, where: `github.com/${config.owner}/${config.repo}` };
  }
  if (config?.provider === 'generic' && /^https:\/\//.test(config.url || '')) {
    const feed = config.url.endsWith('/') ? config.url : `${config.url}/`;
    return { feed, page: feed, where: new URL(feed).host };
  }
  return null;
}

/**
 * Puts a downloaded app in place of this one once it has quit: `sh -c` with the
 * app's pid, its path, the new app's path, 1 to open it after, and the download
 * folder to clear. If the new one can't be moved in, the old one goes back.
 */
export const SWAP_SCRIPT = [
  'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
  'old="$2.replaced"',
  'rm -rf "$old"',
  'if mv "$2" "$old"; then',
  '  if mv "$3" "$2"; then rm -rf "$old"; else mv "$old" "$2"; fi',
  'fi',
  'rm -rf "$5"',
  'if [ "$4" = 1 ]; then open "$2"; fi',
].join('\n');
