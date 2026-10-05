// Each section's icon, and the badge beside its name: Agents shows how many need
// you, in amber. One kind of figure only, so a badge always means "look here".

import type { ComponentType } from 'react';
import { Bot, CircleDollarSign, Clock, Folder, Gauge, LayoutDashboard, List, SlidersHorizontal } from 'lucide-react';
import type { Page } from '@/lib/nav';
import { needsCount, useLive } from '@/data/live';

export const ICONS: Record<
  Page,
  ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>
> = {
  overview: LayoutDashboard,
  sessions: List,
  projects: Folder,
  usage: Gauge,
  cost: CircleDollarSign,
  agents: Bot,
  you: Clock,
  settings: SlidersHorizontal,
};

/** The badge by a section's name, or null. */
export function useBadge(page: Page): { count: number; label: string } | null {
  const needs = useLive((s) => (page === 'agents' ? needsCount(s.snap) : 0));
  if (page !== 'agents' || !needs) return null;
  return { count: needs, label: `${needs} need${needs === 1 ? 's' : ''} you` };
}

export function Badge({ page, className = '' }: { page: Page; className?: string }) {
  const badge = useBadge(page);
  if (!badge) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn-soft px-1.5 text-label font-bold text-warn tnum ${className}`}
    >
      <span aria-hidden>{badge.count}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}
