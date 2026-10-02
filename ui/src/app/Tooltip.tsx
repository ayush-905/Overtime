// One tooltip for the whole page: anything with a data-tip shows it, by the
// pointer as it moves, or under the element when it has the keyboard's focus.
// Multi-line tips keep their lines, so cards can say more on hover without a
// component per tip.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Tip = { text: string; x: number; y: number } | null;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const at = (x: number, y: number, text: string) => setTip({ text, x, y });
    const over = (e: MouseEvent) => {
      const target = (e.target as Element | null)?.closest?.('[data-tip]') || null;
      if (target === current.current) return;
      current.current = target;
      const text = target?.getAttribute('data-tip');
      if (!target || !text) setTip(null);
      else at(e.clientX, e.clientY, text);
    };
    const move = (e: MouseEvent) => {
      const el = current.current;
      if (el && !el.isConnected) {
        current.current = null;
        setTip(null);
      } else if (el) {
        const text = el.getAttribute('data-tip');
        if (text) at(e.clientX, e.clientY, text);
      }
    };
    const focus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      const text = el?.matches?.(':focus-visible') ? el.getAttribute('data-tip') : null;
      if (!text) return;
      current.current = el;
      const r = el.getBoundingClientRect();
      at(r.left, r.bottom, text);
    };
    const hide = () => {
      current.current = null;
      setTip(null);
    };
    const leave = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousemove', move, { passive: true });
    document.addEventListener('mouseout', leave);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('scroll', hide, { capture: true });
    };
  }, []);

  // Beside the pointer, kept on screen, measured once the new text is in.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const pad = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = tip.x + pad;
    let y = tip.y + pad;
    if (x + w > window.innerWidth - 8) x = tip.x - w - pad;
    if (y + h > window.innerHeight - 8) y = tip.y - h - pad;
    el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }, [tip]);

  return (
    <div
      ref={box}
      role="tooltip"
      aria-hidden={!tip}
      className="pointer-events-none fixed left-0 top-0 z-[5000] max-w-[300px] whitespace-pre-line rounded-control bg-ink px-2.5 py-1.5 text-label font-medium text-card shadow-raised"
      style={{ visibility: tip ? 'visible' : 'hidden' }}
    >
      {tip?.text}
    </div>
  );
}
