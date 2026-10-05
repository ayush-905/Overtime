// The small parts: status pills, a count chip (tags), the providers' marks, a
// project's dot, a status dot, the one insight a page gets, a one-line empty
// state, a key, a placeholder while data loads, a select, and text with the
// words searched for marked. (The switch is in Switch.tsx, as only Settings and
// its dialogs use it.)

import type { ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown, Lightbulb, Tag } from 'lucide-react';
import { sourceInfo, type Source } from '@/lib/sources';
import { projectColor } from '@/lib/format';
import { highlightParts } from '@/lib/search';
import { cx } from './cx';

export type PillTone = 'needs' | 'working' | 'idle' | 'bad';

const pillTones: Record<PillTone, string> = {
  needs: 'bg-warn-soft text-warn',
  working: 'bg-ok-soft text-ok',
  idle: 'bg-sunken text-muted',
  bad: 'bg-bad-soft text-bad',
};

export function Pill({
  tone,
  children,
  dot,
  className,
}: {
  tone: PillTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-label font-semibold whitespace-nowrap',
        pillTones[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cx(
            'size-1.5 shrink-0 rounded-full',
            tone === 'working' ? 'bg-ok-fill' : tone === 'needs' ? 'bg-warn-fill' : 'bg-faint',
          )}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/** A count of tags, with the tags in its tooltip, instead of chips cut short. */
export function TagCount({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span
      data-tip={tags.join(', ')}
      className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-label font-medium text-muted"
    >
      <Tag size={12} strokeWidth={2} aria-hidden />
      {tags.length === 1 ? tags[0] : `${tags.length} tags`}
    </span>
  );
}

/** Claude Code's burst, Codex's knot or Pi's π. */
export function ProviderMark({ source, size = 20, className }: { source: Source; size?: number; className?: string }) {
  const info = sourceInfo(source);
  return (
    <img
      src={info.mark}
      alt={info.name}
      width={size}
      height={size}
      className={cx('shrink-0', source !== 'claude' && 'rounded-[5px]', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** A provider's mark with how it's doing, as a dot on its corner. */
export function Avatar({
  source,
  status,
  size = 20,
}: {
  source: Source;
  status?: 'needs' | 'working' | 'idle' | null;
  size?: number;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <ProviderMark source={source} size={size} />
      {status && status !== 'idle' && (
        <span
          className={cx(
            'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card',
            status === 'needs' ? 'bg-warn-fill' : 'bg-ok-fill',
          )}
          aria-label={status === 'needs' ? 'Needs you' : 'Working'}
        />
      )}
    </span>
  );
}

export function ProjectDot({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      className={cx('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: projectColor(name) }}
      aria-hidden
    />
  );
}

/** Something happening now: a green dot with a soft ring. */
export function LiveDot({ tone = 'ok' }: { tone?: 'ok' | 'warn' }) {
  return (
    <span
      className={cx(
        'inline-block size-2 shrink-0 rounded-full',
        tone === 'ok'
          ? 'bg-ok-fill shadow-[0_0_0_3px_var(--ok-soft)]'
          : 'bg-warn-fill shadow-[0_0_0_3px_var(--warn-soft)]',
      )}
      aria-hidden
    />
  );
}

/** The one insight a page gets, where it matters. */
export function Insight({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('flex items-center gap-2 text-detail text-muted', className)}>
      <Lightbulb size={15} strokeWidth={1.8} className="shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** An empty state is one line. */
export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-detail text-muted', className)}>{children}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-card px-1.5 font-sans text-group font-semibold text-muted">
      {children}
    </kbd>
  );
}

/** A placeholder while data is on its way. */
export function Skeleton({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="h-3.5 animate-pulse rounded-sm bg-sunken"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('relative inline-flex min-w-0', className)}>
      <select
        className="h-8 w-full min-w-0 appearance-none truncate rounded-control border border-line bg-card pl-2.5 pr-8 text-detail text-ink hover:border-line-strong disabled:opacity-50"
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        strokeWidth={1.8}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden
      />
    </span>
  );
}

/** Text with the words searched for marked. Markdown's ** and ` read as noise here, so they go. */
export function Marked({ text, terms }: { text: string; terms: string[] }) {
  const clean = String(text || '').replace(/\*\*|__|`+/g, '');
  return (
    <>
      {highlightParts(clean, terms).map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-warn-soft px-0.5 text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
