// The cards of the Cost, Agents and You pages, in the order you choose. Each card
// keeps its designed width (half or full), and "Arrange cards" in the page's
// header moves them (in ArrangeDialog.tsx, which loads when it's first wanted):
// drag one, or use its arrows; Reset puts them back. The order is saved with your
// settings (overtime-layout-<page>, as { slot, span } items).

import type { ReactNode } from 'react';
import { create } from 'zustand';
import { LayoutGrid } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { changed } from '@/lib/bus';
import { useCompact } from '@/app/layout';
import { Button } from './Button';
import { cx } from './cx';

export type GridCard = { id: string; name: string; span: 6 | 12; node: ReactNode };

const key = (page: string) => `overtime-layout-${page}`;

/** The cards' order: as you saved it, with cards new since then where they ship. */
export function readOrder(page: string, usual: string[]): string[] {
  let saved: { slot: string }[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(key(page)) || '[]') || [];
  } catch {}
  const order = (Array.isArray(saved) ? saved.map((x) => x?.slot) : []).filter((id) => usual.includes(id));
  for (const id of usual) if (!order.includes(id)) order.splice(Math.min(usual.indexOf(id), order.length), 0, id);
  return order;
}

export function saveOrder(page: string, order: string[], cards: { id: string; span: number }[]) {
  try {
    if (order.join() === cards.map((c) => c.id).join()) localStorage.removeItem(key(page));
    else localStorage.setItem(key(page), JSON.stringify(order.map((slot) => ({ slot, span: cards.find((c) => c.id === slot)?.span ?? 6 }))));
  } catch {}
  changed('layout');
}

export type Arranging = { page: string; title: string; cards: { id: string; name: string; span: number }[] } | null;
export const useArrange = create<{ arranging: Arranging; open: (a: Arranging) => void }>((set) => ({ arranging: null, open: (arranging) => set({ arranging }) }));

/** The page's cards in its 12-column grid, in your order. */
export function PageGrid({ page, cards }: { page: string; cards: GridCard[] }) {
  useChanged();
  const order = readOrder(page, cards.map((c) => c.id));
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
    <Button icon={<LayoutGrid size={15} strokeWidth={1.8} aria-hidden />} onClick={() => open({ page, title, cards: cards.map(({ id, name, span }) => ({ id, name, span })) })} data-tip="Put this page's cards in the order you like">
      Arrange
    </Button>
  );
}
