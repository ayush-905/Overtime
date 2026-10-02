// Notes in the corner. Undo, for the changes you make to the dashboard itself
// (renaming or pinning a session, recolouring a project, hiding a section…): it
// says what changed, with Undo for a few seconds, and ⌘Z works while it's there;
// it stays while the pointer is on it. A plain note goes away by itself.

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { Bell, Check, X, CircleAlert, Info } from 'lucide-react';
import { MAC, MOD, typing } from '@/data/hooks';

type Toast = { id: number; text: string; body?: string; level: 'undo' | 'good' | 'warn' | 'info' | 'crit' | 'alert'; undo?: () => void; ms: number };

type ToastState = { toasts: Toast[] };
export const useToasts = create<ToastState>(() => ({ toasts: [] }));

let nextId = 1;
const remove = (id: number) => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/** Say what just changed, with a way to put it back. A newer change replaces the note. */
export function offerUndo(text: string, undo: () => void) {
  useToasts.setState((s) => ({ toasts: [{ id: nextId++, text, level: 'undo', undo, ms: 7000 }, ...s.toasts.filter((t) => t.level !== 'undo')] }));
}

/** A short note that goes away by itself. */
export function note(text: string, { level = 'good', ms = 4500 }: { level?: 'good' | 'warn' | 'info'; ms?: number } = {}) {
  useToasts.setState((s) => ({ toasts: [{ id: nextId++, text, level, ms }, ...s.toasts].slice(0, 4) }));
}

/** An alert on the page: what happened, and a line about it (alerts.ts chimes and picks this or a notification). */
export function alertNote(title: string, body: string, level: 'alert' | 'warn' | 'crit' | 'good') {
  useToasts.setState((s) => ({ toasts: [{ id: nextId++, text: title, body, level, ms: 9000 }, ...s.toasts].slice(0, 4) }));
}

/** ⌘Z: the latest change's Undo, while its note is showing. */
export function undoLatest() {
  const offer = useToasts.getState().toasts.find((t) => t.level === 'undo');
  if (!offer?.undo) return false;
  remove(offer.id);
  offer.undo();
  return true;
}

function ToastItem({ t }: { t: Toast }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => remove(t.id), t.ms);
  };
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
  }, []);
  const Icon = t.level === 'warn' || t.level === 'crit' ? CircleAlert : t.level === 'info' ? Info : t.level === 'alert' ? Bell : Check;
  const tone = t.level === 'warn' ? 'text-warn' : t.level === 'crit' ? 'text-bad' : t.level === 'info' ? 'text-muted' : t.level === 'alert' ? 'text-ink' : 'text-ok';
  return (
    <div
      role="status"
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={arm}
      className="pointer-events-auto flex min-w-0 w-full max-w-[380px] items-center gap-2.5 rounded-row border border-line bg-raised py-2.5 pl-3.5 pr-2 text-body shadow-raised"
    >
      <Icon size={16} strokeWidth={2} className={`shrink-0 ${tone}`} aria-hidden />
      <span className="flex grow flex-col">
        <span className="font-medium">{t.text}</span>
        {t.body && <span className="text-detail text-muted">{t.body}</span>}
      </span>
      {t.undo && (
        <button
          type="button"
          data-tip={`${MOD}Z`}
          onClick={() => {
            remove(t.id);
            t.undo?.();
          }}
          className="h-7 rounded-control px-2.5 text-detail font-semibold hover:bg-sunken"
        >
          Undo
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={() => remove(t.id)} className="grid size-7 place-items-center rounded-control text-muted hover:bg-sunken hover:text-ink">
        <X size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(MAC ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || typing(e.target)) return;
      if (undoLatest()) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[4000] flex flex-col items-end gap-2 [.compact_&]:bottom-[calc(var(--tabbar-h)+12px)] [.compact_&]:left-3 [.compact_&]:right-3" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
