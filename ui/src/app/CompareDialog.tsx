// Two sessions side by side: what each cost, and for how much work, so it's
// clear why one cost more than the other. Open it from a session's panel (with
// that one on the left) or ⌘K, and pick a session for each side. Totals come from
// the session list, like the Sessions page; tokens, subagents, compactions and
// interruptions from each session's own details.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ExternalLink, Pencil, Search } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { useSessionDetail, useSessions } from '@/data/queries';
import { useAllAgents } from '@/data/scope';
import { demo } from '@/data/api';
import type { SessionDetail } from '@/data/types';
import { clip, compact, dayLabel, duration, money, plural, projectName, whenText } from '@/lib/format';
import { titleFor } from '@/lib/labels';
import { byTokens } from '@/lib/measure';
import { totalsFrom, type Session } from '@/lib/sessions';
import { liveStateOf, type LiveAgent } from '@/lib/agents';
import { Dialog } from '@/components/Dialog';
import { Button, IconButton } from '@/components/Button';
import { Avatar, Empty, Insight, ProjectDot, Skeleton } from '@/components/Bits';
import { useUi } from './ui';
import { useCompare } from './dialogs';
import type { Source } from '@/lib/sources';

type Figures = {
  id: string;
  source: Source;
  title: string;
  project: string | null;
  startedAt: number | null;
  lastAt: number | null;
  models: string[];
  cost: number | null;
  partial: boolean;
  subCost: number | null;
  messages: number | null;
  agentMs: number | null;
  waitMs: number | null;
  added: number | null;
  removed: number | null;
  tools: number | null;
  failed: number | null;
  tokens: number | null;
  cacheShare: number | null;
  subagents: number | null;
  compactions: number | null;
  interrupts: number | null;
  loading: boolean;
  status: ReturnType<typeof liveStateOf> | null;
};

/** One session's figures, from the list, with its details where they've arrived. */
function figures(
  id: string,
  s: Session | null,
  live: LiveAgent | undefined,
  d: SessionDetail | null | undefined,
  loading: boolean,
): Figures {
  const t = s ? totalsFrom(s, 0) : null;
  const ok = d || null;
  return {
    id,
    source: s?.source || live?.source || ok?.source || 'claude',
    title: titleFor(id, s?.title || live?.title || ok?.title),
    project: s?.project || live?.project || ok?.project || null,
    startedAt: s?.startedAt ?? ok?.firstAt ?? null,
    lastAt: s?.lastAt ?? ok?.lastAt ?? null,
    models: s?.models?.map((m) => m.name) || ok?.models?.map((m) => m.name) || [],
    cost: t ? t.cost : (ok?.cost ?? null),
    partial: t ? t.partial : !!ok?.partial,
    subCost: t ? t.subCost : (ok?.subCost ?? null),
    messages: t ? t.messages : (ok?.messages?.count ?? null),
    agentMs: t ? t.agentMs : (ok?.agentMs ?? null),
    waitMs: t ? t.waitMs : (ok?.waitMs ?? null),
    added: t ? t.added : (ok?.lines?.added ?? null),
    removed: t ? t.removed : (ok?.lines?.removed ?? null),
    tools: t ? t.tools : (ok?.tools?.calls ?? null),
    failed: t ? t.failed : (ok?.tools?.failed ?? null),
    tokens: ok?.tokens?.total ?? (t ? t.tokens : null),
    cacheShare: ok?.tokens?.total ? ok.tokens.cacheRead / ok.tokens.total : null,
    subagents: ok?.subagents?.count ?? s?.subagents ?? null,
    compactions: ok?.compactions ?? null,
    interrupts: ok?.messages?.interrupts ?? null,
    loading,
    status: live ? liveStateOf(live) : null,
  };
}

type Row = [string, (f: Figures) => number | null, (v: number, f: Figures) => ReactNode, string?];

const lines = (f: Figures) => (
  <span className="whitespace-nowrap">
    <span className="text-ok">+{compact(f.added)}</span> <span className="text-bad">−{compact(f.removed)}</span>
  </span>
);

// What's compared, in order: a name, how to read it from a session's figures, how to show it.
const ROWS: Row[] = [
  [
    'Cost',
    (f) => f.cost,
    (v, f) => `≈ ${money(v)}${f.partial ? '+' : ''}`,
    'At API list prices, subagents included, over the last 30 days',
  ],
  [
    'Cost per message',
    (f) => (f.messages && f.cost != null ? f.cost / f.messages : null),
    (v) => `≈ ${money(v)}`,
    'Its cost, divided by the messages you sent',
  ],
  ['Your messages', (f) => f.messages, (v) => compact(v)],
  ['Agent time', (f) => f.agentMs, (v) => duration(v), 'How long the agent worked on your messages'],
  [
    'Agent time per message',
    (f) => (f.messages && f.agentMs != null ? f.agentMs / f.messages : null),
    (v) => duration(v),
  ],
  [
    'Waited for you',
    (f) => f.waitMs,
    (v) => duration(v),
    "From the agent's last reply to your next message, leaving out breaks over 30 minutes",
  ],
  ['Lines changed', (f) => (f.added ?? 0) + (f.removed ?? 0), (_v, f) => lines(f)],
  [
    'Lines per dollar',
    (f) => (f.cost != null && f.cost > 0.05 ? ((f.added ?? 0) + (f.removed ?? 0)) / f.cost : null),
    (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1)),
  ],
  [
    'Tool calls',
    (f) => f.tools,
    (v, f) => (
      <>
        {compact(v)}
        {f.failed ? (
          <small className="ml-1 text-muted">{Math.round((f.failed / Math.max(1, v)) * 100)}% failed</small>
        ) : null}
      </>
    ),
  ],
  ['Tokens', (f) => f.tokens, (v) => compact(v)],
  [
    'From the cache',
    (f) => f.cacheShare,
    (v) => `${Math.round(v * 100)}%`,
    'How much of what it read came from the prompt cache',
  ],
  [
    'Subagents',
    (f) => f.subagents,
    (v, f) => (
      <>
        {v}
        {f.subCost != null && f.subCost > 0.005 ? (
          <small className="ml-1 text-muted">≈ {money(f.subCost)}</small>
        ) : null}
      </>
    ),
  ],
  ['Compactions', (f) => f.compactions, (v) => String(v), 'Times the conversation was summarised to make room'],
  ['Interruptions', (f) => f.interrupts, (v) => String(v)],
];

/** The rows, with tokens first when that's what you compare by. */
function rows(): Row[] {
  if (!byTokens()) return ROWS;
  const tokens = ROWS.find(([name]) => name === 'Tokens')!;
  const perMessage: Row = [
    'Tokens per message',
    (f) => (f.messages && f.tokens != null ? f.tokens / f.messages : null),
    (v) => compact(v),
    'Its tokens, divided by the messages you sent',
  ];
  return [tokens, perMessage, ...ROWS.filter((r) => r !== tokens)];
}

/** The one or two things that most explain the difference. */
export function takeaway(a: Figures, b: Figures) {
  const tokens = byTokens();
  const v = (f: Figures) => (tokens ? f.tokens : f.cost) || 0;
  const least = tokens ? 10_000 : 0.05;
  if (!(v(a) > least && v(b) > least)) return '';
  const [hi, lo] = v(a) >= v(b) ? [a, b] : [b, a];
  const times = v(hi) / v(lo);
  if (times < 1.3) return tokens ? 'They used about as many tokens.' : 'They cost about the same.';
  const per = (f: Figures) => (f.messages ? v(f) / f.messages : null);
  const n = times >= 10 ? Math.round(times) : times.toFixed(1);
  const bits = [
    tokens ? `“${clip(hi.title, 40)}” used ${n}× the tokens` : `“${clip(hi.title, 40)}” cost ${n}× as much`,
  ];
  if (per(hi) && per(lo) && hi.messages && lo.messages) {
    const msgs = hi.messages / lo.messages;
    bits.push(
      msgs >= 1.3
        ? `with ${msgs.toFixed(1)}× the messages`
        : `for ${msgs < 0.8 ? 'fewer' : 'about as many'} messages, so each one ${tokens ? 'used' : 'cost'} ${(per(hi)! / per(lo)!).toFixed(1)}× more`,
    );
  }
  if (!tokens && hi.subCost != null && hi.cost != null && hi.subCost > hi.cost * 0.3)
    bits.push(`and ${Math.round((hi.subCost / hi.cost) * 100)}% of it went to subagents`);
  else if ((hi.compactions || 0) > (lo.compactions || 0) + 1)
    bits.push(`and its conversation had to be compacted ${plural(hi.compactions!, 'time')}`);
  return `${bits.join(' ')}.`;
}

function Side({ f, side, change }: { f: Figures; side: number; change: () => void }) {
  const openSession = useUi((s) => s.openSession);
  const close = useCompare((s) => s.close);
  const span = f.startedAt
    ? `${dayLabel(f.startedAt)}${f.lastAt && dayLabel(f.lastAt) !== dayLabel(f.startedAt) ? ` – ${dayLabel(f.lastAt)}` : ''}`
    : '';
  return (
    <div
      className="flex min-w-0 items-start gap-2.5 rounded-row border border-line bg-sunken/40 p-3"
      aria-label={side ? 'Right' : 'Left'}
    >
      <Avatar source={f.source} status={f.status} size={22} />
      <div className="flex min-w-0 grow flex-col">
        <b className="truncate">{clip(f.title, 70)}</b>
        <small className="flex items-center gap-1.5 truncate text-detail text-muted">
          {f.project && (
            <>
              <ProjectDot name={f.project} />
              {projectName(f.project)}
            </>
          )}
          {f.project && span && <span aria-hidden>·</span>}
          {span}
        </small>
      </div>
      <IconButton
        size="sm"
        variant="quiet"
        label="Open this session"
        tip="Open its panel"
        onClick={() => {
          close();
          openSession(f.id);
        }}
      >
        <ExternalLink size={14} strokeWidth={2} aria-hidden />
      </IconButton>
      <IconButton size="sm" variant="quiet" label="Pick another session" tip="Pick another" onClick={change}>
        <Pencil size={14} strokeWidth={2} aria-hidden />
      </IconButton>
    </div>
  );
}

function Picker({
  side,
  other,
  list,
  live,
  pick,
}: {
  side: 0 | 1;
  other: string | null;
  list: Session[] | undefined;
  live: Map<string, LiveAgent>;
  pick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), [side]);
  const q = query.trim().toLowerCase();
  const matches = (list || [])
    .filter((s) => s.id !== other)
    .filter(
      (s) =>
        !q ||
        [titleFor(s.id, s.title), s.title, s.project, s.project && projectName(s.project), s.model].some((x) =>
          x?.toLowerCase().includes(q),
        ),
    )
    .slice(0, 12);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex h-8 items-center gap-2 rounded-control border border-line bg-card px-2.5 text-detail focus-within:border-accent">
        <Search size={15} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
        <input
          ref={field}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter picks the first match.
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              pick(matches[0].id);
            }
          }}
          placeholder={`Pick the ${side ? 'second' : 'first'} session`}
          aria-label="Search sessions"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 grow bg-transparent outline-none placeholder:text-faint"
        />
      </label>
      {!list ? (
        <Skeleton lines={3} />
      ) : matches.length ? (
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {matches.map((s) => {
            const t = totalsFrom(s, 0);
            const a = live.get(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pick(s.id)}
                  className="flex w-full items-center gap-2.5 rounded-row px-2 py-1.5 text-left hover:bg-sunken"
                >
                  <Avatar source={s.source} status={a ? liveStateOf(a) : null} size={18} />
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-detail font-semibold">{clip(titleFor(s.id, s.title), 60)}</b>
                    <small className="truncate text-label text-muted">
                      {[
                        s.project && projectName(s.project),
                        whenText(s.lastAt),
                        byTokens() ? `${compact(t.tokens)} tokens` : `≈ ${money(t.cost)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>No session matches “{clip(query, 40)}”.</Empty>
      )}
    </div>
  );
}

function Table({ a, b }: { a: Figures; b: Figures }) {
  const cell = (v: number | null, f: Figures, max: number, show: Row[2]) =>
    v == null ? (
      <td className="px-2 py-1.5 text-muted">{f.loading ? '…' : '—'}</td>
    ) : (
      <td className="px-2 py-1.5">
        <span className="block font-semibold tnum">{show(v, f)}</span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-sunken">
          <i
            className="block h-full rounded-full bg-s1"
            style={{ width: `${max > 0 ? Math.max(2, (v / max) * 100).toFixed(1) : 0}%` }}
          />
        </span>
      </td>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-detail">
        <thead className="text-label text-muted">
          <tr>
            <th />
            <th scope="col" className="px-2 py-1 text-left font-semibold">
              Left
            </th>
            <th scope="col" className="px-2 py-1 text-left font-semibold">
              Right
            </th>
            <th scope="col" className="px-2 py-1 text-right font-semibold">
              Right vs left
            </th>
          </tr>
        </thead>
        <tbody>
          {rows().map(([name, read, show, tip]) => {
            const va = read(a);
            const vb = read(b);
            if (va == null && vb == null) return null;
            const max = Math.max(va || 0, vb || 0);
            // How the right one compares, when both have a figure worth comparing.
            const ratio = va! > 0 && vb! > 0 ? vb! / va! : null;
            const diff =
              ratio == null || Math.abs(ratio - 1) < 0.05
                ? ''
                : ratio >= 1
                  ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×`
                  : `${1 / ratio >= 10 ? Math.round(1 / ratio) : (1 / ratio).toFixed(1)}× less`;
            return (
              <tr key={name} data-tip={tip} className="border-t border-line">
                <th scope="row" className="w-44 px-2 py-1.5 text-left font-normal text-muted">
                  {name}
                </th>
                {cell(va, a, max, show)}
                {cell(vb, b, max, show)}
                <td className="px-2 py-1.5 text-right text-muted tnum">{diff}</td>
              </tr>
            );
          })}
          <tr className="border-t border-line">
            <th scope="row" className="px-2 py-1.5 text-left font-normal text-muted">
              Models
            </th>
            <td className="px-2 py-1.5">{a.models.join(', ') || '—'}</td>
            <td className="px-2 py-1.5">{b.models.join(', ') || '—'}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function CompareDialog() {
  useChanged();
  const { open, picks, picking, close } = useCompare();
  const { data: list } = useSessions({ enabled: open });
  const all = useAllAgents();
  const live = useMemo(() => new Map(all.filter((a) => a.kind === 'main').map((a) => [a.id, a])), [all]);
  const details = [useSessionDetail(picks[0], { enabled: open }), useSessionDetail(picks[1], { enabled: open })];
  const fig = (i: 0 | 1) => {
    const id = picks[i];
    if (!id) return null;
    return figures(
      id,
      list?.find((s) => s.id === id) || null,
      live.get(id),
      details[i].data,
      !demo && details[i].isPending,
    );
  };
  const a = fig(0);
  const b = fig(1);
  const setPick = (side: 0 | 1, id: string) => {
    const next: [string | null, string | null] = [...picks];
    next[side] = id;
    useCompare.setState({ picks: next, picking: next[0] ? (next[1] ? null : 1) : 0 });
  };
  const change = (side: 0 | 1) => useCompare.setState({ picking: side });
  const side = (i: 0 | 1, f: Figures | null) =>
    picking === i || !f ? (
      <Picker side={i} other={picks[1 - i]} list={list} live={live} pick={(id) => setPick(i, id)} />
    ) : (
      <Side f={f} side={i} change={() => change(i)} />
    );
  const tip = a && b ? takeaway(a, b) : '';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      wide
      title="Compare sessions"
      description={a && b ? 'Over the last 30 days, at API list prices' : 'Pick two sessions to see them side by side'}
      tools={
        a && b ? (
          <Button
            size="sm"
            icon={<ArrowLeftRight size={13} strokeWidth={2} aria-hidden />}
            onClick={() => useCompare.setState({ picks: [picks[1], picks[0]] })}
          >
            Swap
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {side(0, a)}
          {side(1, b)}
        </div>
        {a && b && picking == null && (
          <>
            <Table a={a} b={b} />
            {tip && <Insight>{tip}</Insight>}
          </>
        )}
      </div>
    </Dialog>
  );
}
