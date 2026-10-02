// Figures: a stat (a label over its value, in a row of them), and the big figure
// a card or band leads with. Figures are always tabular, so they line up.

import type { ReactNode } from 'react';
import { cx } from './cx';

export function Stat({ label, value, sub, tip, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tip?: string; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)} data-tip={tip}>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="figure text-stat whitespace-nowrap">
        {value}
        {sub && <small className="ml-1.5 text-label font-medium tracking-normal text-muted [.compact_&]:ml-0 [.compact_&]:block [.compact_&]:whitespace-normal">{sub}</small>}
      </dd>
    </div>
  );
}

/** A row of stats, as many columns as it has. */
export function StatRow({ children, columns, className }: { children: ReactNode; columns?: number; className?: string }) {
  return (
    <dl className={cx('grid gap-4', className)} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : { gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
      {children}
    </dl>
  );
}

/** The figure a card leads with: 99% left, ₹7,471. `size` hero (40) or figure (32). */
export function Figure({ value, unit, size = 'figure', tone, className }: { value: ReactNode; unit?: ReactNode; size?: 'hero' | 'figure'; tone?: 'warn' | 'ok' | 'bad'; className?: string }) {
  const color = tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : '';
  return (
    <div className={cx('flex flex-wrap items-baseline gap-x-2', className)}>
      <span className={cx('figure', size === 'hero' ? 'text-hero tracking-[-0.03em]' : 'text-figure', color)}>{value}</span>
      {unit && <span className="text-body text-muted">{unit}</span>}
    </div>
  );
}
