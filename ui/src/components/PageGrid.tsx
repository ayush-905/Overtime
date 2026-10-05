// The cards of the Cost, Agents and You pages, in the order you choose. Each card
// keeps its designed width (half or full), and "Arrange cards" in the page's
// header moves them (in ArrangeDialog.tsx, which loads when it's first wanted):
// drag one, or use its arrows; Reset puts them back. The order is saved with your
// settings (overtime-layout-<page>, as { slot, span } items).

import type { ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { readJson, writeJson } from '@/lib/storage';
import { useCompact } from '@/app/layout';
import { useArrange } from '@/app/dialogs';
import { Button } from './Button';
import { cx } from './cx';

export type GridCard = { id: string; name: string; span: 6 | 12; node: ReactNode };

const key = (page: string) => `layout-${page}`;

/** The cards' order: as you saved it, with cards new since then where they ship. */
export function readOrder(page: string, usual: string[]): string[] {
  const saved = readJson<{ slot: string }[]>(key(page), [], Array.isArray);
  const order = saved.map((x) => x?.slot).filter((id) => usual.includes(id));
  for (const id of usual) if (!order.includes(id)) order.splice(Math.min(usual.indexOf(id), order.length), 0, id);
  return order;
}

export function saveOrder(page: string, order: string[], cards: { id: string; span: number }[]) {
  const usual = order.join() === cards.map((c) => c.id).join();
  writeJson(
    key(page),
    usual ? null : order.map((slot) => ({ slot, span: cards.find((c) => c.id === slot)?.span ?? 6 })),
    'layout',
  );
}

/** The page's cards in its 12-column grid, in your order. */
export function PageGrid({ page, cards }: { page: string; cards: GridCard[] }) {
  useChanged();
  const order = readOrder(
    page,
    cards.map((c) => c.id),
  );
  return (
    <div className="grid grid-cols-12 items-start gap-[var(--page-gap)]">
      {order.map((id) => {
        const c = cards.find((x) => x.id === id)!;
        return (
          <div key={id} data-card={id} className={cx('col-span-12 min-w-0', c.span === 6 && '@min-[900px]:col-span-6')}>
            {c.node}
          </div>
        );
      })}
    </div>
  );
}

/** "Arrange cards", for a page's header. */
export function ArrangeButton({ page, title, cards }: { page: string; title: string; cards: GridCard[] }) {
  const open = useArrange((s) => s.open);
  // In the popover and on a phone it would sit on a row of its own; arranging is for the window.
  if (useCompact()) return null;
  return (
    <Button
      icon={<LayoutGrid size={15} strokeWidth={1.8} aria-hidden />}
      onClick={() => open({ page, title, cards: cards.map(({ id, name, span }) => ({ id, name, span })) })}
      data-tip="Put this page's cards in the order you like"
    >
      Arrange
    </Button>
  );
}
