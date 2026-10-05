// A plan window as a line: how full it got over time (an area), where it's
// heading at your recent pace (dashed), and the limit. Columns under it tell
// what each stretch cost. A screen reader hears it as one picture: where the
// window is now, and where it's heading.

import type { WindowChart as Model } from '@/lib/usage';
import { clock, money } from '@/lib/format';
import { cx } from './cx';

const H = 200; // the drawing's own units; it's stretched to fit

export function WindowChart({ c, height = 190 }: { c: Model; height?: number }) {
  const length = c.end - c.start;
  const top = c.pctMode ? 100 : Math.max(c.total, c.atReset, 0.01) * 1.15;
  const x = (t: number) => (((t - c.start) / length) * 1000).toFixed(1);
  const y = (v: number) => (H - (Math.min(v, top) / top) * H).toFixed(1);
  const line = c.points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t)},${y(v)}`).join('');
  const last = c.points[c.points.length - 1];
  const area = `${line}L${x(last[0])},${H}L${x(c.start)},${H}Z`;
  const proj =
    c.limited || c.now >= c.end
      ? ''
      : c.runOut && c.runOut < c.end
        ? `M${x(c.now)},${y(c.nowValue)}L${x(c.runOut)},${y(100)}L${x(c.end)},${y(100)}`
        : `M${x(c.now)},${y(c.nowValue)}L${x(c.end)},${y(c.atReset)}`;
  const leftPct = ((c.now - c.start) / length) * 100;
  const dot = (Math.min(c.nowValue, top) / top) * 100;
  const tone = c.level === 'crit' ? 'var(--bad-fill)' : c.level === 'warn' ? 'var(--warn-fill)' : 'var(--claude)';
  // In "used" terms, as the figures beside it are.
  const words = [
    `This window, ${c.marks[0]} to ${c.marks[c.marks.length - 1].replace(/^Resets/, 'its reset at')}`,
    c.pctMode ? `${Math.round(c.nowValue)}% used so far` : `≈ ${money(c.nowValue)} used so far`,
    c.limited
      ? 'limit reached'
      : c.now >= c.end
        ? ''
        : c.runOut && c.runOut < c.end
          ? `runs out around ${clock(c.runOut)} at your pace`
          : c.pctMode
            ? `about ${Math.round(Math.min(100, c.atReset))}% by the reset at your pace`
            : `about ${money(c.atReset)} by the reset at your pace`,
  ]
    .filter(Boolean)
    .join(', ');
  const gridline = (bottom: number, label: string, strong?: boolean) => (
    <div
      className={cx(
        'pointer-events-none absolute inset-x-0 border-t',
        strong ? 'border-line-strong' : 'border-dashed border-line',
      )}
      style={{ bottom: `${bottom}%` }}
    >
      <span className="absolute -top-2.5 right-0 bg-card pl-1 text-[10px] leading-none text-muted">{label}</span>
    </div>
  );
  return (
    <div>
      <div className="relative" style={{ height }} role="img" aria-label={words}>
        {c.pctMode ? (
          <>
            {gridline(100, 'Limit', true)}
            {gridline(50, '50%')}
          </>
        ) : (
          gridline((c.total / top) * 100, `≈ ${money(c.total)}`)
        )}
        <svg
          viewBox={`0 0 1000 ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden
        >
          <path d={area} fill={tone} opacity={0.16} />
          <path
            d={line}
            fill="none"
            stroke={tone}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {proj && (
            <path
              d={proj}
              fill="none"
              stroke={tone}
              strokeWidth={2}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.8}
            />
          )}
        </svg>
        <i className="absolute inset-y-0 w-px bg-line-strong" style={{ left: `${leftPct.toFixed(2)}%` }} />
        <i
          className="absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-card"
          style={{ left: `${leftPct.toFixed(2)}%`, bottom: `${dot.toFixed(2)}%`, background: tone }}
        />
        <div className="absolute inset-0 flex">
          {c.cols.map((col) => (
            <span
              key={col.a}
              data-tip={col.tip || undefined}
              className={cx('h-full flex-1', col.tip && 'hover:bg-ink/[0.04]')}
            />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-label text-muted" aria-hidden>
        {c.marks.map((m, i) => (
          <span key={i} className={cx(i === c.marks.length - 1 && 'font-semibold text-ink')}>
            {m}
          </span>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-3 rounded-[2px] opacity-60" style={{ background: tone }} />
          Used so far
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-3 border-t-2 border-dashed" style={{ borderColor: tone }} />
          At your pace
        </span>
        {c.pctMode && (
          <span className="inline-flex items-center gap-1.5">
            <i className="w-3 border-t border-line-strong" />
            The limit
          </span>
        )}
      </p>
    </div>
  );
}
