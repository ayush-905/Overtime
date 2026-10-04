// The sidebar's sections, to drag up or down within their group (or move with
// Alt+↑/↓). dnd-kit comes with it, so it loads once the page is up (later.tsx),
// in place of the plain links the sidebar starts with.

import { useLayoutEffect } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { placeSection, type Page } from '@/lib/nav';
import { useUi } from './ui';
import { NavLink, SectionList, moveKeys, takeFocusBack } from './Sidebar';

/** A section you can drag within its group, or move with Alt+↑/↓. */
function SortableNavItem({ page }: { page: Page }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page });
  // The link stays a link for screen readers and the keyboard; only the pointer drags it.
  const aria: Record<string, unknown> = { ...attributes };
  delete aria.role;
  delete aria.tabIndex;
  return <NavLink ref={setNodeRef} page={page} folded={false} dragging={isDragging} onKeyDown={moveKeys(page)} {...aria} {...listeners} style={{ transform: CSS.Translate.toString(transform), transition }} />;
}

export function SortableSections({ shown }: { shown: Page[]; folded: boolean }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useLayoutEffect(takeFocusBack, []);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const { nav, setNav } = useUi.getState();
    const next = placeSection(nav, e.active.id as Page, e.over.id as Page);
    if (next) setNav(next);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={shown} strategy={verticalListSortingStrategy}>
        <SectionList shown={shown} folded={false} item={(page) => <SortableNavItem page={page} />} />
      </SortableContext>
    </DndContext>
  );
}
