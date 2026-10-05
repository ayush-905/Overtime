// Charts: the same values drawn as bars, a line, an area, a heat strip or a
// table (Plot), the switch in a card's corner that picks between them, shares of
// a whole as a list or a donut, and the week-view calendar and hour grid the time
// cards use. Every column has a tooltip, and one that leads somewhere (a day's
// sessions) is a link.

import type { CSSProperties, ReactNode } from 'react';
import { AreaChart, BarChart3, Copy, Grid3x3, LineChart, List, PieChart, Table2 } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { chartKind, CHART_KINDS, heatLevel, setChartKind, SERIES, toCsv, type ChartKind } from '@/lib/charts';
import { copyText } from '@/lib/copy';
import { DAY, HOUR, MINUTE, WEEKDAY_NAMES, WEEK_ORDER, hourLabel, plural, workdayHour } from '@/lib/format';
import { note } from '@/app/toasts';
import { cx } from './cx';

export type Point = { value: number; current?: boolean; [key: string]: unknown };
export type Segment = { value: number; color: string; name?: string };

export type PlotOptions<V extends Point> = {
  tip: (v: V, i: number) => string;
  labels: string[];
  height?: number;
  gridLabel?: (v: number) => string;
  /** One label under every column (else they spread across). */
  even?: boolean;
  /** The label to mark, like today's. */
  markLabel?: number;
  halfLine?: boolean;
  /** Each column's value printed above it, instead of gridlines. */
  valueText?: ((v: V, i: number) => string) | null;
  /** The colour of the bars, the line or the heat. */
  color?: string;
  /** Stack each column from parts that add up to its value. */
  segments?: ((v: V, i: number) => Segment[]) | null;
  link?: ((v: V, i: number) => string | null) | null;
  table?: { head: string[]; row: (v: V, i: number) => (string | number)[]; newestFirst?: boolean } | null;
};

const ICONS: Record<ChartKind, typeof BarChart3> = {
  bars: BarChart3,
  line: LineChart,
  area: AreaChart,
  heat: Grid3x3,
  list: List,
  donut: PieChart,
  table: Table2,
};

/** A card's chart style, redrawn when it's changed (here, in Settings, or another tab). */
export function useChartKind(id: string, kinds: ChartKind[] = SERIES) {
  useChanged();
  return chartKind(id, kinds);
}

/** The switch in a chart card's corner: one small button per style it offers. */
export function ChartSwitch({ id, kinds = SERIES }: { id: string; kinds?: ChartKind[] }) {
  const on = useChartKind(id, kinds);
  return (
    <div role="group" aria-label="Chart style" className="inline-flex gap-0.5 rounded-[8px] bg-sunken p-0.5">
      {kinds.map((k) => {
        const Icon = ICONS[k];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={k === on}
            aria-label={CHART_KINDS[k]}
            data-tip={`Show as ${CHART_KINDS[k].toLowerCase()}`}
            onClick={() => setChartKind(id, k, kinds)}
            className={cx(
              'grid size-6 place-items-center rounded-[6px] text-muted hover:text-ink',
              k === on && 'bg-card text-ink shadow-card',
            )}
          >
            <Icon size={13} strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function Column<V extends Point>({
  v,
  i,
  link,
  tip,
  className,
  style,
  children,
}: {
  v: V;
  i: number;
  link: PlotOptions<V>['link'];
  tip: PlotOptions<V>['tip'];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const href = link?.(v, i);
  const cls = cx(
    'relative flex h-full min-w-0 flex-1 flex-col justify-end',
    href && 'cursor-pointer hover:[&>*]:opacity-80',
    className,
  );
  return href ? (
    <a href={href} data-tip={tip(v, i)} className={cls} style={style}>
      {children}
    </a>
  ) : (
    <span data-tip={tip(v, i)} className={cls} style={style}>
      {children}
    </span>
  );
}

function Axis({
  labels,
  even,
  markLabel = -1,
  count,
}: {
  labels: string[];
  even?: boolean;
  markLabel?: number;
  count: number;
}) {
  return (
    <div
      className={cx('mt-1.5 text-label text-muted', even ? 'grid text-center' : 'flex justify-between')}
      style={even ? { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` } : undefined}
      aria-hidden
    >
      {labels.map((l, i) => (
        <span key={i} className={cx('truncate', i === markLabel && 'font-semibold text-ink')}>
          {l}
        </span>
      ))}
    </div>
  );
}

function Gridlines({
  max,
  top,
  half,
  label,
}: {
  max: number;
  top: number;
  half: boolean;
  label: (v: number) => string;
}) {
  if (!(max > 0)) return null;
  const line = (at: number, v: number) => (
    <div
      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line"
      style={{ bottom: `${at}%` }}
    >
      <span className="absolute -top-2 left-0 bg-card pr-1 text-[10px] leading-none text-faint tnum">{label(v)}</span>
    </div>
  );
  return (
    <>
      {line(top, max)}
      {half && line(top / 2, max / 2)}
    </>
  );
}

function Bars<V extends Point>({
  values,
  tip,
  labels,
  height = 150,
  gridLabel = String,
  even,
  markLabel,
  halfLine = true,
  valueText,
  color = 'var(--s1)',
  segments,
  link,
}: PlotOptions<V> & { values: V[] }) {
  const max = Math.max(...values.map((v) => v.value), 0);
  const top = valueText ? 84 : 100;
  return (
    <div>
      <div className="relative" style={{ height }}>
        {!valueText && <Gridlines max={max} top={top} half={halfLine} label={gridLabel} />}
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {values.map((v, i) => {
            const h = max > 0 ? Math.max(v.value > 0 ? 2 : 0, (v.value / max) * top) : 0;
            const parts = segments && v.value > 0 ? segments(v, i) : null;
            return (
              <Column key={i} v={v} i={i} link={link} tip={tip}>
                {valueText && (
                  <b
                    className="absolute inset-x-0 text-center text-[10px] font-semibold text-muted tnum"
                    style={{ bottom: `calc(${h.toFixed(1)}% + 2px)` }}
                  >
                    {valueText(v, i)}
                  </b>
                )}
                {parts ? (
                  <span
                    className="flex flex-col-reverse overflow-hidden rounded-t-[3px]"
                    style={{ height: `${h.toFixed(1)}%` }}
                  >
                    {parts.map((p, k) => (
                      <i
                        key={k}
                        className="block"
                        style={{ height: `${((p.value / v.value) * 100).toFixed(2)}%`, background: p.color }}
                      />
                    ))}
                  </span>
                ) : (
                  <i
                    className={cx(
                      'block rounded-t-[3px]',
                      v.current && 'ring-1 ring-ink/30 ring-offset-1 ring-offset-card',
                    )}
                    style={{ height: `${h.toFixed(1)}%`, background: v.value > 0 ? color : undefined }}
                  />
                )}
                {v.value <= 0 && <i className="block h-px bg-line-strong" />}
              </Column>
            );
          })}
        </div>
      </div>
      <Axis labels={labels} even={even} markLabel={markLabel} count={values.length} />
    </div>
  );
}

function Lines<V extends Point>({
  values,
  tip,
  labels,
  height = 150,
  gridLabel = String,
  even,
  markLabel,
  halfLine = true,
  valueText,
  color = 'var(--s1)',
  segments,
  link,
  area,
}: PlotOptions<V> & { values: V[]; area?: boolean }) {
  const n = values.length;
  const max = Math.max(...values.map((v) => v.value), 0);
  const top = valueText ? 84 : 94;
  const y = (value: number) => (max > 0 ? (value / max) * top : 0);
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const path = (ys: number[]) =>
    ys.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${(100 - h).toFixed(2)}`).join('');
  const total = values.map((v) => y(v.value));
  // Stacked parts: each level is the parts below it added up.
  const levels: { color: string; ys: number[] }[] = [];
  if (segments) {
    const parts = values.map((v, i) => (v.value > 0 ? segments(v, i) : []));
    const count = Math.max(0, ...parts.map((p) => p.length));
    for (let k = 0; k < count; k++)
      levels.push({
        color: parts.find((p) => p[k])?.[k].color || color,
        ys: parts.map((p) => y(p.slice(0, k + 1).reduce((s, sg) => s + sg.value, 0))),
      });
  }
  return (
    <div>
      <div className="relative" style={{ height }}>
        {!valueText && <Gridlines max={max} top={top} half={halfLine} label={gridLabel} />}
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {levels.length ? (
            levels.map((lv, k) => {
              const below = k ? levels[k - 1].ys : values.map(() => 0);
              return (
                <g key={k}>
                  {area && (
                    <path
                      d={`${path(lv.ys)}${[...below]
                        .reverse()
                        .map((h, j) => `L${x(n - 1 - j).toFixed(2)} ${(100 - h).toFixed(2)}`)
                        .join('')}Z`}
                      fill={lv.color}
                      opacity={0.25}
                    />
                  )}
                  <path
                    d={path(lv.ys)}
                    fill="none"
                    stroke={lv.color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })
          ) : (
            <>
              {area && (
                <path
                  d={`${path(total)}L${x(n - 1).toFixed(2)} 100L${x(0).toFixed(2)} 100Z`}
                  fill={color}
                  opacity={0.18}
                />
              )}
              <path
                d={path(total)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex">
          {values.map((v, i) => (
            <Column key={i} v={v} i={i} link={link} tip={tip} className="group">
              {valueText && (
                <b
                  className="absolute inset-x-0 text-center text-[10px] font-semibold text-muted tnum"
                  style={{ bottom: `calc(${total[i].toFixed(1)}% + 7px)` }}
                >
                  {valueText(v, i)}
                </b>
              )}
              <i
                className={cx(
                  'absolute left-1/2 size-[7px] -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-card opacity-0 group-hover:opacity-100',
                  v.current && 'opacity-100',
                )}
                style={{ bottom: `${total[i].toFixed(1)}%`, background: color }}
              />
            </Column>
          ))}
        </div>
      </div>
      <Axis labels={labels} even={even} markLabel={markLabel} count={n} />
    </div>
  );
}

/** How dark a heat cell is: none, then four steps of the colour. */
export const heatStyle = (level: number, color: string): CSSProperties =>
  level
    ? { background: `color-mix(in srgb, ${color} ${[0, 22, 45, 70, 100][level]}%, var(--sunken))` }
    : { background: 'var(--sunken)' };

export function HeatLegend({ color = 'var(--s1)' }: { color?: string }) {
  return (
    <p className="mt-2 flex items-center justify-end gap-1 text-label text-muted" aria-hidden>
      Less
      {[0, 1, 2, 3, 4].map((l) => (
        <i key={l} className="size-2.5 rounded-[2px]" style={heatStyle(l, color)} />
      ))}
      More
    </p>
  );
}

function Heat<V extends Point>({
  values,
  tip,
  labels,
  even,
  markLabel,
  valueText,
  color = 'var(--s1)',
  link,
}: PlotOptions<V> & { values: V[] }) {
  const max = Math.max(...values.map((v) => v.value), 0);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
        {values.map((v, i) => {
          const href = link?.(v, i);
          const cls = cx(
            'grid aspect-square max-h-10 place-items-center rounded-[3px] text-[9px] font-semibold',
            v.current && 'ring-1 ring-ink/40',
          );
          const body =
            // biome-ignore lint/correctness/useJsxKeyInIterable: the cell's content, not an item of the list (the cell around it has the key)
            valueText && v.value > 0 ? <b className="mix-blend-difference text-white">{valueText(v, i)}</b> : null;
          return href ? (
            <a
              key={i}
              href={href}
              data-tip={tip(v, i)}
              className={cls}
              style={heatStyle(heatLevel(v.value, max), color)}
            >
              {body}
            </a>
          ) : (
            <span key={i} data-tip={tip(v, i)} className={cls} style={heatStyle(heatLevel(v.value, max), color)}>
              {body}
            </span>
          );
        })}
      </div>
      <Axis labels={labels} even={even} markLabel={markLabel} count={values.length} />
      <HeatLegend color={color} />
    </div>
  );
}

function DataTable<V extends Point>({ values, tip, link, height = 150, table }: PlotOptions<V> & { values: V[] }) {
  const head = table?.head || ['', 'Value', 'More'];
  let rows = values.map((v, i) => {
    const cells = table
      ? table.row(v, i)
      : (() => {
          const [first = '', second = '', ...rest] = String(tip(v, i)).split('\n')[0].split(' · ');
          return [first, second, rest.join(' · ')];
        })();
    return {
      v,
      cells: head.map((_, k) => (cells[k] == null || cells[k] === '' ? '—' : String(cells[k]))),
      href: link?.(v, i),
    };
  });
  if (table?.newestFirst) rows = rows.reverse();
  const copy = async () => {
    const ok = await copyText(toCsv([head, ...rows.map((r) => r.cells)]));
    note(
      ok ? `Copied ${plural(rows.length, 'row')} as CSV` : "Couldn't copy to the clipboard",
      ok ? {} : { level: 'warn' },
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div
        tabIndex={0}
        className="overflow-auto rounded-row border border-line"
        style={{ maxHeight: Math.max(150, height + 26) }}
      >
        <table className="w-full text-detail tnum">
          <thead className="sticky top-0 bg-sunken text-label text-muted">
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col" className={cx('px-2.5 py-1.5 font-semibold', i ? 'text-right' : 'text-left')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, cells, href }, i) => (
              <tr key={i} className={cx('border-t border-line', v.current && 'font-semibold')}>
                <th scope="row" className="px-2.5 py-1 text-left font-normal">
                  {href ? (
                    <a
                      href={href}
                      className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                    >
                      {cells[0]}
                    </a>
                  ) : (
                    cells[0]
                  )}
                </th>
                {cells.slice(1).map((c, k) => (
                  <td key={k} className="px-2.5 py-1 text-right">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-label text-muted">
        <span>{plural(rows.length, 'row')}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 font-semibold text-ink hover:underline"
        >
          <Copy size={12} strokeWidth={2} aria-hidden />
          Copy as CSV
        </button>
      </div>
    </div>
  );
}

/** The same values drawn in the chosen style. */
export function Plot<V extends Point>({ kind, values, ...opts }: PlotOptions<V> & { kind: ChartKind; values: V[] }) {
  if (kind === 'line') return <Lines values={values} {...opts} />;
  if (kind === 'area') return <Lines values={values} {...opts} area />;
  if (kind === 'heat') return <Heat values={values} {...opts} />;
  if (kind === 'table') return <DataTable values={values} {...opts} />;
  return <Bars values={values} {...opts} />;
}

// ── Parts of a whole ─────────────────────────────────────────────────────────

/** `pctText`: what the right-hand column says, when it isn't the share of the total (a failure rate, say). */
export type Share = {
  name: ReactNode;
  value: number;
  color?: string;
  href?: string | null;
  tip?: string;
  valueText: string;
  pctText?: string;
};

/** Parts of a whole as a list, each with a bar of its share. */
export function ShareList({
  items,
  total,
  color = 'var(--s1)',
  wrapNames = false,
}: {
  items: Share[];
  total: number;
  color?: string;
  wrapNames?: boolean;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-2.5">
      {items.map((it, i) => {
        const pct = total > 0 ? (it.value / total) * 100 : 0;
        const name = (
          <span className={cx('min-w-0', wrapNames ? '[overflow-wrap:anywhere]' : 'truncate')}>{it.name}</span>
        );
        return (
          <li key={i} data-tip={it.tip} className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-baseline justify-between gap-3 text-detail">
              {it.href ? (
                <a
                  href={it.href}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-ink no-underline hover:underline"
                >
                  {name}
                </a>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-1.5">{name}</span>
              )}
              <span className="flex shrink-0 items-baseline gap-2 tnum">
                <b className="font-semibold">{it.valueText}</b>
                <span className="w-9 text-right text-muted">{it.pctText ?? `${Math.round(pct)}%`}</span>
              </span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <i
                className="block h-full rounded-full"
                style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, pct).toFixed(1)}%`, background: it.color || color }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const DONUT_COLORS = [
  'var(--s1)',
  'var(--s2)',
  'var(--s3)',
  'var(--s4)',
  'var(--claude)',
  'var(--codex)',
  'var(--faint)',
];

/** Parts of a whole as a ring, with the list beside it. */
export function Donut({ items, total }: { items: Share[]; total: number }) {
  const R = 15.915; // a circle 100 around, so a share is its own length
  let at = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" role="img" aria-label="Shares of the total" className="size-32 shrink-0 -rotate-90">
        <circle r={R} cx={21} cy={21} fill="none" stroke="var(--sunken)" strokeWidth={7} />
        {items.map((it, i) => {
          const share = total > 0 ? (it.value / total) * 100 : 0;
          const len = Math.max(0, share - 0.4);
          const el = (
            <circle
              key={i}
              r={R}
              cx={21}
              cy={21}
              fill="none"
              stroke={it.color || DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth={7}
              strokeDasharray={`${len.toFixed(2)} ${(100 - len).toFixed(2)}`}
              strokeDashoffset={(-at).toFixed(2)}
            >
              <title>{it.tip}</title>
            </circle>
          );
          at += share;
          return el;
        })}
      </svg>
      <ul className="flex min-w-[180px] grow flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} data-tip={it.tip} className="flex items-center gap-2 text-detail">
            <i
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: it.color || DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            {it.href ? (
              <a href={it.href} className="min-w-0 grow truncate text-ink no-underline hover:underline">
                {it.name}
              </a>
            ) : (
              <span className="min-w-0 grow truncate">{it.name}</span>
            )}
            <b className="font-semibold tnum">{it.valueText}</b>
            <span className="w-9 text-right text-muted tnum">
              {total > 0 ? Math.round((it.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Time ─────────────────────────────────────────────────────────────────────

/** Hour of the day by day of the week, darker for more: when in the week you work. */
export function HourGrid({
  grid,
  tip,
  color = 'var(--s1)',
}: {
  grid: number[][];
  tip: (day: number, hour: number, v: number) => string;
  color?: string;
}) {
  const max = Math.max(...grid.flat(), 0);
  return (
    <div>
      <div className="grid items-center gap-[2px]" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }}>
        {WEEK_ORDER.map((d) => (
          <div key={d} className="contents">
            <span className="text-label text-muted">{WEEKDAY_NAMES[d].slice(0, 3)}</span>
            {grid[d].map((v, h) => (
              <i
                key={h}
                data-tip={tip(d, h, v)}
                className="aspect-square rounded-[2px]"
                style={heatStyle(heatLevel(v, max), color)}
              />
            ))}
          </div>
        ))}
        <span />
        {[0, 6, 12, 18].map((h) => (
          <span key={h} className="text-label text-muted" style={{ gridColumn: `${h + 2} / span 6` }}>
            {hourLabel(h)}
          </span>
        ))}
      </div>
      <HeatLegend color={color} />
    </div>
  );
}

/** `dark`: a dark block, with light text on it (the default); false for a light one. */
export type CalendarBlock = {
  from: number;
  to: number;
  color: string;
  tip?: string;
  text?: string;
  gap?: boolean;
  opacity?: number;
  dark?: boolean;
};
export type CalendarColumn = { day: number; label: string; current?: boolean; tip?: string; blocks: CalendarBlock[] };

/**
 * A week-view calendar: a column per day with time running down, and blocks for
 * stretches of time in each. Days start at `dayHour` (your workday's start, or
 * midnight). The hours shown fit the blocks.
 */
export function Calendar({
  columns,
  height = 180,
  now = null,
  dayHour = workdayHour(),
}: {
  columns: CalendarColumn[];
  height?: number;
  now?: number | null;
  dayHour?: number;
}) {
  const offsets = columns.flatMap((c) =>
    c.blocks.flatMap((b) => [Math.max(0, b.from - c.day), Math.min(DAY, b.to - c.day)]),
  );
  let lo = offsets.length ? Math.floor(Math.min(...offsets) / HOUR) * HOUR : 5 * HOUR;
  let hi = offsets.length ? Math.ceil(Math.max(...offsets) / HOUR) * HOUR : 19 * HOUR;
  if (hi - lo < 8 * HOUR) {
    lo = Math.max(0, hi - 8 * HOUR);
    hi = Math.min(DAY, lo + 8 * HOUR);
  }
  const y = (off: number) => ((off - lo) / (hi - lo)) * 100;
  const step = hi - lo > 12 * HOUR ? 6 : 3;
  const marks: [number, number][] = [];
  for (let off = lo; off <= hi; off += HOUR) {
    const h = (dayHour + off / HOUR) % 24;
    if (h % step === 0) marks.push([off, h]);
  }
  // Moves once a minute, so the card isn't redrawn every second.
  const minute = now == null ? null : Math.floor(now / MINUTE) * MINUTE;
  return (
    <div className="grid gap-x-2" style={{ gridTemplateColumns: '40px minmax(0, 1fr)' }}>
      <div className="relative text-label text-muted" style={{ height }} aria-hidden>
        {marks.map(([off, h]) => (
          <span key={off} className="absolute right-0 -translate-y-1/2 tnum" style={{ top: `${y(off).toFixed(2)}%` }}>
            {hourLabel(h)}
          </span>
        ))}
      </div>
      <div className="relative" style={{ height }}>
        {marks.map(([off, h]) => (
          <i
            key={off}
            className={cx(
              'absolute inset-x-0 border-t',
              h === 0 && off > 0 ? 'border-line-strong' : 'border-dashed border-line',
            )}
            style={{ top: `${y(off).toFixed(2)}%` }}
          />
        ))}
        <div
          className="absolute inset-0 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((c) => (
            <span key={c.day} data-tip={c.tip} className={cx('relative rounded-[4px]', c.current && 'bg-sunken/60')}>
              {c.blocks.map((b, i) => {
                const from = Math.max(b.from, c.day + lo);
                const to = Math.min(b.to, c.day + hi);
                if (to <= from) return null;
                const top = y(from - c.day);
                const h = y(to - c.day) - top;
                const style: CSSProperties = b.gap
                  ? { top: `calc(${top.toFixed(2)}% + 1px)`, height: `calc(${h.toFixed(2)}% - 2px)` }
                  : { top: `${top.toFixed(2)}%`, height: `${h.toFixed(2)}%` };
                return (
                  <i
                    key={i}
                    data-tip={b.tip}
                    className={cx(
                      'absolute inset-x-[2px] min-h-[2px] overflow-hidden rounded-[3px] px-1 pt-0.5 text-[10px] font-semibold not-italic leading-tight',
                      b.dark === false ? 'text-ink' : 'text-white',
                    )}
                    style={{ ...style, background: b.color, opacity: b.opacity }}
                  >
                    {b.text && from === b.from && (h / 100) * height >= 15 ? b.text : null}
                  </i>
                );
              })}
              {c.current && minute != null && minute > c.day + lo && minute < c.day + hi && (
                <b
                  className="absolute inset-x-0 h-0.5 bg-bad-fill"
                  style={{ top: `${y(minute - c.day).toFixed(2)}%` }}
                />
              )}
            </span>
          ))}
        </div>
      </div>
      <span />
      <div
        className="mt-1 grid gap-1 text-center text-label text-muted"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {columns.map((c) => (
          <span key={c.day} className={cx('truncate', c.current && 'font-semibold text-ink')}>
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
