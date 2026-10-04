// Any card, expanded to fill most of the window: its chart drawn bigger and its
// list longer. It keeps updating while it's open. The button in a card's title
// opens it; Esc, the close button, or a click outside closes it, and so does
// following a link or opening a session from it. The dialog itself loads later
// (app/later.tsx), since most visits never expand a card.

import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { Maximize2 } from 'lucide-react';
import { IconButton } from '@/components/Button';
import { useUi } from '@/app/ui';
import { later } from '@/app/later';

const Dialog = later(() => import('@/components/Dialog').then((m) => m.Dialog));

type ExpandState = { card: string | null; set: (card: string | null) => void };
export const useExpand = create<ExpandState>((set) => ({ card: null, set: (card) => set({ card }) }));

export function ExpandButton({ card }: { card: string }) {
  const set = useExpand((s) => s.set);
  return (
    <IconButton label="Expand" tip="Expand this card" variant="quiet" size="sm" onClick={() => set(card)}>
      <Maximize2 size={14} strokeWidth={2} aria-hidden />
    </IconButton>
  );
}

/** The dialog, for the cards in `cards` (their name, and the card drawn expanded). */
export function ExpandDialog({ cards }: { cards: Record<string, { name: string; render: () => ReactNode }> }) {
  const card = useExpand((s) => s.card);
  const set = useExpand((s) => s.set);
  const session = useUi((s) => s.session);
  // A link or a session out of it goes where it points, with the card closed.
  useEffect(() => {
    const close = () => set(null);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [set]);
  useEffect(() => {
    if (session) set(null);
  }, [session, set]);
  const c = card ? cards[card] : null;
  if (!c) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && set(null)} title={c.name} wide bare className="max-w-[1200px] bg-card">
      {/* The card is the dialog: no second border, and its tools clear the close button. */}
      <div className="[&>section]:rounded-none [&>section]:border-0 [&>section]:shadow-none [&>section>header:first-child]:pr-10">{c.render()}</div>
    </Dialog>
  );
}
