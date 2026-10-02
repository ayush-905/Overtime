// Today, as one card (it takes over the old four tiles and "Today's activity"):
// what today would cost (or the tokens, by what you compare by) against
// yesterday by this time, and the last 30 days as bars split by provider, with
// your time and the work done across the bottom. A day's bar opens its
// sessions. Past your daily budget, it says so.

import { useScope, useAlertPrefs } from '@/data/scope';
import { useChanged, useNow } from '@/data/hooks';
import { useLive } from '@/data/live';
import { activeBetween, calendarDay, compact, costText, dayLabel, duration, longDate, money } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { byTokens, measureOf, valueShort } from '@/lib/measure';
import { dayParam, pageLink } from '@/lib/route';
import { Card, Eyebrow } from '@/components/Card';
import { Figure, Stat } from '@/components/Stat';
import { Skeleton } from '@/components/Bits';
import { cx } from '@/components/cx';
import { ExpandButton } from './Expand';

type Day = { start: number; cost: number; tokens: number };
type Spend = { cost: number; tokens: number; unpricedTokens?: number };

/** Some usage had no known price, enough to matter (over 1% of its tokens). */
const unpriced = (p?: Spend | null) => !!p && (p.unpricedTokens || 0) > p.tokens * 0.01;

/** How today compares with yesterday by now: "↓ 56% on yesterday by now". */
function delta(current: number, previous: number | undefined, tokens: boolean) {
  if (!(previous! > (tokens ? 1000 : 0.5))) return null;
  const pct = Math.round(((current - previous!) / previous!) * 100);
  const text = Math.abs(pct) < 1 ? 'the same as yesterday by now' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% on yesterday by now`;
  return { text, tip: `${tokens ? `${compact(previous!)} tokens` : money(previous!)} yesterday by this time` };
}

/** The last 30 days, a bar each, Claude Code under Codex. */
function Spark({ claude, codex, both, tall = 52 }: { claude: Day[]; codex: Day[]; both: boolean; tall?: number }) {
  const tokens = byTokens();
  const days = claude.length ? claude : codex;
  const at = (list: Day[], i: number) => (list[i] ? measureOf(list[i]) : 0);
  const max = Math.max(0.01, ...days.map((_, i) => at(claude, i) + at(codex, i)));
  return (
    <div role="img" aria-label={`${tokens ? 'Tokens' : 'Cost'} each day for the last 30 days${both ? ', Claude Code and Codex' : ''}`} className="flex items-end justify-between gap-[3px]" style={{ height: tall }}>
      {days.map((d, i) => {
        const c = at(claude, i);
        const x = at(codex, i);
        const total = c + x;
        const tip = `${longDate(d.start)} · ${tokens ? `${compact(total)} tokens` : `≈ ${money(total)}`}${both && c > 0 && x > 0 ? ` (Claude Code ${valueShort(c)}, Codex ${valueShort(x)})` : ''}${total > 0 ? '\nClick for that day’s sessions' : ''}`;
        const today = i === days.length - 1;
        const body = (
          <>
            {x > 0 && <span className="block rounded-t-[2px] bg-codex" style={{ height: Math.max(2, (x / max) * tall) }} />}
            {c > 0 && <span className={cx('block bg-claude', x > 0 ? 'rounded-b-[2px]' : 'rounded-[2px]')} style={{ height: Math.max(2, (c / max) * tall) }} />}
            {total <= 0 && <span className="block h-px rounded-full bg-line-strong" />}
          </>
        );
        return total > 0 ? (
          <a key={d.start} href={pageLink('sessions', { day: dayParam(d.start) })} data-tip={tip} className={cx('flex w-full max-w-2 flex-col justify-end', today && 'outline outline-1 outline-offset-1 outline-line-strong rounded-[3px]')} style={{ height: tall }}>
            {body}
          </a>
        ) : (
          <span key={d.start} data-tip={tip} className="flex w-full max-w-2 flex-col justify-end" style={{ height: tall }}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

export function TodayCard({ expanded = false, glance = false }: { expanded?: boolean; glance?: boolean }) {
  useChanged();
  useNow();
  const { scope, provider } = useScope();
  const prefs = useAlertPrefs();
  const analytics = useLive((s) => s.snap?.analytics);
  const spend = scope?.spend;
  const today = spend?.today;
  if (!spend || !today) {
    return (
      <Card aria-label="Today">
        <Skeleton lines={3} />
      </Card>
    );
  }
  const tokens = byTokens();
  const insights = scope?.insights as { messages?: { today?: number }; hours?: never } | null;
  const now = serverNow();
  const active = activeBetween(insights?.hours, calendarDay(now), now);
  const trend = (p: string) => ((analytics?.[p as 'claude']?.insights as { trend?: { days: Day[] } } | null)?.trend?.days || []) as Day[];
  const claude = provider === 'codex' ? [] : trend('claude');
  const codex = provider === 'claude' ? [] : trend('codex');
  const month = spend.last30;
  const d = delta(measureOf(today), measureOf(spend.yesterdayByNow), tokens);
  const partial = unpriced(today);
  const overBudget = prefs.budget && prefs.budgetUsd > 0 && (analytics?.all?.spend?.today?.cost ?? 0) >= prefs.budgetUsd;
  const t = scope?.today;
  if (glance) return (
    <Card aria-label="Today" className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2"><Eyebrow>Today</Eyebrow><span className="ml-auto text-label text-muted">{tokens ? 'Tokens' : 'API equivalent'}</span><ExpandButton card="today" /></div>
      <a href={pageLink('sessions', { range: 'today' })} className="text-ink no-underline" data-tip="Open today's sessions">
        <Figure size="hero" value={tokens ? compact(today.tokens) : costText(today.cost, partial)} unit={tokens ? 'tokens' : undefined} />
      </a>
      <p className="mt-2 text-detail text-muted">{d ? <span data-tip={d.tip}>{d.text}</span> : tokens ? 'Tokens used today' : 'At API list prices'}</p>
      {overBudget && <p className="mt-1 text-detail text-warn">Past your {money(prefs.budgetUsd)} daily budget</p>}
      <div className="mb-3 mt-4"><Spark claude={claude} codex={codex} both={provider === 'all'} tall={40} /></div>
      <div className="mb-3.5 flex flex-wrap justify-between gap-2 text-label text-muted"><span>Last 30 days</span>{provider === 'all' && <span className="flex gap-2"><span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-claude" />Claude</span><span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-codex" />Codex</span></span>}</div>
      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-3 [&_dd]:text-[1rem]">
        <Stat label="Active" value={active ? duration(active) : '0m'} />
        <Stat label="Sessions" value={t?.sessions ?? 0} />
        <Stat label={tokens ? 'API cost' : 'Tokens'} value={tokens ? costText(today.cost, partial) : compact(today.tokens)} />
      </dl>
    </Card>
  );
  return (
    <Card flush aria-label="Today" className="overview-today grid [&>*]:min-w-0">
      <a href={pageLink('sessions', { range: 'today' })} className="flex flex-col gap-1.5 border-line px-[var(--card-px)] py-[var(--card-py)] text-ink no-underline @min-[700px]:border-r" data-tip="See today's sessions">
        <Eyebrow>Today</Eyebrow>
        <Figure value={tokens ? compact(today.tokens) : costText(today.cost, partial)} unit={tokens ? 'tokens' : undefined} />
        <span className="text-detail text-muted">
          {tokens ? costText(today.cost, partial) : `${compact(today.tokens)} tokens`}
          {d && <span data-tip={d.tip}> · {d.text}</span>}
        </span>
        {overBudget && <span className="text-detail font-semibold text-warn">Past your {money(prefs.budgetUsd)} budget for today</span>}
      </a>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] content-center gap-4 border-t border-line px-[var(--card-px)] py-[var(--card-py)] @max-[699px]:border-b @min-[700px]:order-last @min-[700px]:col-span-2 @min-[700px]:grid-cols-5 [&_dt]:whitespace-nowrap">
        <Stat label="Active" value={active ? duration(active) : '0m'} tip="From each message you sent until the agent's last reply, with breaks under 30 minutes bridged" />
        <Stat label="Sessions" value={t?.sessions ?? 0} />
        <Stat label="Your messages" value={insights?.messages?.today ?? '—'} tip="Messages you typed, not background notices or subagent tasks" />
        <Stat label="Tool calls" value={compact(t?.tools ?? 0)} />
        <Stat label="Lines changed" value={<><span className="text-ok">+{compact(t?.added ?? 0)}</span> <span className="text-bad">−{compact(t?.removed ?? 0)}</span></>} />
      </dl>
      <div className="flex flex-col gap-2 px-[var(--card-px)] py-[var(--card-py)]">
        <div className="flex items-baseline justify-between gap-2">
          <Eyebrow>Last 30 days</Eyebrow>
          <span className="font-bold tnum">{month ? (tokens ? compact(month.tokens) : costText(month.cost, unpriced(month))) : '—'}</span>
        </div>
        <Spark claude={claude} codex={codex} both={provider === 'all'} tall={expanded ? 160 : 64} />
        <div className="flex items-center justify-between text-label text-muted">
          <span>{(claude[0] || codex[0]) && dayLabel((claude[0] || codex[0]).start)}</span>
          {provider === 'all' && (
            <span className="flex gap-2.5">
              <span className="inline-flex items-center gap-1"><span className="size-2 shrink-0 rounded-[2px] bg-claude" />Claude Code</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 shrink-0 rounded-[2px] bg-codex" />Codex</span>
            </span>
          )}
          <span>Today</span>
        </div>
      </div>
    </Card>
  );
}
