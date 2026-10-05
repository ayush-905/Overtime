// Every part of the design on one page (#parts, not in the sidebar), to check the
// tokens and components in light and dark, at any width.

import { CalendarDays, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Card, CardHead, Eyebrow } from '@/components/Card';
import { Button, IconButton, TextLink } from '@/components/Button';
import { Seg } from '@/components/Seg';
import { Figure, Stat, StatRow } from '@/components/Stat';
import { Meter, toneFor, toneWords } from '@/components/Meter';
import {
  Avatar,
  Empty,
  Insight,
  Kbd,
  LiveDot,
  Pill,
  ProjectDot,
  ProviderMark,
  Select,
  Skeleton,
  TagCount,
} from '@/components/Bits';
import { Switch } from '@/components/Switch';
import { Dialog } from '@/components/Dialog';
import { offerUndo, note } from '@/app/toasts';
import { PageHeader } from '@/app/PageHeader';

const SWATCHES = [
  'page',
  'side',
  'card',
  'sunken',
  'line',
  'line-strong',
  'ink',
  'muted',
  'faint',
  'accent',
  'ok',
  'ok-fill',
  'ok-soft',
  'warn',
  'warn-fill',
  'warn-soft',
  'bad',
  'bad-fill',
  'bad-soft',
  'claude',
  'codex',
  'pi',
  'you',
];
const VARS: Record<string, string> = { page: '--bg', 'line-strong': '--line-strong' };

export function Parts() {
  const [seg, setSeg] = useState('cost');
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title="Parts"
        sub="Every token and component of the design"
        tools={<Button icon={<CalendarDays size={15} strokeWidth={1.8} aria-hidden />}>Your week</Button>}
      />

      <Card>
        <CardHead title="Colour" sub="The tokens, as this theme has them" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {SWATCHES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className="size-8 shrink-0 rounded-[7px] border border-line"
                style={{ background: `var(${VARS[s] || `--${s}`})` }}
              />
              <span className="text-label font-semibold">{s}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card band className="grid gap-6 @min-[800px]:grid-cols-3">
        <div className="flex flex-col gap-3">
          <Eyebrow>Needs attention</Eyebrow>
          <Figure value="3 need you" tone="warn" unit="1 working · 5 open" />
          <div className="flex items-center gap-3 rounded-row bg-warn-soft px-3 py-2">
            <Avatar source="claude" />
            <span className="flex min-w-0 grow flex-col">
              <span className="truncate font-semibold">Ordered inbox backend review (fork)</span>
              <span className="truncate text-detail text-muted">Asked you a question · Thrive Backend API</span>
            </span>
            <span className="whitespace-nowrap text-detail font-semibold text-warn tnum">5h 43m</span>
          </div>
        </div>
        {[
          ['claude', 99],
          ['codex', 22],
        ].map(([source, left]) => (
          <div key={source} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <ProviderMark source={source as 'claude' | 'codex'} size={18} />
              <h3 className="text-[15px] font-semibold">{source === 'claude' ? 'Claude Code' : 'Codex'}</h3>
            </div>
            <Figure size="hero" value={`${left}%`} unit="left in this 5-hour window" />
            <Meter left={left as number} label="5-hour window left" />
            <p className="text-detail text-muted">
              Resets 03:00 · in 4h 47m ·{' '}
              <span className={`font-semibold ${toneFor(left as number) === 'ok' ? 'text-ok' : 'text-warn'}`}>
                {toneWords[toneFor(left as number)]}
              </span>
            </p>
          </div>
        ))}
      </Card>

      <div className="grid gap-[var(--page-gap)] @min-[700px]:grid-cols-2">
        <Card>
          <CardHead title="Figures" sub="Stats in a row" tools={<TextLink href="#parts">All sessions →</TextLink>} />
          <StatRow columns={3}>
            <Stat label="Active" value="4h 56m" />
            <Stat label="Sessions" value="6" sub="2 open" />
            <Stat
              label="Lines changed"
              value={
                <>
                  <span className="text-ok">+5.2K</span> <span className="text-bad">−31</span>
                </>
              }
            />
          </StatRow>
          <div className="mt-4 flex flex-col gap-3">
            {[64, 22, 6, null].map((v, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-16 text-detail tnum">{v == null ? 'No reading' : `${v}% left`}</span>
                <Meter left={v} label="Example" className="grow" />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Controls" />
          <div className="flex flex-wrap items-center gap-2.5">
            <Button icon={<CalendarDays size={15} strokeWidth={1.8} aria-hidden />}>Your week</Button>
            <IconButton label="Refresh">
              <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
            </IconButton>
            <Button variant="primary" onClick={() => setOpen(true)}>
              Open a dialog
            </Button>
            <Button variant="quiet">Quiet</Button>
            <Seg
              label="Compare by"
              value={seg}
              onChange={setSeg}
              options={[
                ['cost', 'Cost'],
                ['tokens', 'Tokens'],
              ]}
            />
            <Switch checked={on} onChange={setOn} label="An example switch" />
            <Select aria-label="Project" defaultValue="">
              <option value="">All projects</option>
              <option>overtime</option>
            </Select>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Pill tone="needs">Needs you</Pill>
            <Pill tone="working" dot>
              Working
            </Pill>
            <Pill tone="idle">Idle</Pill>
            <TagCount tags={['dashboard', 'ui', 'polish']} />
            <LiveDot />
            <ProjectDot name="overtime" />
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => offerUndo('Hid Projects from the sidebar', () => note('Put it back'))}>
              Offer undo
            </Button>
            <Button size="sm" onClick={() => note('Saved')}>
              Note
            </Button>
            <Button size="sm" onClick={() => note('Couldn’t reach the server', { level: 'warn' })}>
              Warning
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="A session row" sub="Its title, one line of detail, its figure" />
        <a
          href="#parts"
          data-row
          className="flex items-center gap-3 border-t border-line py-[var(--row-py)] text-ink no-underline"
        >
          <Avatar source="claude" status="working" />
          <span className="flex min-w-0 grow flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold">Timezone localization notifications architecture</span>
              <span className="shrink-0 rounded-sm bg-warn-soft px-1.5 text-label font-semibold text-warn">
                82% full
              </span>
              <TagCount tags={['bug', 'release']} />
            </span>
            <span className="truncate text-detail text-muted">
              Thrive Backend API · Opus 5.5 · 26 Sept, 17:52 · 5 messages · 2h of agent time
            </span>
          </span>
          <span className="font-semibold tnum">₹29,374</span>
        </a>
        <Insight className="mt-3">A typical session here costs ₹414 and keeps the agent busy for 9m.</Insight>
        <Empty className="mt-3">No sessions today yet.</Empty>
        <Skeleton className="mt-3" />
      </Card>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="A dialog"
        description="Radix underneath: focus stays inside, Esc closes it"
      >
        <p>Dialogs get the raised surface and the deeper shadow.</p>
      </Dialog>
    </div>
  );
}
