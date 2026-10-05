// The Overview in the compact layout (the menu bar's popover, /mini, a phone):
// the mockup's popover. What needs you, each provider's plan with both its
// windows, and today in three figures.

import { useInsight, useProvider, useSources, useSpend } from '@/data/scope';
import { useChanged, useMinute } from '@/data/hooks';
import { activeBetween, calendarDay, compact, costText, duration } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { byTokens } from '@/lib/measure';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Bits';
import { Stat, StatRow } from '@/components/Stat';
import { AttentionInbox, NoPlan, ProviderLimits } from './Band';
import { plansIn } from '@/lib/sources';

function TodayStrip() {
  useChanged();
  // Your active time counts by the minute.
  useMinute();
  const today = useSpend()?.today;
  const hours = useInsight('hours');
  const now = serverNow();
  if (!today) return <Skeleton lines={2} />;
  const tokens = byTokens();
  const active = activeBetween(hours, calendarDay(now), now);
  const partial = (today.unpricedTokens || 0) > today.tokens * 0.01;
  return (
    <StatRow columns={3} className="[&_dd]:text-[1.125rem]">
      <Stat label="Today" value={tokens ? compact(today.tokens) : costText(today.cost, partial)} />
      <Stat label={tokens ? 'Cost' : 'Tokens'} value={tokens ? costText(today.cost, partial) : compact(today.tokens)} />
      <Stat label="You, active" value={active ? duration(active) : '0m'} />
    </StatRow>
  );
}

/** `today`: with today's three figures (the popover and /mini, where there's no Today card under it). */
export function Summary({ today = true }: { today?: boolean }) {
  const provider = useProvider();
  const providers = plansIn(provider, useSources());
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <Card aria-label="Attention inbox">
        <AttentionInbox compact />
      </Card>
      <Card aria-label="Plan limits" className="flex flex-col gap-3">
        {providers.map((p, i) => (
          <div key={p} className="flex flex-col gap-3">
            {i > 0 && <div className="h-px bg-line" />}
            <ProviderLimits provider={p} compact />
          </div>
        ))}
        {provider !== 'all' && !providers.length && <NoPlan source={provider} compact />}
      </Card>
      {today && (
        <Card aria-label="Today">
          <TodayStrip />
        </Card>
      )}
    </div>
  );
}
