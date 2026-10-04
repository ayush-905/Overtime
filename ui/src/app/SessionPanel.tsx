// The session panel: click a session anywhere to see it in full. What's live
// (what it's doing, the files it changed, its context) comes with the feed; its
// history (cost over time, your messages, subagents, tools) from /api/session.
// One of your messages opens in it with what it led to (the agent's replies, the
// files it read and changed, the commands it ran), from /api/turn: click the
// message, or a search's match, which opens it with the words marked. It floats
// over the page, or docks beside it (when the window has room) and stays open as
// you look around. Its left edge drags it wider.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  ArrowLeftRight, Check, Copy, ExternalLink, Folder, PanelRightClose, PanelRightOpen, Pencil, Pin, Play, Tag, TriangleAlert, X, Ban,
} from 'lucide-react';
import { useLive } from '@/data/live';
import { useSessionDetail, useTurn } from '@/data/queries';
import { useChanged, useMedia, useNow } from '@/data/hooks';
import { demo, post } from '@/data/api';
import { inPopover, openInWindow } from '@/data/desktop';
import { ago, clip, clock, compact, costText, dayLabel, duration, lower, money, moneyCol, plural, projectName, whenText } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { MAX_NOTE, MAX_TAGS, allTags, cleanTag, customName, isPinned, noteFor, rename, setNote, setTags, tagsFor, tidyTitle, titleFor, togglePin } from '@/lib/labels';
import { doingText, liveStateOf, sinceFor, type LiveAgent } from '@/lib/agents';
import { queryTerms } from '@/lib/search';
import { pageLink } from '@/lib/route';
import { Empty, Marked, ProjectDot, Skeleton } from '@/components/Bits';
import { Button, IconButton } from '@/components/Button';
import { cx } from '@/components/cx';
import { note, offerUndo } from './toasts';
import { DRAWER, useUi } from './ui';
import { useCompare } from './CompareDialog';
import { sourceInfo, type Source } from '@/lib/sources';

const ENTRY: Record<string, string> = { 'claude-desktop': 'Desktop app', 'claude-vscode': 'VS Code', cli: 'Terminal', codex: 'Codex' };

// ── What the server sends ─────────────────────────────────────────────────────

type Detail = {
  id: string;
  nativeId: string;
  source: Source;
  title: string | null;
  project: string | null;
  cwd: string | null;
  firstAt: number | null;
  lastAt: number | null;
  cost: number;
  partial: boolean;
  subCost: number;
  saved: number;
  tokens: { fresh: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  models: { name: string; cost: number; tokens: number; other?: boolean }[];
  lines: { added: number; removed: number };
  tools: { calls: number; failed: number; denied: number; top: [string, number][] };
  compactions: number;
  context: { used: number; window: number; pct: number; at: number } | null;
  agentMs: number;
  waitMs: number;
  messages: { count: number; interrupts: number; list: { t: number; text: string; cost: number; partial: boolean; ms: number }[] };
  subagents: { count: number; list: { title: string; firstAt: number | null; calls: number; cost: number; partial: boolean }[] };
  timeline: { from: number; step: number; costs: number[] } | null;
  resume?: { terminal?: boolean; app?: { name: string; url: string } | null; appMissing?: string | null };
};

type Turn = {
  t: number;
  text: string;
  whole: boolean;
  replies: { t: number; text: string }[];
  moreReplies: number;
  searchOn: boolean;
  files: { path: string; edits: number; added: number; removed: number; reads: number }[];
  moreFiles: number;
  commands: { text: string; status: 'ok' | 'error' | 'denied'; reason?: string; sub?: boolean }[];
  moreCommands: number;
  tools: [string, number][];
  cost: number;
  partial: boolean;
  ms: number;
  tokens: number;
  subagents: number;
  failed: number;
  denied: number;
  cwd: string | null;
};

type Live = LiveAgent & { cwd?: string; nativeId?: string; branch?: string | null; model?: string | null; entrypoint?: string | null; startedAt?: number; cost?: number; tokens?: { total: number }; lines?: { added: number; removed: number }; turns?: number; files?: { path: string; name: string; added: number; removed: number }[] };
type Proc = { id?: string; source: Source; title?: string; project?: string; lastActive?: number; openedAt: number; memBytes: number; toolsMemBytes: number; tools: number; cpuPct?: number | null; runtimeShared?: boolean };

// ── Small pieces ─────────────────────────────────────────────────────────────

function Section({ title, sub, tools, children, className }: { title: ReactNode; sub?: ReactNode; tools?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2.5 border-t border-line px-5 py-4', className)}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-detail font-semibold">
          {title} {sub && <small className="ml-1 font-normal text-muted">{sub}</small>}
        </h3>
        {tools && <div className="ml-auto flex items-center gap-1.5">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={2} aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {}
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

/** A path as it reads in the session's folder. */
const shortPath = (p: string, cwd: string | null) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p.replace(/^\/Users\/[^/]+/, '~'));

const shellQuote = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// ── Its sections ─────────────────────────────────────────────────────────────

function Status({ live, d, proc, now }: { live: Live | null; d: Detail | null; proc: Proc | null; now: number }) {
  if (live) {
    const state = liveStateOf(live);
    const since = sinceFor(live);
    return (
      <div className={cx('mx-5 mt-1 flex items-center gap-2.5 rounded-row px-3 py-2.5', state === 'needs' ? 'bg-warn-soft' : state === 'working' ? 'bg-ok-soft' : 'bg-sunken')}>
        <span className={cx('size-2 shrink-0 rounded-full', state === 'needs' ? 'bg-warn-fill' : state === 'working' ? 'bg-ok-fill' : 'bg-faint')} aria-hidden />
        <b className={cx('font-semibold', state === 'needs' ? 'text-warn' : state === 'working' ? 'text-ok' : '')}>{doingText(live)}</b>
        {since != null && <span className="ml-auto shrink-0 whitespace-nowrap text-detail text-muted tnum">for {ago(Math.max(0, now - since))}</span>}
      </div>
    );
  }
  if (proc) {
    const last = proc.lastActive ? `last active ${ago(Math.max(0, now - proc.lastActive))} ago` : `opened ${ago(now - proc.openedAt)} ago`;
    return (
      <div className="mx-5 mt-1 flex items-center gap-2.5 rounded-row bg-sunken px-3 py-2.5">
        <span className="size-2 shrink-0 rounded-full bg-faint" aria-hidden />
        <b className="font-semibold">Open on this Mac, idle</b>
        <span className="ml-auto text-detail text-muted">{last}</span>
      </div>
    );
  }
  if (d?.lastAt) {
    return (
      <div className="mx-5 mt-1 flex items-center gap-2.5 rounded-row bg-sunken px-3 py-2.5">
        <b className="font-semibold">Not running</b>
        <span className="ml-auto text-detail text-muted">last active {whenText(d.lastAt)}, {ago(now - d.lastAt)} ago</span>
      </div>
    );
  }
  return null;
}

function TurnView({ id, at, terms, onClose }: { id: string; at: number; terms: string[]; onClose: () => void }) {
  const q = useTurn(id, Math.round(at));
  const box = useRef<HTMLDivElement>(null);
  const t = q.data as Turn | undefined;
  // A search's match, once it's there, is brought into view.
  useEffect(() => {
    const hit = box.current?.querySelector('[data-hit]');
    hit?.scrollIntoView({ block: 'center' });
  }, [t]);
  const close = <IconButton label="Back to the whole session" variant="quiet" size="sm" onClick={onClose}><X size={15} strokeWidth={2} aria-hidden /></IconButton>;
  if (q.isLoading) return <Section title="Your message" tools={close}><Skeleton lines={3} /></Section>;
  if (!t) return <Section title="Your message" tools={close}><Empty>{demo ? 'The demo has no messages to open.' : "Couldn't find that message in the last 31 days of transcripts."}</Empty></Section>;
  const hitYou = terms.length > 0 && Math.abs(t.t - at) < 1500;
  const facts = [costText(t.cost, t.partial), t.ms > 60_000 ? `kept it busy ${duration(t.ms)}` : '', `${compact(t.tokens)} tokens`, t.subagents ? plural(t.subagents, 'subagent') : '', t.failed ? `${t.failed} failed` : '', t.denied ? `${t.denied} denied by you` : ''].filter(Boolean).join(' · ');
  return (
    <div ref={box}>
      <Section title="Your message" sub={whenText(t.t)} tools={close} className="bg-[color-mix(in_srgb,var(--accent)_4%,var(--card))]">
        <blockquote data-hit={hitYou ? '' : undefined} className={cx('m-0 whitespace-pre-wrap rounded-row border-l-2 border-ink/40 bg-sunken px-3 py-2 text-body', hitYou && 'ring-2 ring-warn-line')}>
          <Marked text={t.text} terms={terms} />
          {t.whole ? '' : '…'}
        </blockquote>
        {t.replies.length > 0 ? (
          <>
            <h4 className="mt-1 text-detail font-semibold">
              What the agent said <small className="font-normal text-muted">{plural(t.replies.length + t.moreReplies, 'reply', 'replies')}{t.moreReplies ? ', the first 4 and the last 20' : ''}</small>
            </h4>
            <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto">
              {t.replies.map((r) => {
                const hit = terms.length > 0 && Math.abs(r.t - at) < 1500;
                return (
                  <div key={r.t} data-hit={hit ? '' : undefined} className={cx('flex gap-2.5 rounded-sm px-1 text-detail', hit && 'bg-warn-soft')}>
                    <time className="w-12 shrink-0 text-muted tnum">{clock(r.t)}</time>
                    <p className={cx('whitespace-pre-wrap', r.text.length > 700 && !hit && 'line-clamp-6')}>
                      <Marked text={r.text} terms={terms} />
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          !t.searchOn && <Empty>Turn on search inside conversations in Settings → Data to see the agent’s replies here too.</Empty>
        )}
        {t.files.length || t.commands.length || t.tools.length ? (
          <>
            <h4 className="mt-1 text-detail font-semibold">
              What it led to <small className="font-normal text-muted">{facts}</small>
            </h4>
            {t.files.length > 0 && (
              <ul className="flex flex-col gap-1 text-detail">
                {t.files.map((f) => (
                  <li key={f.path} data-tip={f.path} className="flex items-center gap-2">
                    <span className="grow truncate font-mono text-[12px]">{shortPath(f.path, t.cwd)}</span>
                    {f.edits ? (
                      <span className="tnum"><span className="text-ok">+{compact(f.added)}</span> <span className="text-bad">−{compact(f.removed)}</span></span>
                    ) : (
                      <small className="text-muted">read{f.reads > 1 ? ` ${f.reads}×` : ''}</small>
                    )}
                  </li>
                ))}
                {t.moreFiles > 0 && <li className="text-muted">and {t.moreFiles} more</li>}
              </ul>
            )}
            {t.commands.length > 0 && (
              <ul className="flex flex-col gap-1">
                {t.commands.map((c, i) => (
                  <li key={i} data-tip={c.reason} className="flex items-start gap-2 text-[12px]">
                    {c.status === 'error' ? <TriangleAlert size={13} className="mt-0.5 shrink-0 text-bad" aria-label="Failed" /> : c.status === 'denied' ? <Ban size={13} className="mt-0.5 shrink-0 text-muted" aria-label="Denied" /> : <Check size={13} className="mt-0.5 shrink-0 text-ok" aria-hidden />}
                    <code className="break-all font-mono">{c.text}</code>
                    {c.sub && <small className="shrink-0 text-muted">subagent</small>}
                  </li>
                ))}
                {t.moreCommands > 0 && <li className="text-detail text-muted">the last 30 of {t.commands.length + t.moreCommands}</li>}
              </ul>
            )}
            {t.tools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.tools.map(([name, n]) => (
                  <span key={name} className="rounded-full border border-line px-2 py-0.5 text-label">{name} <b>{n}</b></span>
                ))}
              </div>
            )}
          </>
        ) : (
          <Empty>No tool calls: {facts}.</Empty>
        )}
      </Section>
    </div>
  );
}

function Notes({ id }: { id: string }) {
  useChanged();
  const mine = tagsFor(id);
  const [draft, setDraft] = useState('');
  const [text, setText] = useState(noteFor(id));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A new session, or a note changed in another tab while you're not typing.
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(noteFor(id));
  }, [id, mine.length]);
  useEffect(() => () => {
    clearTimeout(timer.current);
  }, []);
  const flush = (value = text) => {
    clearTimeout(timer.current);
    setNote(id, value);
  };
  const add = (raw: string) => {
    const t = cleanTag(raw);
    if (t) setTags(id, [...tagsFor(id), t]);
    setDraft('');
  };
  const others = allTags().map(([t]) => t).filter((t) => !mine.some((m) => m.toLowerCase() === t.toLowerCase())).slice(0, 6);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && mine.length) {
      e.preventDefault();
      setTags(id, mine.slice(0, -1));
    } else if (e.key === 'Escape' && draft) {
      e.stopPropagation();
      setDraft('');
    }
  };
  return (
    <Section title="Notes and tags" sub="only on this dashboard">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
        {mine.map((t) => (
          <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full border border-line pl-2.5 pr-1 text-detail">
            <Tag size={12} strokeWidth={2} className="text-muted" aria-hidden />
            <a href={pageLink('sessions', { tag: t })} data-tip={`Every session tagged ${t}`} className="no-underline hover:underline" onClick={() => useUi.getState().closeSession()}>
              {t}
            </a>
            <button
              type="button"
              aria-label={`Remove the tag ${t}`}
              className="grid size-5 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
              onClick={() => {
                const before = tagsFor(id);
                setTags(id, before.filter((x) => x !== t));
                offerUndo(`Took off the tag “${t}”`, () => setTags(id, before));
              }}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          </span>
        ))}
        {mine.length < MAX_TAGS && (
          <input
            type="text"
            value={draft}
            maxLength={24}
            onChange={(e) => {
              const v = e.target.value;
              // A comma, typed or pasted, finishes the tag before it.
              if (v.includes(',')) {
                const parts = v.split(',');
                const rest = parts.pop() || '';
                setTags(id, [...tagsFor(id), ...parts]);
                setDraft(rest.trimStart());
              } else setDraft(v);
            }}
            onKeyDown={onKey}
            onBlur={() => draft.trim() && add(draft)}
            placeholder={mine.length ? 'Add another' : 'Add a tag, like bug or release'}
            aria-label="Add a tag"
            autoComplete="off"
            spellCheck={false}
            className="h-7 min-w-[140px] grow rounded-control border border-transparent bg-transparent px-1.5 text-detail outline-none placeholder:text-muted focus:border-line"
          />
        )}
      </div>
      {others.length > 0 && mine.length < MAX_TAGS && (
        <div className="flex flex-wrap items-center gap-1.5 text-label text-muted">
          <span>Your tags:</span>
          {others.map((t) => (
            <button key={t} type="button" onClick={() => add(t)} className="rounded-full border border-dashed border-line px-2 py-0.5 hover:border-line-strong hover:text-ink">
              + {t}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        maxLength={MAX_NOTE}
        rows={text ? Math.min(8, Math.max(2, text.split('\n').length + 1)) : 2}
        placeholder="A note for later: what it was for, what's left to do"
        aria-label="Note"
        onFocus={() => (typing.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => flush(v), 600);
        }}
        onBlur={() => {
          typing.current = false;
          flush();
        }}
        className="w-full resize-y rounded-row border border-line bg-card px-3 py-2 text-body outline-none placeholder:text-muted focus:border-line-strong"
      />
    </Section>
  );
}

function Stats({ live, d, proc }: { live: Live | null; d: Detail | null; proc: Proc | null }) {
  const cost = d ? d.cost : live?.cost;
  const tokens = d ? d.tokens.total : live?.tokens?.total;
  const lines = d ? d.lines : live?.lines;
  const cell = (label: string, value: ReactNode, sub?: ReactNode, tip?: string) => (
    <div className="flex min-w-0 flex-col gap-0.5" data-tip={tip}>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="figure text-title">{value}</dd>
      {sub && <small className="truncate text-label text-muted">{sub}</small>}
    </div>
  );
  const c = live?.context || d?.context;
  const pct = c?.window ? c.pct ?? Math.round((c.used / c.window) * 100) : null;
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3.5 max-[460px]:grid-cols-2">
        {cell('Cost', cost == null ? '—' : costText(cost, d?.partial), d?.subCost && d.subCost > 0.005 ? `${money(d.subCost)} subagents` : undefined, d ? `At API list prices${d.subCost > 0.005 ? `, including ${money(d.subCost)} on subagents` : ''}. Prompt caching saved ≈ ${money(d.saved)}.` : 'At API list prices')}
        {cell('Tokens', tokens == null ? '—' : compact(tokens), undefined, d ? `${compact(d.tokens.fresh)} fresh input · ${compact(d.tokens.output)} output · ${compact(d.tokens.cacheRead)} cache reads · ${compact(d.tokens.cacheWrite)} cache writes` : undefined)}
        {cell('Your messages', d ? d.messages.count : live?.turns ?? '—', d && (d.messages.interrupts || d.waitMs) ? [d.messages.interrupts && `${d.messages.interrupts} interrupted`, d.waitMs && `waited ${duration(d.waitMs)} for you`].filter(Boolean).join(' · ') : undefined)}
        {cell('Agent time', d?.agentMs ? duration(d.agentMs) : '—', d?.agentMs && d.messages.count > 1 ? `about ${duration(d.agentMs / d.messages.count)} a message` : undefined, 'How long the agent worked on your messages, from each one to its last reply, added up')}
        {cell('Lines changed', lines ? <><span className="text-ok">+{compact(lines.added)}</span> <span className="text-bad">−{compact(lines.removed)}</span></> : '—')}
        {cell('Tool calls', d ? compact(d.tools.calls) : '—', d?.tools.failed ? `${d.tools.failed} failed` : undefined)}
      </dl>
      {pct != null && c && (
        <div className="flex items-center gap-3 text-detail" data-tip={`${compact(c.used)} of ${compact(c.window)} tokens in the conversation ${live?.context ? 'now' : `as of its last reply`}. Compaction behavior depends on the provider and model.`}>
          <span className="text-muted">Context</span>
          <span className="h-1.5 grow overflow-hidden rounded-full bg-sunken">
            <span className={cx('block h-full rounded-full', pct >= 90 ? 'bg-bad-fill' : pct >= 70 ? 'bg-warn-fill' : 'bg-ink/50')} style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
          <b className={cx('tnum', pct >= 90 ? 'text-bad' : pct >= 70 ? 'text-warn' : '')}>{pct}%</b>
        </div>
      )}
      {proc && (
        <p className="text-detail text-muted">
          {proc.runtimeShared ? 'This chat uses the shared Codex runtime. Per-chat memory and CPU are unavailable.' : `Using ${Math.round((proc.memBytes + proc.toolsMemBytes) / 1024 ** 2)} MB of memory with its ${plural(proc.tools, 'MCP server or tool', 'MCP servers and tools')}${proc.cpuPct != null ? `, ${proc.cpuPct < 10 ? proc.cpuPct.toFixed(1) : Math.round(proc.cpuPct)}% CPU` : ''}.`}
        </p>
      )}
    </div>
  );
}

function CostOverTime({ d }: { d: Detail }) {
  const tl = d.timeline;
  if (!tl || tl.costs.length < 2 || !tl.costs.some((c) => c > 0)) return null;
  const label = (t: number) => (tl.step >= 86_400_000 ? dayLabel(t) : tl.step >= 3_600_000 ? `${dayLabel(t)} ${clock(t)}` : clock(t));
  const stepText = tl.step >= 86_400_000 ? 'day' : tl.step >= 3_600_000 ? 'hour' : '10 minutes';
  const max = Math.max(...tl.costs);
  const last = tl.from + (tl.costs.length - 1) * tl.step;
  return (
    <Section title="Cost over time" sub={`per ${stepText}`}>
      <div className="flex h-20 items-end gap-[2px]" role="img" aria-label={`Cost per ${stepText}`}>
        {tl.costs.map((c, i) => (
          <span key={i} data-tip={`${label(tl.from + i * tl.step)} · ≈ ${money(c)}`} className="flex h-full min-w-[2px] grow flex-col justify-end">
            <span className={cx('block rounded-t-[2px]', sourceInfo(d.source).bg, c <= 0 && 'opacity-0')} style={{ height: `${Math.max(c > 0 ? 3 : 0, (c / max) * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className="flex justify-between text-label text-muted">
        <span>{label(tl.from)}</span>
        <span>{label(last)}</span>
      </div>
    </Section>
  );
}

function Messages({ d, current, onOpen }: { d: Detail; current: number | null; onOpen: (t: number) => void }) {
  const list = d.messages.list;
  if (!list.length) return null;
  return (
    <Section title="Your messages" sub="what each one cost, subagents included · click one for what it led to">
      <ul className="-mx-2 flex flex-col">
        {list.map((m) => (
          <li
            key={m.t}
            role="button"
            tabIndex={0}
            aria-current={current === m.t || undefined}
            onClick={() => onOpen(m.t)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(m.t))}
            data-tip={`${m.text || ''}\n${whenText(m.t)} · ≈ ${money(m.cost)} · kept the agent busy ${duration(m.ms)}\nClick for what it led to`}
            className={cx('grid cursor-pointer grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-sm px-2 py-1.5 text-detail hover:bg-sunken', current === m.t && 'bg-sunken')}
          >
            <time className="whitespace-nowrap text-muted tnum">{whenText(m.t)}</time>
            <span className="truncate">“{clip(m.text || 'Untitled', 90)}”</span>
            <span className="text-right tnum">
              {moneyCol(m.cost)}
              {m.partial ? '+' : ''} <small className="ml-1 text-muted">{duration(m.ms)}</small>
            </span>
          </li>
        ))}
      </ul>
      {d.messages.count > list.length && <p className="text-detail text-muted">The latest {list.length} of {d.messages.count}.</p>}
    </Section>
  );
}

function Files({ live }: { live: Live | null }) {
  const files = live?.files || [];
  if (!files.length) return null;
  return (
    <Section title="Files it changed" sub="most recent first">
      <ul className="flex flex-col gap-1 text-detail">
        {files.map((f) => (
          <li key={f.path} data-tip={f.path} className="flex items-center gap-2">
            <span className="grow truncate font-mono text-[12px]">{f.name}</span>
            <span className="tnum"><span className="text-ok">+{compact(f.added)}</span> <span className="text-bad">−{compact(f.removed)}</span></span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Subagents({ id, d, all }: { id: string; d: Detail | null; all: Live[] }) {
  const liveSubs = all.filter((a) => a.parentId === id);
  const list = d?.subagents?.list || [];
  if (!list.length && !liveSubs.length) return null;
  const count = d?.subagents?.count || liveSubs.length;
  return (
    <Section title="Subagents" sub={`${plural(count, 'subagent')}${list.length < (d?.subagents?.count || 0) ? `, the ${list.length} priciest` : ''}`}>
      <ul className="flex flex-col gap-1 text-detail">
        {liveSubs.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-ok-fill" aria-hidden />
            <span className="grow truncate">{clip(a.title, 70)}</span>
            <b className="font-medium text-ok">{lower(doingText(a))}</b>
          </li>
        ))}
        {list.map((x, i) => (
          <li key={i} className="flex items-center gap-2" data-tip={`${x.title}\n${x.firstAt ? whenText(x.firstAt) : ''} · ${plural(x.calls, 'tool call')}`}>
            <span className="size-1.5 shrink-0 rounded-full bg-faint" aria-hidden />
            <span className="grow truncate">{clip(x.title, 70)}</span>
            <b className="font-medium tnum">
              {moneyCol(x.cost)}
              {x.partial ? '+' : ''}
            </b>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ModelsAndTools({ d }: { d: Detail }) {
  const models = d.models.filter((m) => m.cost > 0.005);
  const toolLine = `${plural(d.tools.calls, 'tool call')}${d.tools.failed ? ` · ${d.tools.failed} failed` : ''}${d.tools.denied ? ` · ${d.tools.denied} denied by you` : ''}${d.compactions ? ` · compacted ${d.compactions === 1 ? 'once' : `${d.compactions} times`}` : ''}`;
  return (
    <>
      {models.length > 0 && (
        <Section title="Models">
          <ul className="flex flex-col gap-1.5 text-detail">
            {models.map((m) => {
              const pct = d.cost > 0 ? Math.round((m.cost / d.cost) * 100) : 0;
              return (
                <li key={m.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_36px] items-center gap-2.5">
                  <span className="truncate">{m.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-ink/60" style={{ width: `${Math.max(pct ? 2 : 0, pct)}%` }} /></span>
                  <span className="tnum">{money(m.cost)}</span>
                  <span className="text-right text-muted tnum">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {d.tools.calls > 0 && (
        <Section title="Tools" sub={toolLine}>
          <div className="flex flex-wrap gap-1.5">
            {d.tools.top.map(([name, n]) => (
              <span key={name} className="rounded-full border border-line px-2 py-0.5 text-label">{name} <b>{n}</b></span>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function Actions({ id, live, d, proc }: { id: string; live: Live | null; d: Detail | null; proc: Proc | null }) {
  // The folder it was started in, where Claude Code can find it to resume (the history knows it best).
  const cwd = d?.cwd || live?.cwd || null;
  const source = live?.source || d?.source || proc?.source || 'claude';
  const nativeId = live?.nativeId || d?.nativeId || id.replace(/^(?:codex|pi)-/, '');
  // pi lets you name a session's id yourself; the others are always uuids.
  const resumable = source === 'pi' ? /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/ : /^[0-9a-f-]{36}$/;
  const resume = resumable.test(nativeId) ? `${cwd ? `cd ${shellQuote(cwd)} && ` : ''}${sourceInfo(source).resume} ${nativeId}` : null;
  const r = d?.resume;
  const appName = source === 'codex' ? 'Codex' : 'Claude';
  const resumeInTerminal = async () => {
    try {
      await post(`/api/resume?id=${encodeURIComponent(id)}`);
      note('Opened in a new Terminal window');
    } catch (e) {
      note((e as Error).message.includes('422') ? "Couldn't open Terminal" : "Couldn't reach Overtime's server", { level: 'warn' });
    }
  };
  const items = [
    r?.terminal && (
      <Button key="terminal" size="sm" variant="primary" icon={<Play size={13} strokeWidth={2.2} aria-hidden />} data-tip={`Opens a new Terminal window in its folder and runs ${sourceInfo(source).resume}`} onClick={resumeInTerminal}>
        Resume in Terminal
      </Button>
    ),
    r?.app ? (
      <a key="app" href={r.app.url} data-tip={`Opens this session in the ${r.app.name} app`} className="inline-flex h-7 items-center gap-1.5 rounded-control border border-line bg-card px-2.5 text-detail font-medium text-ink no-underline hover:bg-sunken">
        <ExternalLink size={13} strokeWidth={2} aria-hidden />
        Open in the {r.app.name} app
      </a>
    ) : r?.appMissing ? (
      <span key="app" aria-disabled="true" data-tip={`This session was ${r.appMissing}, so the ${appName} app can't open it. Resume it in Terminal instead.`} className="inline-flex h-7 items-center gap-1.5 rounded-control border border-line px-2.5 text-detail font-medium text-muted opacity-60">
        <ExternalLink size={13} strokeWidth={2} aria-hidden />
        Open in the {appName} app
      </span>
    ) : null,
    resume && <CopyButton key="resume" text={resume} label="Copy resume command" />,
    cwd && (
      <a key="vscode" href={`vscode://file/${encodeURI(cwd)}`} className="inline-flex h-7 items-center gap-1.5 rounded-control border border-line bg-card px-2.5 text-detail font-medium text-ink no-underline hover:bg-sunken">
        <Folder size={13} strokeWidth={2} aria-hidden />
        Open folder in VS Code
      </a>
    ),
    cwd && <CopyButton key="path" text={cwd} label="Copy folder path" />,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <Section title="Pick it back up">
      <div className="flex flex-wrap gap-2">{items}</div>
      {resume && <p className="break-all font-mono text-[12px] text-muted">{resume}</p>}
    </Section>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

function Head({ id, own, meta, docked, roomy }: { id: string; own: string; meta: ReactNode; docked: boolean; roomy: boolean }) {
  useChanged();
  const [renaming, setRenaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const closeSession = useUi((s) => s.closeSession);
  const setDocked = useUi((s) => s.setDocked);
  const title = titleFor(id, own);
  const pinned = isPinned(id);
  useEffect(() => setRenaming(false), [id]);
  useEffect(() => {
    if (renaming) {
      field.current?.focus();
      field.current?.select();
    }
  }, [renaming]);
  const finish = (keep: boolean) => {
    if (!renaming) return;
    setRenaming(false);
    const value = (field.current?.value || '').trim();
    // Saving its own title, or nothing, keeps the session's own.
    const before = customName(id);
    const next = value && value !== tidyTitle(own) ? value : '';
    if (keep && next !== before) {
      rename(id, next);
      offerUndo(next ? `Renamed to “${clip(next, 40)}”` : 'Back to its own title', () => rename(id, before));
    }
  };
  return (
    <header className="flex items-start gap-3 px-5 pb-3 pt-4">
      <div className="flex min-w-0 grow flex-col gap-1">
        {renaming ? (
          <input
            ref={field}
            defaultValue={customName(id) || title}
            placeholder={own}
            maxLength={120}
            aria-label="Name for this session"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                finish(false);
              }
            }}
            onBlur={() => finish(true)}
            className="h-8 rounded-control border border-line-strong bg-card px-2 text-title font-semibold outline-none"
          />
        ) : (
          <h2 id="session-title" className="text-title font-semibold leading-snug" data-tip={customName(id) ? `Renamed. Originally: ${own}` : undefined}>
            {title}
          </h2>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-detail text-muted">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={pinned ? 'Unpin' : 'Pin'}
          tip={pinned ? 'Unpin: it goes back to its day on the Sessions page' : 'Pin to the top of the Sessions page'}
          variant="quiet"
          size="sm"
          aria-pressed={pinned}
          className={pinned ? 'text-ink' : ''}
          onClick={() => {
            togglePin(id);
            offerUndo(`${isPinned(id) ? 'Pinned' : 'Unpinned'} “${clip(titleFor(id, own), 40)}”`, () => togglePin(id));
          }}
        >
          <Pin size={15} strokeWidth={2} fill={pinned ? 'currentColor' : 'none'} aria-hidden />
        </IconButton>
        <IconButton label="Rename" tip="Rename this session, on this dashboard only" variant="quiet" size="sm" onMouseDown={(e) => renaming && e.preventDefault()} onClick={() => (renaming ? finish(true) : setRenaming(true))}>
          <Pencil size={15} strokeWidth={2} aria-hidden />
        </IconButton>
        <IconButton label="Compare with another session" tip="Compare with another session" variant="quiet" size="sm" onClick={() => useCompare.getState().show(id)}>
          <ArrowLeftRight size={15} strokeWidth={2} aria-hidden />
        </IconButton>
        {inPopover ? (
          <IconButton label="Open in the window" tip="Open this session in the dashboard window" variant="quiet" size="sm" onClick={() => openInWindow(`#session=${id}`)}>
            <ExternalLink size={15} strokeWidth={2} aria-hidden />
          </IconButton>
        ) : (
          <IconButton
            label={docked ? 'Float over the page' : 'Dock beside the page'}
            tip={docked ? 'Float it over the page again' : roomy ? 'Dock it beside the page, and keep it open while you look around' : 'Dock it beside the page, once the window is wider'}
            variant="quiet"
            size="sm"
            aria-pressed={docked}
            onClick={() => {
              setDocked(!docked);
              if (!docked && !roomy) note('Docked. There isn’t room beside the page in a window this narrow, so it floats until the window is wider', { level: 'info' });
            }}
          >
            {docked ? <PanelRightClose size={15} strokeWidth={2} aria-hidden /> : <PanelRightOpen size={15} strokeWidth={2} aria-hidden />}
          </IconButton>
        )}
        <IconButton label="Close" tip="Close (Esc)" variant="quiet" size="sm" onClick={closeSession} data-close>
          <X size={16} strokeWidth={2} aria-hidden />
        </IconButton>
      </div>
    </header>
  );
}

/** Whether the panel sits beside the page (docked, with room) rather than over it. */
export function usePanelDocked() {
  const docked = useUi((s) => s.docked);
  const roomy = useMedia('(min-width: 1100px)');
  const open = useUi((s) => !!s.session);
  return open && docked && roomy && !inPopover;
}

export function SessionPanel() {
  const session = useUi((s) => s.session);
  const docked = useUi((s) => s.docked);
  const width = useUi((s) => s.drawerWidth);
  const setWidth = useUi((s) => s.setDrawerWidth);
  const closeSession = useUi((s) => s.closeSession);
  const openSession = useUi((s) => s.openSession);
  const roomy = useMedia('(min-width: 1100px)');
  const beside = usePanelDocked();
  const id = session?.id || null;
  useNow();
  const now = serverNow();
  const allAgents = useLive((s) => s.snap?.agents) as unknown as Live[] | undefined;
  const open = useLive((s) => s.snap?.openSessions);
  const detail = useSessionDetail(id);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const terms = useMemo(() => queryTerms(session?.q || ''), [session?.q]);

  // A new session starts at its top, at the message it was opened at, if any.
  useEffect(() => {
    setFocusAt(session?.at ?? null);
    body.current?.scrollTo(0, 0);
    // Floating, the close button takes the focus; docked, the page keeps it.
    if (session && !beside) setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true }), 0);
  }, [session?.id, session?.at]);

  // Esc closes it, unless a dialog is open over it.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]:not([data-session-panel])') && !(e.target as HTMLElement)?.closest?.('input, textarea')) closeSession();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, closeSession]);

  // The open session's rows are marked on the page while it's docked, so you can see which it is.
  const marker = beside && id ? `[data-session="${CSS.escape(id)}"]{background:color-mix(in srgb,var(--accent) 7%,transparent);box-shadow:inset 3px 0 0 var(--accent)}` : '';

  const drag = useRef(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = true;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => drag.current && setWidth(window.innerWidth - e.clientX, false);
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setWidth(useUi.getState().drawerWidth);
  };

  if (!id) return null;
  const live = allAgents?.find((a) => a.id === id) || null;
  const proc = ((open?.sessions || []) as unknown as Proc[]).find((x) => x.id === id) || null;
  const d = (detail.data as Detail | undefined) || null;
  const own = live?.title || d?.title || proc?.title || 'Untitled session';
  const project = live?.project || d?.project || proc?.project;
  const started = d?.firstAt ? `Started ${whenText(d.firstAt)}` : live?.startedAt ? `Started ${whenText(live.startedAt)}` : '';
  const meta = [
    sourceInfo(live?.source || d?.source || proc?.source).name,
    project ? (
      <span key="p" className="inline-flex items-center gap-1">
        <ProjectDot name={project} />
        {projectName(project)}
      </span>
    ) : null,
    live?.branch || null,
    live?.model ? live.model.replace(/^claude-/, '') : null,
    live?.entrypoint && live.entrypoint !== live.source ? ENTRY[live.entrypoint] || live.entrypoint : null,
    started || null,
  ].filter(Boolean);
  const metaLine = meta.map((bit, i) => (
    <span key={i} className="inline-flex items-center gap-1.5">
      {bit}
      {i < meta.length - 1 && <span aria-hidden>·</span>}
    </span>
  ));
  const status = detail.isLoading ? null : demo ? 'The demo has no history, so only what the session is doing now shows here.' : detail.isError && (detail.error as { status?: number })?.status === 404 ? 'No history for this session in the last 31 days of transcripts.' : detail.isError ? "Couldn't reach Overtime's server for this session's history." : null;

  const content = (
    <aside
      ref={panel}
      data-session-panel=""
      role="dialog"
      aria-modal={!beside}
      aria-labelledby="session-title"
      className={cx(
        'z-[2000] flex flex-col border-line bg-card',
        beside ? 'sticky top-0 h-dvh shrink-0 border-l' : 'fixed inset-y-0 right-0 border-l shadow-raised max-w-full',
        inPopover && 'w-full',
      )}
      style={{ width: inPopover ? '100vw' : beside ? width : Math.min(width, window.innerWidth) }}
    >
      {!inPopover && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Panel width"
          tabIndex={0}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onDoubleClick={() => setWidth(DRAWER.usual)}
          onKeyDown={(e) => {
            const by = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
            if (by) {
              e.preventDefault();
              setWidth(width + by);
            }
          }}
          data-tip="Drag to resize · double-click for the usual width"
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize outline-none after:absolute after:left-[3px] after:top-0 after:h-full after:w-0.5 hover:after:bg-line-strong focus-visible:after:bg-accent"
        />
      )}
      <Head id={id} own={own} meta={metaLine} docked={docked} roomy={roomy} />
      <div ref={body} className="min-h-0 grow overflow-y-auto pb-6">
        <Status live={live} d={d} proc={proc} now={now} />
        {focusAt != null && <TurnView id={id} at={focusAt} terms={focusAt === session?.at ? terms : []} onClose={() => setFocusAt(null)} />}
        <Notes id={id} />
        <div className="border-t border-line">
          <Stats live={live} d={d} proc={proc} />
          {detail.isLoading && <div className="px-5 pb-3"><Skeleton lines={3} /></div>}
          {status && <p className="px-5 pb-3 text-detail text-muted">{status}</p>}
          {d?.partial && <p className="px-5 pb-3 text-detail text-muted">Some of its models have no known price, so costs marked + show what the rest cost.</p>}
        </div>
        {d && <CostOverTime d={d} />}
        {d && (
          <Messages
            d={d}
            current={focusAt}
            onOpen={(t) => {
              openSession(id, { at: t, q: '' });
              setFocusAt(t);
              body.current?.scrollTo(0, 0);
            }}
          />
        )}
        <Files live={live} />
        <Subagents id={id} d={d} all={allAgents || []} />
        {d && <ModelsAndTools d={d} />}
        <Actions id={id} live={live} d={d} proc={proc} />
      </div>
    </aside>
  );

  return (
    <>
      <style>{marker}</style>
      {!beside && <div className="fixed inset-0 z-[1999] bg-[var(--scrim)]" onClick={closeSession} aria-hidden />}
      {content}
    </>
  );
}
