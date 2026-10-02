// The top of every page: its title and a line under it, its tools on the right,
// and (in the Mac app's window, which has no browser buttons) back and forward
// beside the title. In the popover only back shows, while there's somewhere to go.

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { inPopover } from '@/data/desktop';
import { cx } from '@/components/cx';
import { goBack, goForward, hasSteps, stepTip, useSteps } from './back';

function Steps() {
  const { back, forward } = useSteps();
  if (!hasSteps() || (inPopover && !back)) return null;
  const arrow = (dir: 'back' | 'forward', to: typeof back) => (
    <button
      type="button"
      aria-label={dir === 'back' ? 'Back' : 'Forward'}
      aria-keyshortcuts={dir === 'back' ? 'Meta+BracketLeft' : 'Meta+BracketRight'}
      data-tip={stepTip(dir, to) || undefined}
      disabled={!to}
      onClick={dir === 'back' ? goBack : goForward}
      className="grid size-7 place-items-center rounded-[7px] text-muted hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {dir === 'back' ? <ChevronLeft size={17} strokeWidth={2.1} aria-hidden /> : <ChevronRight size={17} strokeWidth={2.1} aria-hidden />}
    </button>
  );
  return (
    <span className={cx('flex shrink-0 gap-0.5', inPopover && '-ml-1.5')}>
      {arrow('back', back)}
      {!inPopover && arrow('forward', forward)}
    </span>
  );
}

export function PageHeader({ title, sub, tools, id }: { title: string; sub?: ReactNode; tools?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Steps />
        <div className="flex min-w-0 flex-col">
          <h1 id={id} className="text-heading font-bold tracking-[-0.02em] [.compact_&]:text-[1.25rem]">
            {title}
          </h1>
          {sub && <p className="mt-0.5 text-detail text-muted">{sub}</p>}
        </div>
      </div>
      {tools && <div className="ml-auto flex flex-wrap items-center gap-2">{tools}</div>}
    </header>
  );
}
