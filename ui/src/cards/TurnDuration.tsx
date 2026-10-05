import { Timer } from 'lucide-react';
import { useInsight } from '@/data/scope';
import { duration, plural } from '@/lib/format';
import { pageLink } from '@/lib/route';
import { Card, CardHead, InfoTip } from '@/components/Card';
import { Stat, StatRow } from '@/components/Stat';
import { Empty, Skeleton } from '@/components/Bits';
import { TextLink } from '@/components/Button';
import { ExpandButton } from './Expand';

export function TurnDurationCard({ expanded = false }: { expanded?: boolean }) {
  const data = useInsight('turnPerformance');
  const head = (
    <CardHead
      title={
        <span className="inline-flex items-center gap-2">
          <Timer size={16} aria-hidden />
          Turn duration
        </span>
      }
      sub="Last 7 days · time from your message to the end of the observed turn"
      tools={
        <>
          <InfoTip note="Median: half the sampled turns were this fast or faster. P90: 90% were this fast or faster. Codex completion events are used when available; other durations end at the last recorded reply. Ongoing turns, interruptions and unresolved approval or question waits are excluded." />
          {!expanded && <ExpandButton card="turn-duration" />}
        </>
      }
    />
  );
  return (
    <Card aria-label="Turn duration">
      {head}
      {!data ? (
        <Skeleton lines={3} />
      ) : !data.count ? (
        <Empty>
          No settled turns to measure yet.
          {data.pending ? ` ${plural(data.pending, 'turn')} still pending or unconfirmed.` : ''}
        </Empty>
      ) : (
        <>
          <StatRow columns={3}>
            <Stat label="Median" value={duration(data.medianMs)} />
            <Stat label="P90" value={duration(data.p90Ms)} />
            <Stat label="Longest" value={duration(data.maxMs)} />
          </StatRow>
          <div className="turn-distribution mt-4" aria-label="Turn-duration distribution">
            {data.buckets.map((bucket) => (
              <div key={bucket.label} className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-1 text-label">
                  <span>{bucket.label}</span>
                  <span className="tnum">{bucket.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div
                    className="h-full rounded-full bg-s1"
                    style={{ width: `${(bucket.count / data.count) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-label text-muted">
            <span>
              {plural(data.count, 'sampled turn')}
              {data.inferred ? ` · ${data.inferred} inferred from replies` : ''}
              {data.pending ? ` · ${data.pending} pending` : ''}
              {data.interrupted ? ` · ${data.interrupted} interrupted` : ''}
            </span>
            <TextLink href={pageLink('you')}>Your messages →</TextLink>
          </div>
        </>
      )}
    </Card>
  );
}
