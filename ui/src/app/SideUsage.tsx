// What's left of each plan, at the foot of the sidebar, on every page,
// a row for each window. Folded, it's each provider's lowest window as a figure.
// Either way it opens Usage. It counts nothing by the second, so it moves with
// the plan windows (each minute, and at a reset).

import { useQuota } from '@/data/scope';
import { useLive } from '@/data/live';
import { hasPlan } from '@/lib/sources';
import { useChanged } from '@/data/hooks';
import { whenText } from '@/lib/format';
import { providerName, type QuotaItem } from '@/lib/limits';
import { pageLink } from '@/lib/route';
import { Meter, toneFor } from '@/components/Meter';
import { ProviderMark } from '@/components/Bits';
import { cx } from '@/components/cx';

const leftOf = (w: QuotaItem) => (w.limited ? 0 : w.usedPercent == null ? null : Math.max(0, 100 - w.usedPercent));
const valueOf = (w: QuotaItem) => (w.limited ? 'Limit' : w.usedPercent == null ? '—' : `${Math.round(100 - w.usedPercent)}%`);
const toneText = { ok: 'text-ink', warn: 'text-warn', bad: 'text-bad' };

function resetOf(w: QuotaItem) {
  if (w.idle) return 'No window running';
  if (w.expired) return 'Reset since last report';
  if (w.resetsAt) return `Resets ${whenText(w.resetsAt)}`;
  return w.usedPercent == null ? 'No estimate yet' : '';
}

const tipOf = (w: QuotaItem) => {
  const reset = resetOf(w);
  return `${providerName(w.provider)} ${w.label.toLowerCase()}: ${w.limited ? 'limit reached' : w.usedPercent == null ? 'no figure' : `${Math.round(100 - w.usedPercent)}% left`}${reset ? `. ${reset}` : ''}`;
};

/** The windows by provider, Claude Code first. */
function groups(items: QuotaItem[]) {
  const by = new Map<'claude' | 'codex', QuotaItem[]>();
  for (const w of items) by.set(w.provider, [...(by.get(w.provider) || []), w]);
  return [...by];
}

export function SideUsage({ folded }: { folded: boolean }) {
  useChanged();
  const { items } = useQuota();
  const provider = useLive((s) => s.provider);
  const list = groups(items);
  // A provider without a plan of its own (Pi) has no usage left to show.
  if (provider !== 'all' && !hasPlan(provider)) return null;

  if (!items.length) {
    return <a href={pageLink('usage')} aria-label="Usage left, open Usage" className="shrink-0 rounded-row px-2.5 py-2 text-label text-muted no-underline hover:bg-sunken">{folded ? '—' : 'Usage left · no reading yet'}</a>;
  }

  if (folded) {
    return (
      <a href={pageLink('usage')} aria-label="Usage left, open Usage" className="flex max-h-[32dvh] shrink-0 flex-col items-center gap-2.5 overflow-y-auto rounded-row py-1.5 text-ink no-underline hover:bg-sunken">
        {list.map(([provider, windows]) => {
          const known = windows.filter((w) => leftOf(w) != null);
          const low = known.length ? known.reduce((a, b) => (leftOf(b)! < leftOf(a)! ? b : a)) : null;
          const left = low ? leftOf(low)! : null;
          return (
            <span key={provider} className="flex flex-col items-center gap-1" data-tip={windows.map(tipOf).join('\n')}>
              <ProviderMark source={provider} size={16} />
              <b className={cx('text-label tnum', left == null ? 'text-muted' : toneText[toneFor(left)])}>{low ? valueOf(low) : '—'}</b>
            </span>
          );
        })}
      </a>
    );
  }

  return (
    <a href={pageLink('usage')} aria-label="Usage left, open Usage" className="flex max-h-[32dvh] shrink-0 flex-col gap-2 overflow-y-auto rounded-row px-2.5 py-2 text-ink no-underline hover:bg-sunken">
      <span className="text-group font-semibold uppercase tracking-[0.06em] text-muted">Usage left</span>
      <span className="grid grid-cols-[14px_auto_minmax(24px,1fr)_auto] items-center gap-x-2 gap-y-2 text-label">
        {list.flatMap(([, windows]) => windows).map((w) => {
          const left = leftOf(w);
          return (
            <span key={`${w.provider}-${w.id}`} data-tip={tipOf(w)} className={cx('col-span-4 grid grid-cols-subgrid items-center', left == null && 'opacity-70')}>
              <ProviderMark source={w.provider} size={14} />
              <span className="truncate text-muted">{w.label}</span>
              <Meter left={left} size="sm" label={`${providerName(w.provider)} ${w.label.toLowerCase()} left`} />
              <b className={cx('min-w-[3ch] text-right tnum', left == null ? 'text-muted' : toneText[toneFor(left)])}>{valueOf(w)}</b>
            </span>
          );
        })}
      </span>
    </a>
  );
}
