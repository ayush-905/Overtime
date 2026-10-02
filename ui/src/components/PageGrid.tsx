// The cards of the Cost, Agents and You pages, in the order you choose. Each card
// keeps its designed width (half or full), and "Arrange cards" in the page's
// header moves them: drag one, or use its arrows; Reset puts them back. The order
// is saved with your settings (overtime-layout-<page>, as { slot, span } items).

import { useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical, LayoutGrid } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { changed } from '@/lib/bus';
import { offerUndo } from '@/app/toasts';
import { useCompact } from '@/app/layout';
import { Dialog } from './Dialog';
import { Button, IconButton } from './Button';
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

type Arranging = { page: string; title: string; cards: { id: string; name: string; span: number }[] } | null;
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

function Row({ id, name, span, index, count, move }: { id: string; name: string; span: number; index: number; count: number; move: (from: number, to: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cx('flex items-center gap-3 rounded-row border border-line bg-card px-3 py-2', isDragging && 'relative z-10 shadow-raised')}>
      <button type="button" className="grid size-7 cursor-grab place-items-center text-muted" aria-label={`Move ${name}`} {...attributes} {...listeners}>
        <GripVertical size={16} strokeWidth={1.8} aria-hidden />
      </button>
      <span className="grow">
        <b className="font-semibold">{name}</b>
        <small className="ml-2 text-label text-muted">{span === 12 ? 'Full width' : 'Half'}</small>
      </span>
      <IconButton label="Move earlier" variant="quiet" size="sm" disabled={index === 0} onClick={() => move(index, index - 1)}>
        <ChevronUp size={15} strokeWidth={2} aria-hidden />
      </IconButton>
      <IconButton label="Move later" variant="quiet" size="sm" disabled={index === count - 1} onClick={() => move(index, index + 1)}>
        <ChevronDown size={15} strokeWidth={2} aria-hidden />
      </IconButton>
    </li>
  );
}

export function ArrangeDialog() {
  const a = useArrange((s) => s.arranging);
  const close = () => useArrange.getState().open(null);
  const v = useChanged();
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    if (a) setOrder(readOrder(a.page, a.cards.map((c) => c.id)));
  }, [a, v]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const put = (next: string[], undo?: string) => {
    if (!a) return;
    const before = order;
    setOrder(next);
    saveOrder(a.page, next, a.cards);
    if (undo) offerUndo(undo, () => saveOrder(a.page, before, a.cards));
  };
  const move = (from: number, to: number) => put(arrayMove(order, from, to));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
  };
  return (
    <Dialog
      open={!!a}
      onOpenChange={(o) => !o && close()}
      title={a ? `Arrange ${a.title}` : 'Arrange'}
      description="The order of this page's cards"
      tools={
        a && (
          <Button size="sm" onClick={() => put(a.cards.map((c) => c.id), `${a.title}'s cards are back in their usual order`)}>
            Reset
          </Button>
        )
      }
    >
      {a && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {order.map((id, i) => {
                const c = a.cards.find((x) => x.id === id);
                return c ? <Row key={id} id={id} name={c.name} span={c.span} index={i} count={order.length} move={move} /> : null;
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </Dialog>
  );
}
