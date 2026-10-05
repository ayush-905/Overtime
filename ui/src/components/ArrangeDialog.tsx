// "Arrange cards": a page's cards in the order you choose, to drag (or move with
// their arrows), with Reset to put them back. Opened from a page's header
// (PageGrid.tsx); it loads when it's first wanted, since it brings the drag and
// drop with it.

import { useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { offerUndo } from '@/app/toasts';
import { Dialog } from './Dialog';
import { Button, IconButton } from './Button';
import { readOrder, saveOrder } from './PageGrid';
import { useArrange } from '@/app/dialogs';
import { cx } from './cx';

function Row({
  id,
  name,
  span,
  index,
  count,
  move,
}: {
  id: string;
  name: string;
  span: number;
  index: number;
  count: number;
  move: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx(
        'flex items-center gap-3 rounded-row border border-line bg-card px-3 py-2',
        isDragging && 'relative z-10 shadow-raised',
      )}
    >
      <button
        type="button"
        className="grid size-7 cursor-grab place-items-center text-muted"
        aria-label={`Move ${name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} strokeWidth={1.8} aria-hidden />
      </button>
      <span className="grow">
        <b className="font-semibold">{name}</b>
        <small className="ml-2 text-label text-muted">{span === 12 ? 'Full width' : 'Half'}</small>
      </span>
      <IconButton
        label="Move earlier"
        variant="quiet"
        size="sm"
        disabled={index === 0}
        onClick={() => move(index, index - 1)}
      >
        <ChevronUp size={15} strokeWidth={2} aria-hidden />
      </IconButton>
      <IconButton
        label="Move later"
        variant="quiet"
        size="sm"
        disabled={index === count - 1}
        onClick={() => move(index, index + 1)}
      >
        <ChevronDown size={15} strokeWidth={2} aria-hidden />
      </IconButton>
    </li>
  );
}

export function ArrangeDialog() {
  const a = useArrange((s) => s.arranging);
  const close = () => useArrange.getState().open(null);
  const v = useChanged();
  const [order, setOrder] = useState<string[]>(() =>
    a
      ? readOrder(
          a.page,
          a.cards.map((c) => c.id),
        )
      : [],
  );
  useEffect(() => {
    if (a)
      setOrder(
        readOrder(
          a.page,
          a.cards.map((c) => c.id),
        ),
      );
  }, [a, v]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
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
          <Button
            size="sm"
            onClick={() =>
              put(
                a.cards.map((c) => c.id),
                `${a.title}'s cards are back in their usual order`,
              )
            }
          >
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
                return c ? (
                  <Row key={id} id={id} name={c.name} span={c.span} index={i} count={order.length} move={move} />
                ) : null;
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </Dialog>
  );
}
