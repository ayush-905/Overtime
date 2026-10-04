// The Usage page: what's left of each provider's plan and when it resets, where
// it's heading at your pace, the current window as a line, and (for Claude Code)
// the 5-hour windows of the last week with when to start your first. Each
// provider in view gets its own section, with where its figures come from and
// its own Refresh.

import { useState, type ReactNode } from 'react';
import { Info, Moon, RefreshCw, TrendingUp, TriangleAlert } from 'lucide-react';
import { useQuota, useSources } from '@/data/scope';
import { useLimits, refreshCodex, refreshLimits } from '@/data/limits';
import { useLive } from '@/data/live';
import { demo } from '@/data/api';
import { ago, clock, duration, money, weekday, whenText } from '@/lib/format';
import { codexQuota, emptyText, exactNotice, limitInfo, providerName, resetText, windowName, type LimitsInput, type QuotaItem } from '@/lib/limits';
import { claudeWindow, codexChartWindows, codexWindow, dailyShare, isActive, shareText, windowsModel, type ChartResult, type WindowPlan } from '@/lib/usage';
import { Card, CardHead } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { Seg } from '@/components/Seg';
import { Button } from '@/components/Button';
import { Empty, Insight, ProviderMark, Skeleton } from '@/components/Bits';
import { Meter, toneFor } from '@/components/Meter';
import { Calendar } from '@/components/Chart';
import { WindowChart } from '@/components/WindowChart';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { NoPlan } from '@/cards/Band';
import { plansIn } from '@/lib/sources';

const WINDOW_KEY = 'overtime-window-kind';
const CODEX_WINDOW_KEY = 'overtime-codex-window';
const read = (key: string, value: string, fallback: string) => {
  try {
    return localStorage.getItem(key) === value ? value : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const toneText = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };

function OutlookLine({ o }: { o: { level: string; text: string; tip: string } | null }) {
  if (!o) return null;
  const bad = o.level === 'warn' || o.level === 'crit';
  const Icon = bad ? TriangleAlert : o.level === 'quiet' ? Moon : TrendingUp;
  return (
    <p className={cx('flex items-center gap-1.5 text-detail font-semibold', o.level === 'crit' ? 'text-bad' : o.level === 'warn' ? 'text-warn' : o.level === 'quiet' ? 'text-muted' : 'text-ok')} data-tip={o.tip}>
      <Icon size={14} strokeWidth={2} aria-hidden />
      {o.text}
    </p>
  );
}

// ── Claude Code ──────────────────────────────────────────────────────────────

/** Where Claude's figures come from: exact, or the estimate (and why). */
function claudeSource(inp: LimitsInput) {
  const exact = inp.exactOn ? inp.exact : null;
  if (demo) return { text: 'Estimate (demo)', tip: '' };
  if (exact?.status === 'ok') return { text: `Exact${exact.stale ? ', last known' : ''} · ${ago(inp.now - (exact.fetchedAt || inp.now))} ago`, tip: 'The same numbers as /usage in Claude Code, straight from Anthropic. They include claude.ai chats and every device.', live: true };
  const hit = inp.limits?.session?.calibration?.lastHitAt;
  const paused = exact?.status === 'cooling';
  const local = !inp.exactOn;
  return {
    text: `Estimate${paused ? ' · exact paused' : local ? ' · local only' : ''}`,
    tip: `Estimated from Claude Code activity on this Mac${hit ? `, compared with when you last hit the session limit (${whenText(hit)})` : ''}. claude.ai chats and other devices aren't counted.${local ? ' Nothing leaves this machine. For the real numbers, switch on Exact limits from Anthropic in Settings.' : ''}`,
  };
}

function LimitHalf({ kind, inp }: { kind: 'session' | 'weekly'; inp: LimitsInput }) {
  const title = kind === 'session' ? 'Session' : 'Weekly';
  const span = kind === 'session' ? '5-hour window' : '7-day window';
  const info = limitInfo(inp, kind);
  const now = inp.now;
  const head = (resetsAt?: number | null) => (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-title font-semibold">{title}</h3>
        <p className="text-detail text-muted">{span}</p>
      </div>
      {resetsAt ? (
        <p className="flex flex-col items-end text-detail">
          <span className="text-muted">Resets {whenText(resetsAt)}</span>
          {resetsAt > now && <b className="font-semibold tnum">in {duration(resetsAt - now)}</b>}
        </p>
      ) : null}
    </header>
  );
  if (!info) return <Skeleton lines={3} />;
  if ('idle' in info) {
    return (
      <div className="flex flex-col gap-3">
        {head()}
        <p className="text-figure font-bold tracking-[-0.02em] text-ok tnum">
          100%<small className="ml-1.5 text-body font-medium text-muted">left</small>
        </p>
        <Meter left={100} label="Session left" />
        <p className="text-detail text-muted">No window running. The next one starts with your next message.</p>
      </div>
    );
  }
  if ('missing' in info) {
    return (
      <div className="flex flex-col gap-3">
        {head()}
        <Empty>Anthropic didn't send a figure for this limit.</Empty>
      </div>
    );
  }
  if (info.pct == null) {
    return (
      <div className="flex flex-col gap-3">
        {head(info.resetsAt)}
        <p className="text-figure font-bold text-faint tnum">
          —<small className="ml-1.5 text-body font-medium text-muted">no % yet</small>
        </p>
        <Meter left={null} label={`${title} left`} />
        {info.spent != null && <p className="text-detail text-muted">≈ {money(info.spent)} {info.rolling ? 'in the last 7 days' : 'used'}</p>}
        <p className="text-detail text-muted">
          {kind === 'weekly'
            ? `You haven't hit the weekly limit yet, so there's nothing to estimate from.${inp.exactOn || demo ? '' : ' Turn on Exact from Anthropic to see the real %.'}`
            : "You haven't hit a session limit recently, so there's nothing to estimate from."}
        </p>
      </div>
    );
  }
  const used = Math.max(0, Math.min(100, info.pct));
  const left = Math.max(0, 100 - used);
  const o = info.outlook;
  const projected = o ? Math.max(used, Math.min(100, o.projected)) : used;
  const share = kind === 'weekly' && isActive(info) ? dailyShare(info, inp) : null;
  const shareWords = share && isActive(info) ? shareText(share, info) : null;
  return (
    <div className="flex flex-col gap-3">
      {head(info.resetsAt)}
      <p className={cx('text-figure font-bold tracking-[-0.02em] tnum', info.limited ? 'text-bad' : left < 30 ? toneText[toneFor(left)] : '')}>
        {info.limited ? 'Limit reached' : `${left}%`}
        {!info.limited && <small className="ml-1.5 text-body font-medium text-muted">left</small>}
      </p>
      <Meter left={left} projectedLeft={o ? 100 - projected : null} label={`${title} left`} />
      <p className="text-detail text-muted">
        {used}% used{info.spent != null ? ` · ≈ ${money(info.spent)} ${kind === 'session' ? 'this session' : 'this week'}` : ''}
      </p>
      <OutlookLine o={o} />
      {shareWords && (
        <div className="mt-1 flex flex-col gap-1.5 rounded-row bg-sunken px-3 py-2.5" data-tip={shareWords.tip || undefined}>
          <div className="flex items-baseline justify-between gap-2 text-detail">
            <span className="text-muted">Today's share of the week</span>
            <b className="font-semibold tnum">{shareWords.value}</b>
          </div>
          {shareWords.ratio != null && <Meter size="sm" left={Math.max(0, 100 - Math.min(100, shareWords.ratio * 100))} label="Today's share left" />}
          <p className={cx('flex items-center gap-1.5 text-detail', shareWords.over ? 'font-semibold text-bad' : 'text-muted')}>
            {shareWords.over && <TriangleAlert size={13} strokeWidth={2} aria-hidden />}
            {shareWords.line}
          </p>
        </div>
      )}
    </div>
  );
}

function ChartBody({ r }: { r: ChartResult | null }) {
  if (!r) return <Skeleton lines={4} />;
  if ('empty' in r) return <Empty>{r.empty}</Empty>;
  const Icon = r.tip.tone === 'bad' ? TriangleAlert : r.tip.tone === 'quiet' ? Moon : r.tip.tone === 'info' ? Info : TrendingUp;
  return (
    <div className="flex flex-col gap-3">
      <WindowChart c={r.chart} />
      {r.note && <p className="text-detail text-muted">{r.note}</p>}
      <p className={cx('flex items-start gap-2 text-detail', r.tip.tone === 'bad' ? 'text-bad' : 'text-muted')}>
        <Icon size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
        <span>{r.tip.text}</span>
      </p>
    </div>
  );
}

function ChartStats({ r }: { r: ChartResult | null }) {
  if (!r || 'empty' in r) return null;
  const { stats, chart } = r;
  return (
    <dl className="flex gap-5 text-right [&_dd]:text-[1.0625rem]">
      <Stat label="Used" value={stats.used} />
      <Stat label={stats.headLabel} value={<span className={chart.level === 'crit' ? 'text-bad' : chart.level === 'warn' ? 'text-warn' : ''}>{stats.head}</span>} />
      <Stat label="Pace" value={<>{stats.pace}<small className="text-label text-muted">/{stats.perLabel}</small></>} tip="At your recent pace" />
    </dl>
  );
}

function ClaudeWindowCard({ inp }: { inp: LimitsInput }) {
  const [kind, setKind] = useState<'session' | 'weekly'>(() => read(WINDOW_KEY, 'weekly', 'session') as 'session' | 'weekly');
  const r = claudeWindow(inp, kind);
  const note = 'How much of the limit this window has used so far, and where it goes at your recent pace. The shape comes from Claude Code on this Mac; the % is the same as on the limit card.';
  return (
    <Card aria-label="This window">
      <CardHead
        title="This window"
        sub={r && 'sub' in r && r.sub ? r.sub : 'How it filled up'}
        tools={
          <>
            <ChartStats r={r} />
            <span data-tip={note} className="text-muted">
              <Info size={15} strokeWidth={1.8} aria-label="About this chart" />
            </span>
          </>
        }
      />
      <Seg
        size="sm"
        label="Window"
        className="mb-3"
        value={kind}
        onChange={(k) => {
          setKind(k);
          write(WINDOW_KEY, k);
        }}
        options={[
          ['session', 'Session'],
          ['weekly', 'Weekly'],
        ]}
      />
      <ChartBody r={r} />
    </Card>
  );
}

function WindowsCard({ inp }: { inp: LimitsInput }) {
  const insights = useLive((s) => (s.snap?.analytics?.claude?.insights || s.snap?.analytics?.all?.insights) as { windows?: WindowPlan; hours?: { typicalStop?: number | null } } | null | undefined);
  const note = "A window starts with your first message after the last one ended (on a 10-minute mark) and resets 5 hours later. It's rebuilt from Claude Code on this Mac, so claude.ai chats aren't counted. How full each got is its cost against what a full window costs: from the exact % when that's on, otherwise from when you last hit the limit.";
  const head = (
    <CardHead
      title="5-hour windows"
      sub="Last 7 days · how full each got"
      tools={
        <span data-tip={note} className="text-muted">
          <Info size={15} strokeWidth={1.8} aria-label="About this card" />
        </span>
      }
    />
  );
  const p = insights?.windows;
  if (!p) {
    return (
      <Card>
        {head}
        <Skeleton lines={4} />
      </Card>
    );
  }
  if (!p.windows.length) {
    return (
      <Card>
        {head}
        <Empty>No session windows in the last 7 days.</Empty>
      </Card>
    );
  }
  const m = windowsModel(p, insights?.hours, inp);
  const f = m.fullest;
  return (
    <Card className="flex flex-col gap-4" aria-label="5-hour windows">
      {head}
      <div className="grid gap-5 @min-[900px]:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-figure font-bold tracking-[-0.02em] tnum">{p.perDay != null ? p.perDay.toFixed(1).replace(/\.0$/, '') : '—'}</p>
            <p className="text-detail text-muted">
              windows a day on the days you worked{f ? ` · fullest ${f.pct}% on ${weekday(f.start)}` : ''}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 @min-[900px]:grid-cols-1">
            <Stat label="Today" value={<>{p.today} <small className="text-detail font-normal text-muted">{p.today === 1 ? 'window' : 'windows'}</small></>} tip="Windows started since midnight" />
            <Stat label="Fullest" value={f ? `${f.pct}%` : '—'} tip={f ? `${weekday(f.start)} ${clock(f.start)} → ${clock(f.end)}: ≈ ${money(f.cost)}${m.cap ? `, where a full window is about ${money(m.cap)}` : ''}` : 'Turn on Exact from Anthropic, or hit a session limit once, to see how full your windows get.'} />
            <Stat label="Limit hits" value={p.hits} sub={p.hits ? `${duration(p.lockedMs)} out` : undefined} tip="Windows where you hit the session limit, and how long you were locked out until they reset" />
          </dl>
        </div>
        <div className="min-w-0">
          <Calendar columns={m.columns} height={180} now={inp.now} dayHour={0} />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-3 rounded-[2px]" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--claude) 25%, var(--sunken)), var(--claude))' }} />
              Darker is fuller
            </span>
            {m.anyHit && (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-3 rounded-[2px]" style={{ background: 'repeating-linear-gradient(135deg, var(--bad-fill) 0 2px, transparent 2px 4px)' }} />
                Locked out
              </span>
            )}
            {m.anyProjected && (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-3 rounded-[2px] bg-claude opacity-25" />
                If you keep going
              </span>
            )}
          </p>
        </div>
      </div>
      <Insight className={m.plan.strong ? 'text-ink' : ''}>
        <span data-tip={m.plan.tip}>{m.plan.text}</span>
      </Insight>
    </Card>
  );
}

function ClaudeSection() {
  const { input: inp } = useQuota('claude');
  const refreshing = useLimits((s) => s.refreshing);
  const src = claudeSource(inp);
  const notice = exactNotice(inp);
  return (
    <section aria-label="Claude Code" className="flex flex-col gap-[var(--page-gap)]">
      <SectionHead provider="claude" sub="Its windows, forecasts and planning">
        <span data-tip={src.tip || undefined} className={cx('inline-flex items-center gap-1.5 text-detail', src.live ? 'text-ok' : 'text-muted')}>
          {src.live && <i className="size-1.5 rounded-full bg-ok-fill" />}
          {src.text}
          {!src.live && <Info size={13} strokeWidth={1.8} aria-hidden />}
        </span>
        {!demo && (
          <Button size="sm" disabled={refreshing} onClick={() => refreshLimits()} data-tip={inp.exactOn ? 'Get the latest numbers from Anthropic now' : 'Re-read your transcripts now'} icon={<RefreshCw size={13} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} aria-hidden />}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      </SectionHead>
      {notice && <p className={cx('rounded-row px-4 py-2.5 text-detail', notice.level === 'warn' ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted')}>{notice.text}</p>}
      <Card band flush className="grid @min-[760px]:grid-cols-2" aria-label="Claude Code limits" aria-live="polite">
        <div className="border-line px-[var(--card-px)] py-[var(--card-py)] @max-[759px]:border-b @min-[760px]:border-r">
          <LimitHalf kind="session" inp={inp} />
        </div>
        <div className="px-[var(--card-px)] py-[var(--card-py)]">
          <LimitHalf kind="weekly" inp={inp} />
        </div>
      </Card>
      <ClaudeWindowCard inp={inp} />
      <WindowsCard inp={inp} />
    </section>
  );
}

// ── Codex ────────────────────────────────────────────────────────────────────

function CodexRow({ w, now }: { w: QuotaItem; now: number }) {
  if (w.usedPercent == null) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-detail">
          <span className="font-semibold">{w.label}</span>
          <span className="text-right text-balance text-muted">{emptyText(w)}</span>
        </div>
        <Meter left={null} size="sm" label={`${w.label} left`} />
      </div>
    );
  }
  const used = Math.max(0, Math.min(100, w.usedPercent));
  const left = Math.round(100 - used);
  const o = w.outlook;
  const projected = o ? Math.max(used, Math.min(100, o.projected)) : used;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-detail font-semibold">{w.label}</span>
        <b className={cx('text-stat font-bold tnum', w.limited ? 'text-bad' : left < 30 ? toneText[toneFor(left)] : '')}>
          {w.limited ? 'Limit reached' : `${left}%`}
          {!w.limited && <small className="ml-1 text-detail font-medium text-muted">left</small>}
        </b>
      </div>
      <Meter left={w.limited ? 0 : left} projectedLeft={o ? 100 - projected : null} label={`${w.label} left`} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-detail text-muted">{resetText(w, now)}</span>
        <OutlookLine o={o} />
      </div>
    </div>
  );
}

function CodexSection() {
  const { items, input: inp } = useQuota('codex');
  const refreshing = useLimits((s) => s.codexRefreshing);
  const exactOn = useLimits((s) => s.codexExactOn);
  const [kind, setKind] = useState(() => read(CODEX_WINDOW_KEY, 'secondary', 'primary'));
  const first = items[0];
  const now = inp.now;
  const SOURCE: Record<string, string> = { exact: 'Live check', estimate: 'Estimate', recorded: 'As Codex last recorded it' };
  const sub = first ? `${SOURCE[first.source || ''] || ''}${first.observedAt ? ` · ${ago(Math.max(0, now - first.observedAt))} ago` : ''}${first.stale ? ' · old reading' : ''}` : 'Unavailable';
  const windows = codexChartWindows(inp);
  const w = windows.find((x) => x.kind === kind) || windows[0];
  const r = codexWindow(inp, w);
  const q = codexQuota(inp);
  return (
    <section aria-label="Codex" className="flex flex-col gap-[var(--page-gap)]">
      <SectionHead provider="codex" sub="Its windows, as Codex reports them">
        <span className={cx('text-detail', first?.stale ? 'text-warn' : 'text-muted')}>{sub}</span>
        {!demo && (
          <Button size="sm" disabled={refreshing} onClick={() => refreshCodex()} data-tip={exactOn ? 'Ask Codex for the latest numbers now' : 'Re-read Codex’s transcripts now. Turn on the live check in Settings to ask Codex itself.'} icon={<RefreshCw size={13} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} aria-hidden />}>
            {refreshing ? 'Checking…' : 'Refresh'}
          </Button>
        )}
      </SectionHead>
      <Card band aria-label="Codex limits" className="flex flex-col gap-4">
        {!items.length ? (
          <Empty>{q?.message || 'Codex records its plan windows each time you use it; none yet on this Mac.'}</Empty>
        ) : (
          <div className="grid gap-x-8 gap-y-5 @min-[760px]:grid-cols-2">
            {items.map((x) => (
              <CodexRow key={x.id} w={x} now={now} />
            ))}
          </div>
        )}
        {first?.stale && <p className="text-detail text-warn">Pace forecasts are paused until a newer reading is available.</p>}
        {exactOn && inp.codexExact?.status === 'error' && <p className="text-detail text-warn">{inp.codexExact.message}</p>}
        <p className="text-detail text-muted">
          These cover all your Codex use, on this Mac and anywhere else. {first?.source === 'recorded' ? 'Codex writes them into its transcripts each time you use it; turn on the live check in Settings to update them when you haven’t. ' : ''}Forecasts come from how fast they filled while you used Codex here.
        </p>
      </Card>
      <Card aria-label="This Codex window">
        <CardHead
          title="This window"
          sub={'sub' in r && r.sub ? r.sub : 'How it filled up'}
          tools={
            <>
              <ChartStats r={r} />
              <span data-tip="How full this Codex window got, from the readings Codex writes into its transcripts each time you use it on this Mac, and where it goes at your recent pace. Use elsewhere shows up the next time you use Codex here." className="text-muted">
                <Info size={15} strokeWidth={1.8} aria-label="About this chart" />
              </span>
            </>
          }
        />
        {w && windows.length > 1 && (
          <Seg
            size="sm"
            label="Window"
            className="mb-3"
            value={w.kind}
            onChange={(k) => {
              setKind(k);
              write(CODEX_WINDOW_KEY, k);
            }}
            options={windows.map((x) => [x.kind, windowName(x.durationMs, x.kind)] as [string, string])}
          />
        )}
        <ChartBody r={r} />
      </Card>
    </section>
  );
}

function SectionHead({ provider, sub, children }: { provider: 'claude' | 'codex'; sub: string; children?: ReactNode }) {
  return (
    <header className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 first:mt-0">
      <div className="flex items-center gap-2.5">
        <ProviderMark source={provider} size={22} />
        <div>
          <h2 className="text-[1.125rem] font-bold tracking-[-0.01em]">{providerName(provider)}</h2>
          <p className="text-detail text-muted">{sub}</p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>
    </header>
  );
}

export function Usage() {
  const provider = useLive((s) => s.provider);
  const plans = plansIn(provider, useSources());
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader title="Usage" id="h-usage" sub="How much of each plan is left, and when it resets" />
      {plans.includes('claude') && <ClaudeSection />}
      {plans.includes('codex') && <CodexSection />}
      {provider !== 'all' && !plans.length && <Card><NoPlan source={provider} /></Card>}
    </div>
  );
}

