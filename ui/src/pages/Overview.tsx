// Desktop packs a leading Today widget beside the plans, then shows the inbox
// and the remaining chosen cards. Hidden or reordered Today widgets stay in
// their chosen position. Phones and the menu bar retain their compact summary.

import { CalendarDays, LayoutPanelTop, RefreshCw } from 'lucide-react';
import { useChanged } from '@/data/hooks';
import { refreshLimits, useLimits } from '@/data/limits';
import { useLive } from '@/data/live';
import { inPopover } from '@/data/desktop';
import { longDate } from '@/lib/format';
import { serverNow } from '@/lib/env';
import { digestReady } from '@/lib/digest';
import { Button, IconButton } from '@/components/Button';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { MINI } from '@/app/router';
import { useCompact } from '@/app/layout';
import { useUi } from '@/app/ui';
import { Band } from '@/cards/Band';
import { TodayCard } from '@/cards/Today';
import { Summary } from '@/cards/Summary';
import { ExpandDialog } from '@/cards/Expand';
import { CATALOG, readLayout, shownCards } from '@/cards/layout';
import { OverviewWidget } from '@/cards/registry';

const EXPANDABLE = Object.fromEntries(
	CATALOG.map((c) => [
		c.id,
		{
			name: c.name,
			render: () => <OverviewWidget id={c.id} expanded />,
		},
	]),
);

function Cards({ skipToday = false }: { skipToday?: boolean }) {
	useChanged();
	const cards = shownCards(readLayout()).filter((card) => !skipToday || card.id !== 'today');
	return (
		<div className="grid grid-cols-12 gap-[var(--page-gap)]">
			{cards.map((c) => {
				return (
					<div
						key={c.id}
						data-card={c.id}
						className={cx(
							'col-span-12 min-w-0',
							c.span === 7 && '@min-[900px]:col-span-7',
							c.span === 6 && '@min-[900px]:col-span-6',
							c.span === 5 && '@min-[900px]:col-span-5',
						)}
					>
						<OverviewWidget id={c.id} />
					</div>
				);
			})}
		</div>
	);
}

export function Overview() {
	useChanged();
	const compact = useCompact();
	const provider = useLive((s) => s.provider);
	const refreshing = useLimits((s) => s.refreshing);
	const setDigest = useUi((s) => s.setDigest);
	const setCustomizing = useUi((s) => s.setCustomizing);
	const ready = digestReady();
	const todayFirst = shownCards(readLayout())[0]?.id === 'today';
	if (compact) {
		return (
			<div className="flex flex-col gap-[var(--page-gap)]">
				{!inPopover && !MINI && (
					<PageHeader
						title="Overview"
						id="h-overview"
						sub={longDate(serverNow())}
					/>
				)}
				<Summary today={inPopover || MINI} />
				{!inPopover && !MINI && <Cards />}
				<ExpandDialog cards={EXPANDABLE} />
			</div>
		);
	}
	return (
		<div
			className={cx(
				'flex flex-col gap-[var(--page-gap)]',
				provider === 'all' && 'overview-all',
			)}
		>
			<PageHeader
				title="Overview"
				id="h-overview"
				sub={`${longDate(serverNow())} · Costs are what your usage would be at API list prices`}
				tools={
					<>
						<Button
							icon={<CalendarDays size={15} strokeWidth={1.8} aria-hidden />}
							onClick={() => setDigest(ready ? 1 : 0)}
							data-tip={
								ready
									? 'Last week in review is ready'
									: 'This week so far, and last week, in review'
							}
						>
							Your week
							{ready && (
								<span className="ml-0.5 rounded-full bg-warn-soft px-1.5 text-label font-bold text-warn">
									New
								</span>
							)}
						</Button>
						<Button
							icon={<LayoutPanelTop size={15} strokeWidth={1.8} aria-hidden />}
							onClick={() => setCustomizing(true)}
						>
							Customize
						</Button>
						<IconButton
							label="Refresh"
							tip="Get the latest plan limits now"
							disabled={refreshing}
							onClick={() => refreshLimits()}
						>
							<RefreshCw
								size={15}
								strokeWidth={1.8}
								className={refreshing ? 'animate-spin' : ''}
								aria-hidden
							/>
						</IconButton>
					</>
				}
			/>
			<Band today={todayFirst ? <TodayCard glance /> : undefined} />
			<Cards skipToday={todayFirst} />
			<ExpandDialog cards={EXPANDABLE} />
		</div>
	);
}
