// Customize the Overview: which cards it shows under its band, and in what order.
// Drag a card, or use its arrows; switch one off to hide it. Hiding or resetting
// can be undone.

import { useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Dialog } from '@/components/Dialog';
import { Button, IconButton } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { cx } from '@/components/cx';
import { useChanged } from '@/data/hooks';
import { offerUndo } from '@/app/toasts';
import { useUi } from '@/app/ui';
import { CATALOG, readLayout, saveLayout, usualLayout, type Layout } from './layout';

function Row({ id, index, count, layout, change }: { id: string; index: number; count: number; layout: Layout; change: (next: Layout, undo?: string) => void }) {
  const card = CATALOG.find((c) => c.id === id)!;
  const shown = !layout.hidden.includes(id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const move = (by: number) => change({ ...layout, order: arrayMove(layout.order, index, index + by) });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('flex items-center gap-3 rounded-row border border-line bg-card px-3 py-2', isDragging && 'relative z-10 shadow-raised', !shown && 'opacity-60')}
    >
      <button type="button" className="grid size-7 cursor-grab place-items-center text-muted" aria-label={`Move ${card.name}`} {...attributes} {...listeners}>
        <GripVertical size={16} strokeWidth={1.8} aria-hidden />
      </button>
      <span className="grow">
        <b className="font-semibold">{card.name}</b>
        <small className="ml-2 text-label text-muted">{card.section && `${card.section} · `}{card.span === 12 ? 'Full width' : card.span === 7 ? 'Wide' : card.span === 6 ? 'Half width' : 'Narrow'}</small>
      </span>
      <IconButton label="Move earlier" variant="quiet" size="sm" disabled={index === 0} onClick={() => move(-1)}>
        <ChevronUp size={15} strokeWidth={2} aria-hidden />
      </IconButton>
      <IconButton label="Move later" variant="quiet" size="sm" disabled={index === count - 1} onClick={() => move(1)}>
        <ChevronDown size={15} strokeWidth={2} aria-hidden />
      </IconButton>
      <Switch
        checked={shown}
        label={`Show ${card.name}`}
        onChange={(on) => change({ ...layout, hidden: on ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] }, on ? undefined : `Removed “${card.name}” from the Overview`)}
      />
    </li>
  );
}

export function CustomizeDialog() {
  const open = useUi((s) => s.customizing);
  const setOpen = useUi((s) => s.setCustomizing);
  const v = useChanged();
  const [layout, setLayout] = useState(readLayout);
  useEffect(() => setLayout(readLayout()), [v, open]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const change = (next: Layout, undo?: string) => {
    const before = layout;
    setLayout(next);
    saveLayout(next);
    if (undo) offerUndo(undo, () => saveLayout(before));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    change({ ...layout, order: arrayMove(layout.order, layout.order.indexOf(String(e.active.id)), layout.order.indexOf(String(e.over.id))) });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Customize the Overview"
      description="Which cards show under what needs you and your limits, and in what order"
      tools={
        <Button size="sm" onClick={() => change(usualLayout(), 'The Overview is back to its usual cards')}>
          Reset
        </Button>
      }
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.order} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {layout.order.map((id, i) => (
              <Row key={id} id={id} index={i} count={layout.order.length} layout={layout} change={change} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </Dialog>
  );
}
