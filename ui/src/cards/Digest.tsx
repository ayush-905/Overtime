// Your week in review: this week so far, or last week, against the same days of
// the week before. What it cost, sessions, your time and your agents', how long
// they waited for you, the projects and sessions that took the most, and the few
// things worth knowing. Copies as text for a note or a message.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Lightbulb } from 'lucide-react';
import { useDigest } from '@/data/queries';
import { compact, costCol, costText, dayLabel, duration, money, plural, projectName } from '@/lib/format';
import { change, digestNotes, digestText, markDigestSeen, pct, span, type Digest } from '@/lib/digest';
import { pageLink } from '@/lib/route';
import { Dialog } from '@/components/Dialog';
import { Seg } from '@/components/Seg';
import { Button } from '@/components/Button';
import { Empty, ProjectDot, Skeleton } from '@/components/Bits';
import { SessionRow } from '@/components/SessionRow';
import { useUi } from '@/app/ui';

const DAY = 86_400_000;

function Stat({ label, value, sub, tip }: { label: string; value: ReactNode; sub?: string; tip?: string }) {
  return (
    <div className="flex flex-col gap-0.5" data-tip={tip}>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="figure text-stat">{value}</dd>
      {sub && <small className="text-label text-muted">{sub}</small>}
    </div>
  );
}

function Body({ d, last }: { d: Digest; last: boolean }) {
  const b = d.before;
  const notes = digestNotes(d);
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Stat
          label="Cost"
          value={costText(d.cost, d.partial)}
          sub={change(d.cost, b.cost)}
          tip="At API list prices, including subagents"
        />
        <Stat label="Sessions" value={d.sessions} sub={`${plural(d.messages, 'message')} from you`} />
        <Stat
          label="Your active time"
          value={duration(d.activeMs)}
          sub={change(d.activeMs, b.activeMs)}
          tip="From each message you sent until the agent's last reply, with breaks under 30 minutes bridged"
        />
        <Stat
          label="Agent time"
          value={duration(d.agentMs)}
          sub={change(d.agentMs, b.agentMs)}
          tip="How long the agents worked on your messages"
        />
        <Stat
          label="Waited for you"
          value={duration(d.waitMs)}
          sub={change(d.waitMs, b.waitMs)}
          tip="From an agent's last reply to your next message, leaving out breaks over 30 minutes"
        />
        <Stat
          label="Lines changed"
          value={
            <>
              <span className="text-ok">+{compact(d.added)}</span>{' '}
              <span className="text-bad">−{compact(d.removed)}</span>
            </>
          }
          sub={`${compact(d.tools)} tool call${d.tools === 1 ? '' : 's'}`}
        />
      </dl>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <li key={n} className="flex gap-2 text-detail">
              <Lightbulb size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <h3 className="text-detail font-semibold text-muted">Projects</h3>
          {d.projects.slice(0, 5).map((p) => {
            const share = pct(p.cost, d.cost);
            return (
              <a
                key={p.name}
                href={pageLink('projects', { p: p.name, range: '7' })}
                className="flex flex-col gap-1 text-ink no-underline"
              >
                <span className="flex items-center gap-2">
                  <ProjectDot name={p.name} />
                  <span className="grow truncate font-medium">{projectName(p.name)}</span>
                  <span className="font-semibold tnum">{money(p.cost)}</span>
                  <span className="w-9 text-right text-detail text-muted tnum">{share}%</span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-ink/70"
                    style={{ width: `${Math.max(share > 0 ? 1.5 : 0, share)}%` }}
                  />
                </span>
              </a>
            );
          })}
        </div>
        <div className="flex flex-col">
          <h3 className="mb-1 text-detail font-semibold text-muted">Priciest sessions</h3>
          <div className="flex flex-col divide-y divide-line">
            {d.topSessions.map((s) => (
              <SessionRow
                key={s.id}
                id={s.id}
                source={s.source}
                title={s.title}
                project={s.project}
                meta={[plural(s.messages, 'message')]}
                end={costCol(s.cost)}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="text-detail text-muted">
        {last ? `${dayLabel(d.from)} to ${dayLabel(d.to - DAY)}` : 'Monday to today'}, against the same days of the week
        before. Costs at API list prices.
      </p>
    </div>
  );
}

export function DigestDialog() {
  const week = useUi((s) => s.digest);
  const setWeek = useUi((s) => s.setDigest);
  const session = useUi((s) => s.session);
  const w = week ?? 0;
  const q = useDigest(w, week != null);
  // The other week loads alongside, so switching is instant.
  useDigest(1 - w, week != null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (week === 1) markDigestSeen();
  }, [week]);
  // Opening a session or following a link from it gets it out of the way (not one already open when it opened).
  const before = useRef(session);
  useEffect(() => {
    if (session && session !== before.current) setWeek(null);
  }, [session, setWeek]);
  useEffect(() => {
    const close = () => setWeek(null);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [setWeek]);
  const d = q.data as Digest | undefined;
  const title = d ? `${w ? 'Last week' : 'This week so far'} · ${span(d)}` : w ? 'Last week' : 'This week so far';
  return (
    <Dialog
      open={week != null}
      onOpenChange={(open) => !open && setWeek(null)}
      title="Your week in review"
      description={title}
      wide
      tools={
        <>
          <Seg
            label="Week"
            size="sm"
            value={String(w)}
            onChange={(v) => setWeek(Number(v) as 0 | 1)}
            options={[
              ['0', 'This week so far'],
              ['1', 'Last week'],
            ]}
          />
          {d && (
            <Button
              size="sm"
              icon={
                copied ? (
                  <Check size={14} strokeWidth={2} aria-hidden />
                ) : (
                  <Copy size={14} strokeWidth={2} aria-hidden />
                )
              }
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(digestText(d, !!w));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {}
              }}
            >
              {copied ? 'Copied' : 'Copy as text'}
            </Button>
          )}
        </>
      }
    >
      {q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <Empty>
          Couldn't get the digest from Overtime's server.{' '}
          <button type="button" className="font-semibold text-ink underline" onClick={() => q.refetch()}>
            Try again
          </button>
        </Empty>
      ) : !d?.sessions ? (
        <Empty>No sessions {w ? 'last week' : 'this week yet'}.</Empty>
      ) : (
        <Body d={d} last={!!w} />
      )}
    </Dialog>
  );
}
