// The Overview's lists: today's biggest sessions, where today went by project
// (split by provider), and the sessions open on this Mac with the memory and CPU
// they use. All by what you compare by (cost or tokens), except memory.

import { useInsight, useOpenSessions, useProvider, useToday } from '@/data/scope';
import { useChanged, useMinute } from '@/data/hooks';
import { demo } from '@/data/api';
import { bytesText, compact, costText, cpuText, duration, lower, money, plural, projectName } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { titleFor } from '@/lib/labels';
import { providerName } from '@/lib/limits';
import { byTokens, measureCol, measureOf, something, valueShort } from '@/lib/measure';
import { pageLink } from '@/lib/route';
import { Card, CardHead } from '@/components/Card';
import { TextLink } from '@/components/Button';
import { Empty, Insight, ProjectDot, ProviderMark, Skeleton } from '@/components/Bits';
import { Stat, StatRow } from '@/components/Stat';
import { SessionRow } from '@/components/SessionRow';
import { Ago } from '@/components/Clock';
import { cx } from '@/components/cx';
import { ExpandButton } from './Expand';
import { SOURCE, SOURCES, bySourceOf, type Source } from '@/lib/sources';

type Top = { id: string; source: Source; title: string; project: string | null; cost: number; partial: boolean; subCost: number; tokens: number; added: number; removed: number; context?: { used: number; window: number; pct: number } | null };

const linesText = (s: { added: number; removed: number }) => (s.added + s.removed ? `+${compact(s.added)} −${compact(s.removed)} lines` : 'no edits');

export function TopSessionsCard({ expanded = false }: { expanded?: boolean }) {
  useChanged();
  const list = useInsight<Top[]>('topSessions');
  const tokens = byTokens();
  const head = (
    <CardHead
      title="Top sessions today"
      sub={`By ${tokens ? 'tokens' : 'cost'}, subagents included`}
      tools={
        <>
          <TextLink href={pageLink('sessions', { range: 'today', sort: 'cost' })}>All sessions →</TextLink>
          {!expanded && <ExpandButton card="top-sessions" />}
        </>
      }
    />
  );
  if (!list) {
    return (
      <Card aria-label="Top sessions today">
        {head}
        <Skeleton lines={4} />
      </Card>
    );
  }
  const rows = list
    .filter((s) => something(measureOf(s)) || (!tokens && s.partial))
    .sort((a, b) => measureOf(b) - measureOf(a))
    .slice(0, expanded ? 12 : 5);
  return (
    <Card aria-label="Top sessions today" className="pb-2">
      {head}
      {rows.length ? (
        <div className="flex flex-col divide-y divide-line border-t border-line">
          {rows.map((s) => (
            <SessionRow
              key={s.id}
              id={s.id}
              source={s.source}
              title={s.title}
              project={s.project}
              meta={[linesText(s)]}
              context={s.context}
              end={measureCol(s)}
              endSub={!tokens && s.subCost > 0.005 ? `${money(s.subCost)} subagents` : undefined}
              endTip={!tokens && s.partial ? 'Some models it used have no known price, so this is what the rest cost' : undefined}
              tip={tokens ? `${titleFor(s.id, s.title)}\n${compact(s.tokens)} tokens today · ≈ ${costText(s.cost, s.partial)}\nClick for details` : `${titleFor(s.id, s.title)}\n≈ ${money(s.cost)} today${s.subCost > 0.005 ? `, ${money(s.subCost)} of it on subagents` : ''} · ${compact(s.tokens)} tokens\nClick for details`}
            />
          ))}
        </div>
      ) : (
        <Empty>{tokens ? 'No session has used any tokens yet today.' : 'No session has cost anything yet today.'}</Empty>
      )}
    </Card>
  );
}

type Today = { id: string; source: Source; project: string | null; cost: number; tokens?: number; partial?: boolean };

export function WhereTodayCard() {
  useChanged();
  const provider = useProvider();
  const list = (useToday()?.sessionList || null) as Today[] | null;
  const tokens = byTokens();
  const head = <CardHead title="Where today went" sub={`By project${provider === 'all' ? ', split by provider' : ''}`} />;
  if (!list) {
    return (
      <Card aria-label="Where today went">
        {head}
        <Skeleton lines={3} />
      </Card>
    );
  }
  const byProject = new Map<string, Record<Source, number>>();
  const bySource = bySourceOf(() => 0);
  for (const s of list) {
    const v = measureOf({ cost: s.cost, tokens: s.tokens ?? 0 });
    const p = s.project || 'Unknown';
    const row = byProject.get(p) || bySourceOf(() => 0);
    row[s.source] += v;
    bySource[s.source] += v;
    byProject.set(p, row);
  }
  const all = SOURCES.reduce((n, s) => n + bySource[s], 0);
  const rows = [...byProject].map(([name, v]) => ({ name, by: v, total: SOURCES.reduce((n, s) => n + v[s], 0) })).filter((r) => something(r.total)).sort((a, b) => b.total - a.total);
  // The providers that used anything today, each with its share.
  const used = SOURCES.filter((s) => something(bySource[s]));
  const shown = rows.slice(0, 5);
  const rest = rows.slice(5);
  if (!shown.length) {
    return (
      <Card aria-label="Where today went">
        {head}
        <Empty>{tokens ? 'No tokens used yet today.' : 'Nothing has cost anything yet today.'}</Empty>
      </Card>
    );
  }
  return (
    <Card aria-label="Where today went" className="flex flex-col gap-3.5">
      <CardHead className="mb-0" title="Where today went" sub={`By project${provider === 'all' ? ', split by provider' : ''}`} />
      {shown.map((r) => (
        <a key={r.name} href={pageLink('projects', { p: r.name, range: 'today' })} className="flex flex-col gap-1.5 text-ink no-underline" data-tip={`${projectName(r.name)}: ${tokens ? `${compact(r.total)} tokens` : `≈ ${money(r.total)}`}${SOURCES.filter((s) => r.by[s] > 0).length > 1 ? ` (${SOURCES.filter((s) => r.by[s] > 0).map((s) => `${SOURCE[s].name} ${valueShort(r.by[s])}`).join(', ')})` : ''}\nClick for the project`}>
          <span className="flex items-center gap-2">
            <ProjectDot name={r.name} />
            <span className="grow truncate font-medium">{projectName(r.name)}</span>
            <span className="font-semibold tnum">{valueShort(r.total)}</span>
            <span className="w-9 text-right text-detail text-muted tnum">{Math.round((r.total / all) * 100)}%</span>
          </span>
          <span className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
            {SOURCES.map((s) => r.by[s] > 0 && <span key={s} className={SOURCE[s].bg} style={{ width: `${(r.by[s] / all) * 100}%` }} />)}
          </span>
        </a>
      ))}
      {rest.length > 0 && <p className="text-detail text-muted">and {plural(rest.length, 'other project')}, {valueShort(rest.reduce((n, r) => n + r.total, 0))}</p>}
      {provider === 'all' && used.length > 1 && (
        <>
          <div className="h-px bg-line" />
          <div className={cx('grid gap-4', used.length > 2 ? 'grid-cols-3' : 'grid-cols-2')}>
            {used.map((p) => (
              <div key={p} className="flex items-center gap-2.5">
                <ProviderMark source={p} size={20} />
                <span className="flex flex-col">
                  <span className="text-label text-muted">{providerName(p)}</span>
                  <span className="text-title font-bold tnum">
                    {valueShort(bySource[p])} <span className="text-label font-medium text-muted">{Math.round((bySource[p] / all) * 100)}%</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

type Open = { id?: string; source: Source; title?: string; status: 'needs' | 'working' | 'idle' | 'new'; project?: string; lastActive?: number; openedAt: number; memBytes: number; toolsMemBytes: number; tools: number; cpuPct?: number | null; runtimeShared?: boolean };

const IDLE_LONG_MS = 60 * 60_000; // an open session with nothing for this long counts as idle
const STATUS: Record<Open['status'], string> = { needs: 'Needs you', working: 'Working', idle: 'Idle', new: 'No messages yet' };

export function OpenSessionsCard({ expanded = false }: { expanded?: boolean }) {
  // "Open for", and which have been idle an hour, by the minute; "active 5s ago" counts on its own.
  useMinute();
  const o = useOpenSessions() as { everyMs?: number; sessions: Open[]; sharedRuntimes?: Open[] } | null;
  const now = serverNow();
  const note = `Claude Code, Codex and Pi sessions running on this Mac right now, each with the MCP servers and tools it started. Memory includes those; CPU is the share of one core. Updated every ${Math.round((o?.everyMs || 10_000) / 1000)} seconds while this page is open.`;
  const list = o?.sessions || [];
  const runtimes = o?.sharedRuntimes || [];
  const total = [...list, ...runtimes].reduce((n, x) => n + (x.memBytes || 0) + (x.toolsMemBytes || 0), 0);
  const head = <CardHead title="Open agent sessions" sub={o ? `${list.length} open · ${bytesText(total)} of memory` : 'On this Mac'} tools={<span data-tip={note} className="text-label text-muted">About</span>} />;
  if (!o) {
    return (
      <Card aria-label="Open agent sessions">
        {head}
        <Empty>{demo ? 'Not measured in the demo.' : 'Looking for running sessions…'}</Empty>
      </Card>
    );
  }
  const idle = list.filter((x) => x.status === 'idle' && now - (x.lastActive || x.openedAt) >= IDLE_LONG_MS);
  const idleBytes = idle.reduce((n, x) => n + x.memBytes + x.toolsMemBytes, 0);
  const cpu = [...list, ...runtimes].reduce((n, x) => n + (x.cpuPct || 0), 0);
  const runtimeNote = runtimes.length ? `The Codex app uses ${bytesText(runtimes.reduce((n, x) => n + x.memBytes + x.toolsMemBytes, 0))} for all its chats together, so they have no memory or CPU of their own here.` : '';
  return (
    <Card aria-label="Open agent sessions" className="flex flex-col gap-3">
      <CardHead className="mb-0" title="Open agent sessions" sub={`${list.length} open · ${bytesText(total)} of memory`} tools={<>{!expanded && <ExpandButton card="open-sessions" />}</>} />
      <StatRow columns={3}>
        <Stat label="Open" value={list.length} />
        <Stat label="Memory" value={bytesText(total)} tip="Sessions plus the MCP servers and tools they started" />
        <Stat label="CPU" value={cpuText(cpu)} tip="All of them together, as a share of one core" />
      </StatRow>
      {list.length ? (
        <div className={cx('flex flex-col divide-y divide-line border-t border-line', !expanded && 'max-h-[320px] overflow-y-auto')}>
          {list.map((x, i) => {
            const last = x.status === 'new' ? <>opened <Ago t={x.openedAt} /> ago</> : x.lastActive ? <>active <Ago t={x.lastActive} /> ago</> : '';
            const title = x.title || (x.status === 'new' ? 'New session' : '');
            const tip = [
              x.id ? titleFor(x.id, title) : title || 'Untitled session',
              `${providerName(x.source)} · ${lower(STATUS[x.status])}${x.openedAt ? ` · open for ${duration(now - x.openedAt)}` : ''}`,
              x.runtimeShared ? 'Runs in the Codex app, which all its chats share, so it has no memory or CPU of its own' : `${bytesText(x.memBytes)} for the session, ${bytesText(x.toolsMemBytes)} for ${plural(x.tools, 'MCP server or tool', 'MCP servers and tools')}`,
              x.cpuPct != null ? `${cpuText(x.cpuPct)} CPU of a core` : '',
              x.id ? 'Click for details' : '',
            ].filter(Boolean).join('\n');
            return <SessionRow key={x.id || i} id={x.id || null} source={x.source} title={title} now={STATUS[x.status]} project={x.project} meta={[last]} end={x.runtimeShared ? 'Shared' : bytesText(x.memBytes + x.toolsMemBytes)} endSub={x.runtimeShared ? 'with the Codex app' : x.cpuPct != null ? `${cpuText(x.cpuPct)} CPU` : undefined} tip={tip} />;
          })}
        </div>
      ) : (
        <Empty>No individual sessions identified.</Empty>
      )}
      {runtimeNote && <p className="text-detail text-muted">{runtimeNote}</p>}
      {idle.length >= 2 && <Insight>{`${plural(idle.length, 'session')} have been idle for over an hour and hold ${bytesText(idleBytes)}. Closing the ones you're done with gives that back.`}</Insight>}
    </Card>
  );
}
