// Read-only account RPCs through the installed Codex app server. No thread or
// model is started, and credentials are never read or returned by this server.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// Which Overtime is asking, as the app server's handshake wants to know.
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '';
  } catch {
    return '';
  }
})();

const number = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
export function normalizeCodexLimits(body, { source = 'exact', observedAt = Date.now(), accountId = 'local' } = {}) {
  const buckets = body.rateLimitsByLimitId || { [body.limit_id || body.limitId || 'codex']: body.rateLimits || body };
  const windows = [];
  for (const [bucketId, b] of Object.entries(buckets || {})) {
    if (!b) continue;
    for (const kind of ['primary', 'secondary']) {
      const w = b[kind];
      if (!w) continue;
      const minutes = number(w.windowDurationMins ?? w.window_minutes);
      const percent = number(w.usedPercent ?? w.used_percent);
      const reset = number(w.resetsAt ?? w.resets_at);
      windows.push({
        provider: 'codex',
        accountId,
        bucketId,
        kind,
        id: `${accountId}:${bucketId}:${kind}`,
        bucketName: b.limitName || b.limit_name || bucketId,
        durationMs: minutes == null ? null : minutes * 60000,
        usedPercent: percent == null ? null : Math.min(100, Math.max(0, percent)),
        resetsAt: reset == null ? null : reset > 1e10 ? reset : reset * 1000,
        plan: b.planType || b.plan_type || null,
      });
    }
  }
  return {
    provider: 'codex',
    accountId,
    status: windows.length ? 'ok' : 'unavailable',
    source,
    observedAt,
    windows,
    message: windows.length ? null : 'Codex has not reported any plan quota windows.',
  };
}

const HOUR = 3_600_000;
const SAME_WINDOW_MS = 5 * 60_000; // readings whose reset times are this close are the same window
const HISTORY_POINTS = 90;

/**
 * One window's readings so far, as [t, % used], and its recent pace in % per
 * ms: the change over the last hour (the last day for longer windows), with the
 * window starting from 0%. Codex only reports while you use it, so a quiet
 * stretch slows the pace down, as it should.
 */
export function windowPace(log, w, now = Date.now()) {
  if (!w.resetsAt || !w.durationMs) return null;
  const start = w.resetsAt - w.durationMs;
  const points = log
    .filter(
      ([t, bucket, kind, , reset]) =>
        bucket === w.bucketId &&
        kind === w.kind &&
        t >= start &&
        t <= now &&
        Math.abs(reset - w.resetsAt) < SAME_WINDOW_MS,
    )
    .map(([t, , , used]) => [t, used]);
  if (!points.length) return null;
  const lookback = w.durationMs <= 6 * HOUR ? HOUR : 24 * HOUR;
  const from = Math.max(start, now - lookback);
  const usedAt = (t) => points.reduce((v, [pt, used]) => (pt <= t ? used : v), 0);
  const rate = Math.max(0, usedAt(now) - usedAt(from)) / Math.max(now - from, 60_000);
  // Enough points to draw it; the last one always stays.
  const every = Math.ceil(points.length / HISTORY_POINTS);
  const history = points.filter((_, i) => i % every === 0 || i === points.length - 1);
  return { rate, basis: lookback === HOUR ? 'over the last hour' : 'over the last day', history, start };
}

export function recordedCodexLimits(index, now = Date.now()) {
  const q = index.quota();
  if (!q)
    return {
      provider: 'codex',
      status: 'unavailable',
      source: 'recorded',
      windows: [],
      message: 'No Codex quota snapshot has been recorded on this Mac yet.',
    };
  const limits = normalizeCodexLimits(q.value, { source: 'recorded', observedAt: q.t });
  const log = index.quotaLog();
  for (const w of limits.windows) w.pace = windowPace(log, w, now);
  return limits;
}

export function readCodexAccount({ spawnProcess = spawn, timeoutMs = 25000 } = {}) {
  return new Promise((resolve) => {
    const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
    const executable = process.env.CODEX_BIN || (existsSync(bundled) ? bundled : 'codex');
    const child = spawnProcess(executable, ['app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let done = false,
      buffer = '',
      accountId = 'local';
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      resolve(result);
    };
    const failure = (message) => finish({ provider: 'codex', status: 'error', windows: [], message });
    const timer = setTimeout(
      () => failure('Codex did not answer in time. Showing the last recorded quota when available.'),
      timeoutMs,
    );
    const send = (message) => {
      if (!done) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    child.stdin.on('error', () => failure('Could not connect to the installed Codex app server.'));
    child.on('error', () => failure('Codex CLI was not found. Install Codex or set CODEX_BIN to its executable.'));
    child.on('exit', () => {
      if (!done) failure('The Codex app server exited before reporting limits.');
    });
    child.stderr.resume(); // never expose diagnostic logs or credentials
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data) => {
      buffer += data;
      if (buffer.length > 2 * 1024 * 1024) {
        failure('Codex returned an unexpected response.');
        return;
      }
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.error && [0, 1, 2].includes(m.id)) {
          failure('Codex could not read plan limits. Check your Codex login and try again.');
          return;
        }
        if (m.id === 0) {
          send({ method: 'initialized', params: {} });
          send({ id: 1, method: 'account/read', params: { refreshToken: false } });
        } else if (m.id === 1) {
          const a = m.result?.account;
          if (!a || a.type !== 'chatgpt') {
            finish({
              provider: 'codex',
              status: 'unavailable',
              accountType: a?.type || null,
              windows: [],
              message: a
                ? 'This Codex login uses API billing; ChatGPT plan windows do not apply.'
                : 'Sign in to Codex with ChatGPT to read plan limits.',
            });
            return;
          }
          accountId = createHash('sha256')
            .update(`${a.email || ''}:${a.planType || ''}`)
            .digest('hex')
            .slice(0, 12);
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (m.id === 2) {
          finish(normalizeCodexLimits(m.result || {}, { accountId }));
          return;
        }
      }
    });
    send({
      id: 0,
      method: 'initialize',
      params: { clientInfo: { name: 'overtime', title: 'Overtime', version: VERSION } },
    });
  });
}

let cache = null,
  pending = null,
  attemptedAt = 0;
export async function exactCodexLimits({ force = false } = {}) {
  if (pending) return pending;
  if (cache && Date.now() - attemptedAt < (force ? 15000 : 60000)) return cache;
  attemptedAt = Date.now();
  pending = readCodexAccount()
    .then((result) => (cache = result))
    .finally(() => {
      pending = null;
    });
  return pending;
}
