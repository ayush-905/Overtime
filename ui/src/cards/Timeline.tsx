// Today as a timeline: a lane for each session that did something today, in its
// provider's colour (its subagents thinner under it), a tick for each message you
// sent, and amber where it sat done waiting for your reply. Your own active time
// runs along the foot, over a shading of your usual day. It runs from the hour
// things started to now, so a quiet morning takes no room; "now" moves on by the
// minute, a fraction of a percent across.

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { useHasInsights, useInsight, useProvider, useScopedAgents, useSources } from '@/data/scope';
import { useChanged, useMinute } from '@/data/hooks';
import { clip, clock, duration, hourLabel, money, plural, projectName } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { titleFor } from '@/lib/labels';
import { byTokens, measureOf, otherText, something, valueShort } from '@/lib/measure';
import { timelineModel, total } from '@/lib/timeline';
import { liveStateOf } from '@/lib/agents';
import { Card, CardHead } from '@/components/Card';
import { Avatar, Empty, Insight, Skeleton } from '@/components/Bits';
import { useUi } from '@/app/ui';
import { useCompact } from '@/app/layout';
import { cx } from '@/components/cx';
import { ExpandButton } from './Expand';
import { SOURCE, sourceInfo } from '@/lib/sources';

const SHOWN = 8;
const NOTE =
  "Each session that did something today. Its bar is its agent working, from each message until its last reply, in its provider's colour; the thin one under it is its subagents. A tick is a message you sent, and amber is the agent done and waiting for your reply (waits over 30 minutes count as you stepping away, so they're left out). Your own active time runs along the foot. Click a session for the details.";

function Legend() {
  const sources = useSources();
  const provider = useProvider();
  const chip = (cls: string, text: string) => (
    <span key={text} className="inline-flex items-center gap-1.5">
      <span className={cx('h-2 w-3.5 rounded-[3px]', cls)} />
      {text}
    </span>
  );
  return (
    <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-label text-muted" aria-hidden>
      {(provider === 'all' ? sources : [provider]).map((s) => chip(SOURCE[s].bg, SOURCE[s].name))}
      {chip('border border-warn-line bg-warn-soft', 'Waiting for you')}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5 rounded-full bg-ink" />
        Your message
      </span>
      {chip('bg-you', 'You, active')}
    </p>
  );
}

export function TimelineCard({ expanded = false }: { expanded?: boolean }) {
  const v = useChanged();
  const minute = useMinute();
  const agents = useScopedAgents();
  const hasInsights = useHasInsights();
  const openSession = useUi((s) => s.openSession);
  const [showAll, setShowAll] = useState(false);
  // Narrow (a phone, the popover), each session's name sits over its bar.
  const stacked = useCompact();
  const tl = useInsight('timeline');
  // Worked out again each minute, and when the day or the agents change.
  const [m, now] = useMemo(() => {
    const at = serverNow();
    return [tl ? timelineModel(tl, agents, at) : null, at] as const;
  }, [tl, agents, minute, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = "Today's timeline";
  const tools = (
    <>
      <span data-tip={NOTE} className="grid size-7 place-items-center text-muted" aria-label={NOTE}>
        <Info size={15} strokeWidth={1.8} aria-hidden />
      </span>
      {!expanded && <ExpandButton card="timeline" />}
    </>
  );
  if (!tl) {
    return (
      <Card aria-label={title}>
        <CardHead title={title} tools={tools} />
        {hasInsights ? <Empty>Restart Overtime (npm start) to see today as a timeline.</Empty> : <Skeleton lines={4} />}
      </Card>
    );
  }
  if (!m) {
    return (
      <Card aria-label={title}>
        <CardHead title={title} sub="Today · since midnight" tools={tools} />
        <Empty>No session has done anything yet today.</Empty>
      </Card>
    );
  }
  const tokens = byTokens();
  const lanes = showAll || expanded ? m.lanes : m.lanes.slice(0, SHOWN);
  const pos = (t: number) => `${m.x(t).toFixed(2)}%`;
  const wid = (a: number, b: number) => `${m.w(a, b).toFixed(2)}%`;
  const grid = { gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : 'minmax(0, 250px) minmax(0, 1fr)' };
  const figure = (l: { cost: number; tokens: number; partial: boolean }) =>
    something(measureOf(l)) ? `${valueShort(measureOf(l))}${tokens ? ' tokens' : l.partial ? '+' : ''}` : '';
  const others = m.others?.sessions
    ? `and ${plural(m.others.sessions, 'quieter session')} (${duration(m.others.busyMs)}${something(measureOf(m.others)) ? `, ${valueShort(measureOf(m.others))}${tokens ? ' tokens' : ''}` : ''})`
    : '';
  return (
    <Card aria-label={title} className="flex flex-col gap-3">
      <CardHead className="mb-0" title={title} sub={m.summary} tools={tools} />
      <div className="relative flex flex-col" role="list" aria-label="Sessions today">
        <div className="grid h-5 gap-4" style={grid} aria-hidden>
          {!stacked && <span />}
          <div className="relative">
            {m.ticks
              .filter((k) => k.labelled)
              .map((k) => (
                <span
                  key={k.t}
                  className={cx(
                    'absolute top-0 whitespace-nowrap text-label text-muted tnum',
                    m.x(k.t) < 4 ? '' : m.x(k.t) > 96 ? '-translate-x-full' : '-translate-x-1/2',
                  )}
                  style={{ left: pos(k.t) }}
                >
                  {hourLabel(k.hour)}
                </span>
              ))}
          </div>
        </div>
        {lanes.map((l) => {
          const status = agents.find((a) => a.id === l.id);
          const waitMs = total(l.waits);
          const tip = [
            titleFor(l.id, l.title),
            [
              l.project && projectName(l.project),
              something(measureOf(l))
                ? `${tokens ? `${valueShort(l.tokens)} tokens · ${otherText(l)}` : `≈ ${money(l.cost)}${l.partial ? '+' : ''} · ${otherText(l)}`} today`
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
            `Agents worked ${duration(l.busyMs)}${waitMs ? `, waited ${duration(waitMs)} for you` : ''} · ${plural(l.messages.length, 'message')} from you`,
            'Click for details',
          ]
            .filter(Boolean)
            .join('\n');
          return (
            <div
              key={l.id}
              role="listitem"
              tabIndex={0}
              data-row=""
              data-session={l.id}
              data-tip={tip}
              onClick={() => openSession(l.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openSession(l.id))}
              className={cx(
                'grid cursor-pointer rounded-sm outline-offset-[-2px] hover:bg-[color-mix(in_srgb,var(--ink)_3%,transparent)]',
                stacked ? 'gap-1.5 py-1.5' : 'h-10 items-center gap-4',
              )}
              style={grid}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar source={l.source} status={status ? liveStateOf(status) : null} size={18} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-detail font-semibold">{clip(titleFor(l.id, l.title), 60)}</span>
                  <span className="truncate text-label text-muted">
                    {[l.project && projectName(l.project), figure(l)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
              <span className="relative block h-3 rounded-[6px] bg-sunken">
                {l.waits.map(([a, b], i) => (
                  <span
                    key={`w${i}`}
                    data-tip={`Waited for you ${m.spanText(a, b)} (${duration(b - a)})`}
                    className="absolute inset-y-0 box-border rounded-[4px] border border-warn-line bg-warn-soft"
                    style={{ left: pos(a), width: wid(a, b) }}
                  />
                ))}
                {l.work.map(([a, b], i) => (
                  <span
                    key={`k${i}`}
                    data-tip={`Working ${m.spanText(a, b)} (${duration(b - a)})`}
                    className={cx('absolute inset-y-0 min-w-[3px] rounded-[4px]', sourceInfo(l.source).bg)}
                    style={{ left: pos(a), width: wid(a, b) }}
                  />
                ))}
                {l.sub.map(([a, b], i) => (
                  <span
                    key={`s${i}`}
                    data-tip={`Subagents working ${m.spanText(a, b)} (${duration(b - a)})`}
                    className={cx(
                      'absolute -bottom-1 h-[3px] min-w-[3px] rounded-full opacity-60',
                      sourceInfo(l.source).bg,
                    )}
                    style={{ left: pos(a), width: wid(a, b) }}
                  />
                ))}
                <span
                  className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink/70"
                  style={{ left: pos(now) }}
                  aria-hidden
                />
                {l.messages.map((t) => (
                  <span
                    key={`m${t}`}
                    data-tip={`You sent a message at ${clock(t)}`}
                    className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
                    style={{ left: pos(t) }}
                  />
                ))}
              </span>
            </div>
          );
        })}
        <div
          className={cx('mt-1 grid border-t border-line', stacked ? 'gap-1.5 pt-2' : 'h-11 items-center gap-4')}
          style={grid}
          data-tip={`Your active time today: ${duration(m.activeMs)}\nFrom each message you sent until the agent's reply to it ended, with breaks under 30 minutes bridged${m.usual ? `\nThe shading behind it is your usual day, from your last ${plural(m.usual.days, 'working day')}` : ''}`}
        >
          <span className="flex items-center gap-2.5">
            <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-sunken text-[9px] font-bold text-muted">
              You
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-detail font-semibold">Your active time</span>
              <span className="truncate text-label text-muted">
                {duration(m.activeMs)}
                {m.usualStart != null ? ` · usually from ${clock(m.usualStart)}` : ''}
              </span>
            </span>
          </span>
          <span className="relative block h-3 rounded-[6px] bg-sunken">
            {m.shade.map((s) => (
              <span
                key={s.from}
                className="absolute inset-y-0 rounded-[6px] bg-usual"
                style={{
                  left: pos(s.from),
                  width: wid(s.from, s.to),
                  opacity: s.level === 3 ? 1 : s.level === 2 ? 0.7 : 0.4,
                }}
              />
            ))}
            {m.you.map(([a, b]) => (
              <span
                key={a}
                data-tip={`Active ${m.spanText(a, b)} (${duration(b - a)})`}
                className="absolute inset-y-[2px] rounded-[4px] bg-you"
                style={{ left: pos(a), width: wid(a, b) }}
              />
            ))}
            <span
              className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
              style={{ left: pos(now) }}
              aria-hidden
            />
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <span className="flex items-center gap-3 text-label text-muted">
          {others && <span>{others}</span>}
          {!expanded && m.lanes.length > SHOWN && (
            <button
              type="button"
              className="font-semibold text-ink hover:underline"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show fewer' : `Show all ${m.lanes.length} sessions`}
            </button>
          )}
        </span>
      </div>
      {m.tip && <Insight>{m.tip}</Insight>}
    </Card>
  );
}
