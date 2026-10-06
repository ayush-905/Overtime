// A plan limit as a bar of what's left, like a battery: over 30% left is green,
// 10 to 30% amber, under 10% red. Empty when there's no reading.

import { cx } from './cx';

export type Tone = 'ok' | 'warn' | 'bad';

/** How a limit with this much left reads. */
export const toneFor = (left: number): Tone => (left < 10 ? 'bad' : left <= 30 ? 'warn' : 'ok');

export const toneWords: Record<Tone, string> = { ok: 'Plenty', warn: 'Getting low', bad: 'Almost out' };

const fills: Record<Tone, string> = { ok: 'bg-ok-fill', warn: 'bg-warn-fill', bad: 'bg-bad-fill' };

/** `projectedLeft`: what's left by the reset at your pace; the stretch it will use shows hatched. */
export function Meter({
  left,
  label,
  size = 'md',
  className,
  projectedLeft,
}: {
  left: number | null;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
  projectedLeft?: number | null;
}) {
  const value = left == null ? null : Math.max(0, Math.min(100, left));
  const keep = value == null || projectedLeft == null ? null : Math.max(0, Math.min(value, projectedLeft));
  const tone = value == null ? 'ok' : toneFor(keep ?? value);
  return (
    // biome-ignore lint/a11y/useSemanticElements: drawn by hand, with the stretch your pace will use hatched, which a <meter> can't show
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={
        value == null
          ? 'No reading'
          : `${Math.round(value)}% left${keep != null && keep < value ? `, about ${Math.round(keep)}% by the reset at your pace` : ''}`
      }
      className={cx('relative overflow-hidden rounded-full bg-sunken', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      {value != null && keep != null && keep < value && (
        <div
          className={cx('absolute inset-y-0 left-0 rounded-full opacity-45', fills[tone])}
          style={{
            width: `${value}%`,
            maskImage: 'repeating-linear-gradient(135deg, #000 0 3px, transparent 3px 6px)',
          }}
        />
      )}
      {value != null && (
        <div
          className={cx('relative h-full rounded-full', fills[toneFor(value)])}
          style={{ width: `${keep ?? value}%` }}
        />
      )}
    </div>
  );
}
