// Independent plan widgets beside today's summary, followed by an attention
// inbox. Approval, question and plan waits lead; suspected failures and finished
// turns follow. Actions use available app links; titles open the session panel.
// Under them, the sessions working now: a row each with what it's doing (one
// summary line in the compact layout).

import { ChevronRight, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAgents, useAlertPrefs, useQuota, useSources } from '@/data/scope';
import { useNow } from '@/data/hooks';
import { refreshCodex, refreshLimits, useLimits } from '@/data/limits';
import { useLive } from '@/data/live';
import { useSessionTarget } from '@/data/queries';
import { demo } from '@/data/api';
import { ago, plural } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { attentionItems, workingItems, type AttentionItem, type WorkingItem } from '@/lib/attention';
import { emptyText, exactNotice, providerName, resetText, sourceLine, type QuotaItem } from '@/lib/limits';
import { pageLink } from '@/lib/route';
import { Card } from '@/components/Card';
import { Figure } from '@/components/Stat';
import { Meter, toneFor } from '@/components/Meter';
import { Avatar, Empty, ProviderMark, Skeleton } from '@/components/Bits';
import { Button, TextLink } from '@/components/Button';
import { cx } from '@/components/cx';
import { useUi } from '@/app/ui';
import { titleFor } from '@/lib/labels';
import { SOURCE, plansIn, type PlanSource, type Source } from '@/lib/sources';

// ── The attention inbox ──────────────────────────────────────────────────────

function AttentionLine({ item, now, compact = false }: { item: AttentionItem; now: number; compact?: boolean }) {
  const openSession = useUi((s) => s.openSession);
  const { agent, tone } = item;
  const { data: target } = useSessionTarget(agent.id);
  const app = target?.app;
  if (compact) {
    const body = <>
      <Avatar source={agent.source} status={agent.needsYou ? 'needs' : 'working'} size={20} />
      <span className="min-w-0 grow">
        <span className="mb-1 flex items-center justify-between gap-2 text-label"><span className={tone === 'bad' ? 'text-bad' : 'text-warn'}>{item.label}</span><span className="tnum text-muted">{ago(Math.max(0, now - item.since))}</span></span>
        <span className="block truncate font-semibold">{titleFor(agent.id, agent.title)}</span>
        <span className="block truncate text-label text-muted">{agent.project ? `${agent.project} · ` : ''}{item.detail}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
    </>;
    const props = { 'data-row': '', 'data-session': agent.id, 'aria-label': `${app ? `Open in ${app.name}` : item.action}: ${titleFor(agent.id, agent.title)}`, className: 'attention-row attention-row-compact w-full text-left text-ink no-underline' };
    return app
      ? <a {...props} href={app.url} data-tip={`${item.label} · Opens this session in ${app.name}`}>{body}</a>
      : <button {...props} type="button" onClick={() => openSession(agent.id)}>{body}</button>;
  }
  return (
    <div className="attention-row">
      <Avatar source={agent.source} status={agent.needsYou ? 'needs' : 'working'} size={22} />
      <div className="min-w-0 grow">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cx('attention-badge', tone === 'bad' ? 'text-bad bg-bad-soft' : 'text-warn bg-warn-soft')}>{item.label}</span>
          <span className="text-label text-muted tnum">{ago(Math.max(0, now - item.since))}</span>
        </div>
        <button type="button" data-row="" data-session={agent.id} onClick={() => openSession(agent.id)} className="block max-w-full truncate text-left font-semibold hover:underline" data-tip={titleFor(agent.id, agent.title)}>{titleFor(agent.id, agent.title)}</button>
        <p className="truncate text-detail text-muted" data-tip={item.detail}>{agent.project ? `${agent.project} · ` : ''}{item.detail}</p>
      </div>
      {app ? <a href={app.url} data-tip={`${item.label} · Opens this session in ${app.name}`} className="attention-action inline-flex h-7 shrink-0 items-center justify-center rounded-control border border-line bg-card px-2.5 text-detail font-medium whitespace-nowrap text-ink no-underline hover:bg-sunken">Open in {app.name}</a>
        : <Button size="sm" onClick={() => openSession(agent.id)} className="attention-action">{item.action}</Button>}
    </div>
  );
}

/** A session that's working: lighter than a row that needs you, and it opens the session's panel. */
function WorkingLine({ item, now }: { item: WorkingItem; now: number }) {
  const openSession = useUi((s) => s.openSession);
  const { agent } = item;
  const title = titleFor(agent.id, agent.title);
  const detail = [item.doing, item.subagents ? plural(item.subagents, 'subagent') : '', agent.project].filter(Boolean).join(' · ');
  const elapsed = ago(Math.max(0, now - item.since));
  return (
    <button type="button" data-row="" data-session={agent.id} onClick={() => openSession(agent.id)} className="working-row w-full text-left text-ink" data-tip={`${title}\n${detail} · for ${elapsed}`}>
      <Avatar source={agent.source} status="working" size={18} />
      <span className="working-text">
        <span className="working-title">{title}</span>
        <span className="working-detail">{detail}</span>
      </span>
      <span className="shrink-0 text-label text-muted tnum">{elapsed}</span>
    </button>
  );
}

const WORKING_ROWS = 3;

function WorkingGroup({ items, now }: { items: WorkingItem[]; now: number }) {
  const more = items.length - WORKING_ROWS;
  return (
    <section className="working-group" aria-label="Working sessions">
      <h3 className="text-label font-semibold text-muted">Working · {items.length}</h3>
      <div className="mt-1 flex flex-col">{items.slice(0, WORKING_ROWS).map((item) => <WorkingLine key={item.agent.id} item={item} now={now} />)}</div>
      {more > 0 && <TextLink href={pageLink('agents')} className="mt-2 block">{more} more working →</TextLink>}
    </section>
  );
}

/** The compact layout's one line for them: how many, and which. */
function WorkingSummary({ items }: { items: WorkingItem[] }) {
  const titles = items.map((item) => titleFor(item.agent.id, item.agent.title)).join(', ');
  return (
    <a href={pageLink('agents')} className="working-summary text-ink no-underline" aria-label={`${plural(items.length, 'session')} working: ${titles}`} data-tip={titles}>
      <span className="size-2 shrink-0 rounded-full bg-ok-fill" aria-hidden />
      <b className="shrink-0 font-semibold">{items.length} working</b>
      <span className="min-w-0 grow truncate text-muted">{titles}</span>
      <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
    </a>
  );
}

export function AttentionInbox({ compact = false }: { compact?: boolean }) {
  useNow();
  const snap = useLive((s) => s.snap);
  const { agents } = useAgents();
  const prefs = useAlertPrefs();
  const now = serverNow();
  if (!snap) return <Skeleton lines={3} />;
  const mains = agents.filter((a) => a.kind === 'main');
  const items = attentionItems(agents, now, prefs.stuckMinutes);
  const working = workingItems(agents, items);
  const limit = compact ? 2 : 3;
  const shown = items.slice(0, limit);
  return (
    <div className="attention-inbox">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <Inbox size={17} className="text-muted" aria-hidden />
          <h2 className="text-title font-semibold">{items.length ? 'Needs attention' : 'All clear'}</h2>
          {items.length > 0 && <span className="attention-badge bg-warn-soft text-warn">{plural(items.length, 'session')}</span>}
        </div>
        <TextLink href={pageLink('agents')}>All agents →</TextLink>
      </header>
      {shown.length ? <div className="attention-list">{shown.map((item) => <AttentionLine key={item.agent.id} item={item} now={now} compact={compact} />)}</div> : <p className="mt-2 text-detail text-muted">{working.length ? 'Nothing needs your attention.' : mains.length ? 'No session needs your attention right now.' : 'Start a Claude Code, Codex or Pi session to see it here.'}</p>}
      {items.length > limit && <TextLink href={pageLink('agents')} className="mt-3 block">{items.length - limit === 1 ? '1 more session needs' : `${items.length - limit} more sessions need`} attention →</TextLink>}
      {working.length > 0 && (compact ? <WorkingSummary items={working} /> : <WorkingGroup items={working} now={now} />)}
    </div>
  );
}

// ── A provider's plan ────────────────────────────────────────────────────────

/** The window that tells the story: the one with least left, of those with a figure. */
function primaryOf(items: QuotaItem[]) {
  const withFigure = items.filter((w) => w.usedPercent != null && !w.idle);
  if (!withFigure.length) return items.find((w) => w.idle) || null;
  return withFigure.reduce((best, w) => (w.usedPercent! > best.usedPercent! ? w : best), withFigure[0]);
}

/** Where the figures came from, briefly: "Exact · 2m ago", "Old reading · 24h ago". */
function shortSource(items: QuotaItem[], now: number) {
  const first = items[0];
  if (!first) return '';
  const age = first.observedAt ? `${ago(Math.max(0, now - first.observedAt))} ago` : '';
  if (first.stale) return ['Old reading', age].filter(Boolean).join(' · ');
  return sourceLine(items, now).replace('As Codex last recorded it', 'Recorded');
}

const leftOf = (w: QuotaItem) => (w.limited ? 0 : Math.max(0, Math.round(100 - (w.usedPercent ?? 0))));
const unitFor = (w: QuotaItem) => (w.label === '5-hour' ? 'left in this 5-hour window' : w.label === 'Weekly' ? 'left this week' : `left · ${w.label}`);

/** Where it's heading, in "left" terms: "On pace to keep ~87%", "Runs out around 16:40". */
export function outlookWords(w: QuotaItem) {
  const o = w.outlook;
  if (!o) return null;
  if (o.level === 'warn' || o.level === 'crit') return { text: o.text, tone: o.level === 'crit' ? 'text-bad' : 'text-warn', tip: o.tip };
  if (o.level === 'quiet') return { text: 'Quiet lately', tone: 'text-muted', tip: o.tip };
  return { text: `On pace to keep ~${Math.max(0, Math.round(100 - o.projected))}%`, tone: 'text-ok', tip: o.tip };
}

function OtherWindow({ w, now }: { w: QuotaItem; now: number }) {
  const figure = w.usedPercent != null && !w.idle;
  return (
    <div className="flex flex-col gap-1.5" data-tip={figure ? resetText(w, now) || undefined : undefined}>
      <div className="flex items-baseline justify-between gap-3 text-detail">
        <span className="shrink-0 whitespace-nowrap font-semibold">{w.label}</span>
        {figure ? <span className="font-semibold tnum">{w.limited ? 'Limit reached' : `${leftOf(w)}% left`}</span> : <span className="text-right text-balance text-muted">{emptyText(w)}</span>}
      </div>
      {figure && <Meter left={leftOf(w)} size="sm" label={`${w.label} left`} />}
    </div>
  );
}

/** A provider in view with no plan of its own, in place of its limits. */
export function NoPlan({ source, compact = false }: { source: Source; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ProviderMark source={source} size={compact ? 16 : 18} />
        <h2 className={cx('shrink-0 whitespace-nowrap', compact ? 'text-detail font-semibold' : 'text-[15px] font-semibold')}>{SOURCE[source].name}</h2>
      </div>
      <Empty>{SOURCE[source].name} has no plan limits of its own. It uses the provider you sign it in to, with that account's limits.</Empty>
    </div>
  );
}

export function ProviderLimits({ provider, compact = false }: { provider: PlanSource; compact?: boolean }) {
  const { items, input } = useQuota(provider);
  const codexRefreshing = useLimits((s) => s.codexRefreshing);
  const refreshing = useLimits((s) => s.refreshing);
  const now = input.now;
  const notice = provider === 'claude' ? exactNotice(input) : null;
  const primary = primaryOf(items);
  const others = items.filter((w) => w !== primary);
  const stale = items[0]?.stale;
  const refreshButton = !demo && stale && (
    <Button size="sm" className="self-start" disabled={provider === 'codex' ? codexRefreshing : refreshing} onClick={() => (provider === 'codex' ? refreshCodex() : refreshLimits())} icon={<RefreshCw size={13} strokeWidth={2} className={(provider === 'codex' ? codexRefreshing : refreshing) ? 'animate-spin' : ''} aria-hidden />}>
      Get a fresh reading
    </Button>
  );
  const head = (
    <div className="flex items-center gap-2">
      <ProviderMark source={provider} size={compact ? 16 : 18} />
      <h2 className={cx('shrink-0 whitespace-nowrap', compact ? 'text-detail font-semibold' : 'text-[15px] font-semibold')}>{providerName(provider)}</h2>
      <span className="ml-auto truncate text-label text-muted" data-tip={stale ? 'Pace forecasts are paused until a newer reading is available.' : undefined}>
        {shortSource(items, now)}
      </span>
    </div>
  );
  if (!items.length) {
    const q = provider === 'codex' ? input.codexExact?.message || input.codexRecorded?.message : null;
    return (
      <div className="flex flex-col gap-3">
        {head}
        <Empty>{q || (provider === 'codex' ? 'Codex records its plan windows each time you use it; none yet on this Mac.' : 'Waiting for usage data…')}</Empty>
      </div>
    );
  }
  const words = primary ? outlookWords(primary) : null;
  const hasFigure = primary && (primary.usedPercent != null || primary.idle);
  return (
    <div className={cx('flex flex-col', compact ? 'gap-2.5' : 'gap-3')}>
      {head}
      {primary && hasFigure ? (
        <>
          {compact ? (
            <div className="flex items-baseline justify-between text-detail">
              <span>{primary.label}</span>
              <span className="font-bold tnum">{primary.limited ? 'Limit reached' : `${leftOf(primary)}% left`}</span>
            </div>
          ) : (
            <Figure size="hero" className="mt-1.5" value={primary.limited ? 'Limit reached' : `${leftOf(primary)}%`} unit={primary.limited ? undefined : unitFor(primary)} tone={primary.limited ? 'bad' : toneFor(leftOf(primary)) === 'ok' ? undefined : toneFor(leftOf(primary)) === 'bad' ? 'bad' : 'warn'} />
          )}
          <Meter left={leftOf(primary)} size={compact ? 'sm' : 'md'} label={`${providerName(provider)} ${primary.label.toLowerCase()} left`} />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-detail">
            <span className="text-muted">{primary.idle ? 'No window running · it starts with your next message' : resetText(primary, now)}</span>
            {words && <span className={cx('font-semibold', words.tone)} data-tip={words.tip}>{words.text}</span>}
          </div>
        </>
      ) : null}
      {others.length > 0 && <div className="my-1 h-px bg-line" />}
      {others.map((w) => (
        <OtherWindow key={w.id} w={w} now={now} />
      ))}
      {notice && <p className={cx('text-detail', notice.level === 'warn' ? 'text-warn' : 'text-muted')}>{notice.text}</p>}
      {refreshButton}
    </div>
  );
}

// ── The band ─────────────────────────────────────────────────────────────────

export function Band({ today }: { today?: ReactNode }) {
  const provider = useLive((s) => s.provider);
  const providers = plansIn(provider, useSources());
  // A provider with no plan still gets its place, saying so.
  const noPlan = provider !== 'all' && !providers.length ? provider : null;
  return (
    <>
      <div className={cx('overview-glance', `overview-glance-${providers.length + (noPlan ? 1 : 0) + (today ? 1 : 0)}`)}>
        {providers.map((p) => <Card key={p} aria-label={`${providerName(p)} plan limits`}><ProviderLimits provider={p} /></Card>)}
        {noPlan && <Card aria-label={`${providerName(noPlan)} plan limits`}><NoPlan source={noPlan} /></Card>}
        {today && <div className="overview-glance-today min-w-0">{today}</div>}
      </div>
      <Card aria-label="Attention inbox"><AttentionInbox /></Card>
    </>
  );
}
