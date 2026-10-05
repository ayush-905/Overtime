// One look for a session wherever it's listed, calmer than before: the provider's
// mark with what it's doing on its corner, its title (with a pin, a note mark and
// a count of its tags), one line of detail with what it's doing first, and the
// figure that matters in that list on the right. How full its conversation is
// shows only once it's getting full. A row opens the session's panel.

import { Fragment, type ReactNode } from 'react';
import { Pin, StickyNote } from 'lucide-react';
import { useLive } from '@/data/live';
import { useChanged } from '@/data/hooks';
import { isPinned, noteFor, tagsFor, titleFor } from '@/lib/labels';
import { liveStateOf } from '@/lib/agents';
import { compact, projectName } from '@/lib/format';
import { useUi } from '@/app/ui';
import { Avatar, ProjectDot, TagCount } from './Bits';
import { cx } from './cx';
import type { Source } from '@/lib/sources';

type Context = { used: number; window: number; pct?: number } | null | undefined;

/** How full a conversation is, once that's worth saying (70% or more). */
export function ContextMark({ context, live }: { context: Context; live?: boolean }) {
  if (!context?.window) return null;
  const pct = context.pct ?? Math.min(100, Math.round((context.used / context.window) * 100));
  if (pct < 70) return null;
  return (
    <span
      data-tip={`Context ${pct}% full: ${compact(context.used)} of ${compact(context.window)} tokens${live ? ', now' : ', as of its last reply'}. Close to full, it gets compacted, or starts forgetting the start of the conversation.`}
      className={cx(
        'shrink-0 rounded-sm px-1.5 text-label font-semibold',
        pct >= 90 ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn',
      )}
    >
      {pct}% full
    </span>
  );
}

export type SessionRowProps = {
  id: string | null;
  source: Source;
  title: string | null | undefined;
  /** What it's doing now, shown first in its state's colour. */
  now?: string;
  project?: string | null;
  meta?: ReactNode[];
  end?: ReactNode;
  endSub?: ReactNode;
  endTip?: string;
  tip?: string;
  context?: Context;
  /** One of its messages to open it at, and the words searched for. */
  at?: number | null;
  q?: string;
  /** Cells between the title and the figure, for a list with columns (hidden where the list is narrow). */
  cols?: ReactNode;
  /** The columns' figures as a line of their own, for where the list is too narrow for them. */
  folded?: ReactNode;
  /** A line from its conversation, like a search's match. */
  quote?: ReactNode;
  endClassName?: string;
  className?: string;
};

export function SessionRow({
  id,
  source,
  title,
  now,
  project,
  meta = [],
  end,
  endSub,
  endTip,
  tip,
  context,
  at = null,
  q = '',
  cols,
  folded,
  quote,
  endClassName,
  className,
}: SessionRowProps) {
  useChanged();
  const live = useLive((s) => (id ? s.snap?.agents.find((a) => a.id === id) : undefined));
  const openSession = useUi((s) => s.openSession);
  const status = live ? liveStateOf(live) : null;
  const tags = tagsFor(id);
  const note = noteFor(id);
  const line = [
    now ? (
      <span
        key="now"
        className={cx(
          'font-medium',
          status === 'needs' ? 'text-warn' : status === 'working' ? 'text-ok' : 'text-muted',
        )}
      >
        {now}
      </span>
    ) : null,
    project ? (
      <span key="project">
        <ProjectDot name={project} className="mr-1.5 align-middle" />
        {projectName(project)}
      </span>
    ) : null,
    ...meta.filter(Boolean),
  ].filter(Boolean);
  const open = () => id && openSession(id, { at, q });
  return (
    <div
      role={id ? 'button' : undefined}
      tabIndex={id ? 0 : undefined}
      data-row={id ? '' : undefined}
      data-session={id || undefined}
      data-tip={tip}
      onClick={open}
      onKeyDown={(e) => {
        if (id && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
      className={cx(
        'flex min-w-0 items-center gap-3 py-[var(--row-py)] outline-offset-[-2px]',
        id && 'cursor-pointer',
        className,
      )}
    >
      <Avatar source={source} status={status} size={20} />
      <span className="flex min-w-0 grow flex-col">
        <span className="flex min-w-0 items-center gap-2">
          {id && isPinned(id) && <Pin size={13} strokeWidth={2} className="shrink-0 text-muted" aria-label="Pinned" />}
          <span className="truncate font-semibold">{id ? titleFor(id, title) : title || 'Untitled session'}</span>
          {note && (
            <span data-tip={`Your note\n${note}`} className="shrink-0 text-muted">
              <StickyNote size={13} strokeWidth={2} aria-label="Has a note" />
            </span>
          )}
          <TagCount tags={tags} />
          <ContextMark context={live?.context || context} live={!!live?.context} />
        </span>
        {line.length > 0 && (
          // Plain text, so a long line ends in one "…"; what it's doing takes at most 60% of it.
          <span className="block truncate text-detail text-muted">
            {line.map((bit, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span aria-hidden className="mx-1.5">
                    ·
                  </span>
                )}
                {i === 0 && now ? <span className="inline-block max-w-[60%] truncate align-bottom">{bit}</span> : bit}
              </Fragment>
            ))}
          </span>
        )}
        {folded && <span className="block truncate text-detail text-muted">{folded}</span>}
        {quote && <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-detail">{quote}</span>}
      </span>
      {cols}
      {(end || endSub) && (
        <span className={cx('flex shrink-0 flex-col items-end', endClassName)} data-tip={endTip}>
          {end && <b className="tnum font-semibold">{end}</b>}
          {endSub && <small className="text-label text-muted">{endSub}</small>}
        </span>
      )}
    </div>
  );
}
