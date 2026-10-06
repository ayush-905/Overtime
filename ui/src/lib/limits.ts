// Plan windows, with what they read passed in rather than taken from a global:
// what's left of each provider's windows, where each is heading at your recent
// pace, how fresh the reading is, and whether an agent looks stuck. Golden tests
// (limits.test.ts) hold every figure and sentence.

import { ago, duration, HOUR, MINUTE, DAY, whenText } from './format';
import { SOURCE, isSource } from './sources';
import type {
  CodexWindow as ApiCodexWindow,
  EstimateSession,
  EstimateWeekly,
  ExactWindowSpend,
  LimitsEstimate,
} from '@/data/types';

// ── What the server and the checks send, as this reads it ───────────────────
// Each is the server's type (data/types.ts), or a view of it that tests can
// build in part; the server's always fits, without a cast.

export type { SpendSeries } from '@/data/types';
/** The session or weekly window of the estimate: the two read alike. */
type EstimateWindow = Omit<EstimateSession, 'active' | 'start'> &
  Partial<Pick<EstimateSession, 'active' | 'start'>> &
  Partial<Pick<EstimateWeekly, 'rolling'>>;
/** Claude Code's plan limits estimated on this Mac (the snapshot's `limits`). */
export type Estimate = Omit<LimitsEstimate, 'session' | 'weekly'> & { session: EstimateWindow; weekly: EstimateWindow };
type ExactWindow = Pick<ExactWindowSpend, 'pct' | 'resetsAt'> & { spend?: { cost: number } | null };
/** Anthropic's numbers (/api/limits/exact), or why there are none. */
export type Exact = {
  status: string;
  message?: string;
  fetchedAt?: number;
  stale?: boolean;
  retryAt?: number;
  session?: ExactWindow | null;
  weekly?: ExactWindow | null;
};
/** One of Codex's plan windows. */
export type CodexWindow = Pick<ApiCodexWindow, 'bucketId' | 'kind' | 'usedPercent' | 'resetsAt'> &
  Partial<Pick<ApiCodexWindow, 'bucketName' | 'durationMs' | 'pace'>>;
/** Codex's windows: what it recorded here (the snapshot's `codexLimits`), or its live check (/api/limits/codex). */
export type CodexQuota = {
  status?: string;
  source?: string;
  message?: string | null;
  observedAt?: number;
  stale?: boolean;
  windows?: CodexWindow[];
};

/** Everything the plan windows are worked out from. */
export type LimitsInput = {
  now: number;
  limits: Estimate | null;
  exactOn: boolean;
  exact: Exact | null;
  codexRecorded: CodexQuota | null;
  codexExactOn: boolean;
  codexExact: CodexQuota | null;
};

export type Outlook = {
  level: 'quiet' | 'ok' | 'warn' | 'crit';
  text: string;
  tip: string;
  projected: number;
  runOutAt?: number;
};

// ── How fresh a reading is ───────────────────────────────────────────────────

/** Old quota readings must not drive a new run-out warning. */
export function quotaFreshness(window: { source?: string; observedAt?: number; stale?: boolean }, now: number) {
  const age = Number.isFinite(window.observedAt) ? Math.max(0, now - (window.observedAt as number)) : null;
  const maxAge = window.source === 'recorded' ? 60 * MINUTE : window.source === 'exact' ? 20 * MINUTE : null;
  return { age, stale: !!window.stale || (maxAge != null && (age == null || age >= maxAge)) };
}

// ── Where a window is heading ────────────────────────────────────────────────

const quietOutlook = (used: number, basis: string): Outlook => ({
  level: 'quiet',
  text: 'Quiet lately, no risk right now',
  tip: `Little usage ${basis}.`,
  projected: used,
});

/** Where a window at `used`% is heading at `rate` (% of the limit per ms): when it runs out, or where it ends up. */
function forecast(used: number, rate: number, resetsAt: number, basis: string, now: number): Outlook {
  const runOut = now + (100 - used) / rate;
  if (runOut < resetsAt) {
    return {
      level: runOut - now < 60 * MINUTE ? 'crit' : 'warn',
      runOutAt: runOut,
      text: `Runs out around ${whenText(runOut)}`,
      tip: `At your pace ${basis}, this runs out ${ago(resetsAt - runOut)} before it resets.`,
      projected: 100,
    };
  }
  const projected = used + rate * (resetsAt - now);
  // What you'll have used of it, the same words on the Overview (Band.tsx) and the Usage page.
  return {
    level: 'ok',
    text: `On pace to use ~${Math.round(projected)}% by the reset`,
    tip: `Based on your pace ${basis}.`,
    projected,
  };
}

/**
 * A limit's size in dollars: from the exact % used and what the window has cost,
 * when there's enough of both to go on, else (and for the estimate) from how much
 * you had used when you last hit it.
 */
const limitSize = (exactPct: number | null, spent: number | null, capacity?: number | null) =>
  exactPct != null && spent != null && exactPct >= 3 && spent > 0.5 ? spent / (exactPct / 100) : capacity || null;

/** Where a limit at `pct`% (what the card shows), `size` dollars in all, is heading at the recent pace. */
function outlook(
  {
    pct,
    spent,
    size,
    resetsAt,
    limited,
  }: { pct: number | null; spent: number | null; size: number | null; resetsAt: number | null; limited: boolean },
  rate: number,
  basis: string,
  now: number,
) {
  if (limited || !resetsAt || resetsAt <= now || spent == null) return null;
  const cap = size;
  if (!cap || cap <= spent) return null;
  const used = pct ?? (spent / cap) * 100;
  if (!(rate > 0) || rate * 60 * MINUTE < 0.25) return quietOutlook(used, basis);
  return forecast(used, (rate / cap) * 100, resetsAt, basis, now);
}

export type LimitInfo =
  | { missing: true }
  | { idle: true }
  | {
      pct: number | null;
      resetsAt: number | null;
      limited: boolean;
      spent: number | null;
      /** The limit's size in dollars, which its forecast and the window's chart both go by. */
      size: number | null;
      active: true;
      stale?: boolean;
      rolling?: boolean;
      outlook: Outlook | null;
    };

/** Claude Code's session or weekly limit: the exact one when it's on and came back, else the estimate. */
export function limitInfo(inp: LimitsInput, kind: 'session' | 'weekly'): LimitInfo | null {
  const est = inp.limits;
  const exact = inp.exactOn && inp.exact?.status === 'ok' ? inp.exact : null;
  const rates: Partial<Estimate['rates']> = est?.rates || {};
  const session = kind === 'session';
  const rate = session ? (rates.cost30m || 0) / (30 * MINUTE) : (rates.cost7d || 0) / (7 * DAY);
  const basis = session ? 'over the last 30 minutes' : 'over the last 7 days';
  if (exact) {
    const w = exact[kind];
    if (!w) return { missing: true };
    const spent = w.spend?.cost ?? null;
    const limited = w.pct >= 100;
    const stale = quotaFreshness({ source: 'exact', observedAt: exact.fetchedAt, stale: exact.stale }, inp.now).stale;
    const size = limitSize(w.pct, spent, est?.[kind]?.capacity);
    return {
      pct: w.pct,
      resetsAt: w.resetsAt,
      limited,
      spent,
      size,
      active: true,
      stale,
      outlook: stale ? null : outlook({ pct: w.pct, spent, size, resetsAt: w.resetsAt, limited }, rate, basis, inp.now),
    };
  }
  if (!est) return null;
  const w = est[kind];
  if (session && !w.active) return { idle: true };
  const size = limitSize(null, w.used, w.capacity);
  return {
    pct: w.pct,
    resetsAt: w.resetsAt,
    limited: w.limited,
    spent: w.used,
    size,
    active: true,
    rolling: w.rolling,
    outlook: outlook(
      { pct: w.pct, spent: w.used, size, resetsAt: w.resetsAt, limited: w.limited },
      rate,
      basis,
      inp.now,
    ),
  };
}

export const providerName = (source: string) => (isSource(source) ? SOURCE[source].name : 'All providers');

/** Codex's plan windows: the live check when it's on and newer, else what Codex last recorded here. */
export function codexQuota(inp: LimitsInput): CodexQuota | null {
  const live = inp.codexExactOn ? inp.codexExact : null;
  if (live?.status === 'unavailable') return live; // signed out, or API billing: old windows don't apply
  const recorded = inp.codexRecorded;
  if (live?.status === 'ok' && (!recorded?.observedAt || (live.observedAt ?? 0) >= recorded.observedAt)) return live;
  return recorded || live;
}

/** A Codex window's pace from its readings on this Mac; a live check's window borrows the recorded one's. */
export function codexPace(inp: LimitsInput, w: CodexWindow) {
  if (w.pace) return w.pace;
  return (
    inp.codexRecorded?.windows?.find(
      (r) =>
        r.bucketId === w.bucketId && r.kind === w.kind && Math.abs((r.resetsAt || 0) - (w.resetsAt || 0)) < 5 * MINUTE,
    )?.pace || null
  );
}

function codexOutlook(inp: LimitsInput, w: CodexWindow) {
  const pace = codexPace(inp, w);
  const used = w.usedPercent;
  if (!pace || used == null || used >= 100 || !w.resetsAt || w.resetsAt <= inp.now) return null;
  if (!(pace.rate > 0) || pace.rate * HOUR < 0.5) return quietOutlook(used, pace.basis);
  return forecast(used, pace.rate, w.resetsAt, pace.basis, inp.now);
}

export function windowName(ms: number | null | undefined, kind: string) {
  if (ms === 7 * DAY) return 'Weekly';
  if (ms) return ms >= HOUR ? `${Math.round((ms / HOUR) * 10) / 10}-hour` : `${Math.round(ms / MINUTE)}-minute`;
  return kind === 'primary' ? 'Primary' : 'Secondary';
}

export type QuotaItem = {
  provider: 'claude' | 'codex';
  id: string;
  label: string;
  usedPercent: number | null;
  resetsAt: number | null;
  idle?: boolean;
  expired?: boolean;
  limited: boolean;
  outlook: Outlook | null;
  spent?: number | null;
  source: string | undefined;
  observedAt: number | undefined;
  stale: boolean;
};

/**
 * Every plan window in a provider view, in one shape: a label, the % used (null
 * when unknown), when it resets, and where the numbers came from. Claude's come
 * from limitInfo, so they always match its limit cards.
 */
export function quotaItems(inp: LimitsInput, provider = 'all'): QuotaItem[] {
  const items: QuotaItem[] = [];
  // Pi has no plan of its own, so its view has no windows.
  if (provider === 'all' || provider === 'claude') {
    const exact = inp.exactOn && inp.exact?.status === 'ok';
    const stale =
      exact &&
      quotaFreshness({ source: 'exact', observedAt: inp.exact!.fetchedAt, stale: inp.exact!.stale }, inp.now).stale;
    for (const kind of ['session', 'weekly'] as const) {
      const info = limitInfo(inp, kind);
      if (!info || 'missing' in info) continue;
      const idle = 'idle' in info;
      const i = idle ? null : info;
      items.push({
        provider: 'claude',
        id: `claude:${kind}`,
        label: kind === 'session' ? '5-hour' : 'Weekly',
        usedPercent: idle ? 0 : i!.limited ? 100 : (i!.pct ?? null),
        resetsAt: i?.resetsAt || null,
        idle,
        limited: !!i?.limited,
        outlook: stale ? null : i?.outlook || null,
        spent: i?.spent,
        source: exact ? 'exact' : 'estimate',
        observedAt: exact ? inp.exact!.fetchedAt : inp.limits?.computedAt,
        stale: !!stale,
      });
    }
  }
  if (provider === 'all' || provider === 'codex') {
    const q = codexQuota(inp);
    const stale = quotaFreshness({ source: q?.source, observedAt: q?.observedAt, stale: q?.stale }, inp.now).stale;
    for (const w of q?.windows || []) {
      const expired = w.resetsAt != null && w.resetsAt <= inp.now;
      items.push({
        provider: 'codex',
        id: `codex:${w.bucketId}:${w.kind}`,
        label: `${w.bucketName && w.bucketName !== 'codex' ? `${w.bucketName} · ` : ''}${windowName(w.durationMs, w.kind)}`,
        usedPercent: expired ? null : w.usedPercent,
        resetsAt: w.resetsAt,
        expired,
        limited: !expired && (w.usedPercent ?? 0) >= 100,
        outlook: expired || stale ? null : codexOutlook(inp, w),
        source: q!.source,
        observedAt: q!.observedAt,
        stale,
      });
    }
  }
  return items;
}

// ── Saying where the numbers came from ────────────────────────────────────────

const SOURCE_TEXT: Record<string, string> = {
  exact: 'Exact',
  estimate: 'Estimate',
  recorded: 'As Codex last recorded it',
};

/** A provider's windows' line under its name: "Exact · 2m ago", "As Codex last recorded it · 22h ago · old reading". */
export function sourceLine(items: QuotaItem[], now: number) {
  const first = items[0];
  if (!first) return 'Unavailable';
  return `${SOURCE_TEXT[first.source || ''] || ''}${first.observedAt ? ` · ${ago(Math.max(0, now - first.observedAt))} ago` : ''}${first.stale ? ' · old reading' : ''}`;
}

/** What a window with no figure says instead, as its row does. */
export function emptyText(w: QuotaItem) {
  if (w.idle) return 'No window running. It starts with your next message.';
  if (w.expired) return `Reset ${whenText(w.resetsAt!)}; Codex hasn't reported since`;
  if (w.provider === 'claude') return 'Not enough use yet to estimate';
  return 'No figure reported';
}

/** When a window resets, as its row says it: "Resets 03:00 · in 4h 47m". */
export const resetText = (w: QuotaItem, now: number) =>
  w.resetsAt && w.resetsAt > now ? `Resets ${whenText(w.resetsAt)} · in ${duration(w.resetsAt - now)}` : '';

/** A notice about the exact check, when it's paused or failed. */
export function exactNotice(inp: LimitsInput) {
  if (inp.exactOn && inp.exact?.status === 'cooling')
    return {
      level: 'info' as const,
      text: `Anthropic asked Overtime to check less often. Showing the estimate until ${whenText(inp.exact.retryAt!)}, then exact numbers come back on their own.`,
    };
  if (inp.exactOn && inp.exact && inp.exact.status !== 'ok')
    return { level: 'warn' as const, text: inp.exact.message || "Couldn't get exact numbers." };
  return null;
}

// ── An agent that looks stuck ─────────────────────────────────────────────────

const WORKING = new Set(['thinking', 'working', 'replying']);
const FAIL_RUN = 4; // this many failed tool calls in a row looks like going round in circles
const FAIL_MANY = 6; // or this many failures in the time you set, most of the calls in it

type StuckAgent = {
  needsYou?: string | null;
  status: string;
  results?: [number, number, string][];
  tool?: { name?: string; startedAt?: number } | null;
  lastActivity?: number;
};
export type Stuck =
  | { kind: 'failing'; since: number; count: number; calls: number; inRow: boolean; name: string | null }
  | { kind: 'tool'; since: number; name?: string }
  | { kind: 'silent'; since: number };

/**
 * Whether a working agent looks stuck, given the minutes you set: its tool calls
 * failing over and over, one tool call running that long, or no sign of life
 * that long. Null when it looks fine, or isn't working. `results` are its last
 * tool calls as the server sends them: [t, ok (1 or 0), tool name].
 */
export function stuckState(a: StuckAgent | null | undefined, now: number, minutes = 10): Stuck | null {
  if (!a || a.needsYou || !WORKING.has(a.status)) return null;
  const limit = minutes * MINUTE;
  const results = a.results || [];
  const last = results[results.length - 1];
  let run = 0;
  for (let i = results.length - 1; i >= 0 && !results[i][1]; i--) run++;
  const recent = results.filter(([t]) => now - t <= limit);
  const fails = recent.filter(([, ok]) => !ok);
  if (
    last &&
    now - last[0] <= limit &&
    (run >= FAIL_RUN || (fails.length >= FAIL_MANY && fails.length / recent.length >= 0.6))
  ) {
    const inRun = run >= FAIL_RUN;
    const failed = inRun ? results.slice(-run) : fails;
    const names = new Set(failed.map((r) => r[2]));
    return {
      kind: 'failing',
      since: failed[0][0],
      count: failed.length,
      calls: inRun ? run : recent.length,
      inRow: inRun,
      name: names.size === 1 ? [...names][0] : null,
    };
  }
  if (a.status === 'working' && a.tool?.startedAt && now - a.tool.startedAt >= limit)
    return { kind: 'tool', since: a.tool.startedAt, name: a.tool.name };
  if (a.lastActivity && now - a.lastActivity >= limit) return { kind: 'silent', since: a.lastActivity };
  return null;
}

/** Why an agent looks stuck, in a few words: "5 Bash calls failed in a row". */
export function stuckText(s: Stuck | null, now: number) {
  if (!s) return '';
  if (s.kind === 'failing')
    return s.inRow
      ? `${s.count} ${s.name ? `${s.name} calls` : 'tool calls'} failed in a row`
      : `${s.count} of its last ${s.calls} tool calls failed`;
  if (s.kind === 'tool') return `One ${s.name || 'tool'} call running for ${duration(now - s.since)}`;
  return `No progress for ${duration(now - s.since)}`;
}
