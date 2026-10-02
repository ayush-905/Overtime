// Optional Overview widgets load their section only when selected.
import { lazy, Suspense, type ComponentType } from 'react';
import { Card, CardHead } from '@/components/Card';
import { Skeleton } from '@/components/Bits';
import { TodayCard } from './Today';
import { TimelineCard } from './Timeline';
import { TurnDurationCard } from './TurnDuration';
import { OpenSessionsCard, TopSessionsCard, WhereTodayCard } from './Sessions';
import { CATALOG } from './layout';

export const OVERVIEW_WIDGETS: Record<string, ComponentType<{ expanded?: boolean }>> = {
  today: TodayCard,
  'turn-duration': TurnDurationCard,
  timeline: TimelineCard,
  'top-sessions': TopSessionsCard,
  'where-today': WhereTodayCard,
  'open-sessions': OpenSessionsCard,
  plan: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.PlansCard }))),
  trend: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.TrendCard }))),
  money: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.MoneyCard }))),
  sessions: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.PriciestCard }))),
  cache: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.CacheCard }))),
  context: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.ContextCard }))),
  longctx: lazy(() => import('@/pages/Cost').then((m) => ({ default: m.LongContextCard }))),
  agenthours: lazy(() => import('@/pages/Agents').then((m) => ({ default: m.AgentHoursCard }))),
  agenttotal: lazy(() => import('@/pages/Agents').then((m) => ({ default: m.TotalAgentTimeCard }))),
  agentwork: lazy(() => import('@/pages/Agents').then((m) => ({ default: m.AgentWorkCard }))),
  parallel: lazy(() => import('@/pages/Agents').then((m) => ({ default: m.ParallelCard }))),
  tools: lazy(() => import('@/pages/Agents').then((m) => ({ default: m.ToolsCard }))),
  skills: lazy(() => import('@/pages/Agents').then((m) => ({ default: m.SkillsCard }))),
  heatmap: lazy(() => import('@/pages/You').then((m) => ({ default: m.HeatmapCard }))),
  activehours: lazy(() => import('@/pages/You').then((m) => ({ default: m.ActiveHoursCard }))),
  messages: lazy(() => import('@/pages/You').then((m) => ({ default: m.MessagesCard }))),
  repeats: lazy(() => import('@/pages/You').then((m) => ({ default: m.RepeatsCard }))),
  waiting: lazy(() => import('@/pages/You').then((m) => ({ default: m.WaitingCard }))),
  'waiting-where': lazy(() => import('@/pages/You').then((m) => ({ default: m.WaitingWhereCard }))),
  workhours: lazy(() => import('@/pages/You').then((m) => ({ default: m.WorkHoursCard }))),
  hours: lazy(() => import('@/pages/You').then((m) => ({ default: m.HoursCard }))),
  weekdays: lazy(() => import('@/pages/You').then((m) => ({ default: m.WeekdaysCard }))),
};

export function OverviewWidget({ id, expanded }: { id: string; expanded?: boolean }) {
  const Widget = OVERVIEW_WIDGETS[id];
  const name = CATALOG.find((c) => c.id === id)!.name;
  return (
    <Suspense fallback={<Card><CardHead title={name} /><Skeleton lines={4} /></Card>}>
      <Widget expanded={expanded} />
    </Suspense>
  );
}
