// Cards: the white boxes pages are made of, with a title, a line under it and
// tools at the end. The band is the one card at the top of a page that carries
// its main point, a little rounder.

import type { HTMLAttributes, ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cx } from './cx';

type CardProps = HTMLAttributes<HTMLElement> & { as?: 'section' | 'article' | 'div'; band?: boolean; flush?: boolean };

export function Card({ as: Tag = 'section', band, flush, className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        'min-w-0 border border-line bg-card shadow-card',
        band ? 'rounded-band' : 'rounded-card',
        !flush && 'px-[var(--card-px)] py-[var(--card-py)]',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A card's title, what it covers, and its tools. */
export function CardHead({
  title,
  sub,
  tools,
  level = 2,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    // The title gives way first (its line under it wraps), so the tools keep to its row until there's truly no room.
    <header className={cx('mb-3 flex flex-wrap items-start gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 flex-[1_1_10rem] flex-col gap-0.5">
        <H className="text-title font-semibold">{title}</H>
        {sub && <p className="text-detail text-muted">{sub}</p>}
      </div>
      {tools && <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{tools}</div>}
    </header>
  );
}

/** A small heading inside a card or band: "Today". */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('text-detail font-semibold text-muted', className)}>{children}</h2>;
}

/** The ⓘ in a card's tools: what the card counts, and how, in its tooltip. */
export function InfoTip({ note }: { note: string }) {
  // A button, so the keyboard reaches it and its tip shows on focus; a screen reader reads the note out.
  return (
    <button type="button" data-tip={note} className="grid place-items-center rounded-sm text-muted hover:text-ink">
      <Info size={15} strokeWidth={1.8} aria-hidden />
      <span className="sr-only">About this card: {note}</span>
    </button>
  );
}
