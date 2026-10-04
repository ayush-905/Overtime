// Settings: how the dashboard looks and how you get around it, which sections the
// sidebar shows, your money, plans and day, the alerts, where the plan limits
// come from, and your data (search inside conversations, backing up, starting
// over). Everything is saved on this Mac, in ~/.overtime, so every browser
// gets it and both dashboards share it.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AreaChart, BarChart3, Check, ExternalLink, LineChart } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useChanged, MOD } from '@/data/hooks';
import { useLive, setServerPrefs } from '@/data/live';
import { useLimits, setExact, setCodexExact } from '@/data/limits';
import { demo, getJson } from '@/data/api';
import { THEMES, SWATCHES, TEXT_SIZES, DENSITIES, appearance, palette, setAppearance, setCustomColor, setPaletteTheme } from '@/lib/appearance';
import { CURRENCIES, customizedProjects, projectPref, resetProjectPrefs, setClock24, setCurrency, setProjectPref, setTheme, shownTheme, themeChoice, type ThemeChoice } from '@/lib/prefs';
import { env } from '@/lib/env';
import { fromUsd, hourLabel, money, plural, toUsd } from '@/lib/format';
import { MEASURES, setMeasure } from '@/lib/measure';
import { chartDefault, chartsCustomized, setChartDefault, CHART_KINDS, type ChartKind } from '@/lib/charts';
import { ORDERABLE, TITLES, toggleHidden } from '@/lib/nav';
import { PLAN_PRESETS, plans, setPlan } from '@/lib/plans';
import { readAlertPrefs, saveAlertPrefs, STUCK_MAX_MINUTES, WAIT_MAX_MINUTES, type AlertPrefs } from '@/lib/alerts';
import { pageLink } from '@/lib/route';
import { Card, CardHead } from '@/components/Card';
import { Seg } from '@/components/Seg';
import { Button, TextLink } from '@/components/Button';
import { Kbd, Select, Switch } from '@/components/Bits';
import { cx } from '@/components/cx';
import { PageHeader } from '@/app/PageHeader';
import { useUi } from '@/app/ui';
import { offerUndo, note } from '@/app/toasts';
import { askPermission, checkAll, deliver } from '@/app/alerts';
import { restoreFrom, saveCopy, useReset } from '@/app/ResetDialog';
import { ICONS } from '@/app/sections';

function Row({ title, note: text, children, id, stack }: { title: string; note?: ReactNode; children?: ReactNode; id?: string; stack?: boolean }) {
  return (
    <div id={id} className={cx('flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-line py-3.5 first:border-t-0 first:pt-0', stack && 'flex-col items-stretch')}>
      <div className={cx('min-w-[220px]', !stack && 'grow basis-[260px]')}>
        <b className="text-body font-semibold">{title}</b>
        {text && <p className="text-detail text-muted">{text}</p>}
      </div>
      {children}
    </div>
  );
}

/** A number field that saves when you leave it (or press Enter), and shows what's saved otherwise. */
function NumberField({ value, onSave, min, max, step = 1, label, before, after, tip }: { value: number; onSave: (v: number) => void; min?: number; max?: number; step?: number; label: string; before?: string; after?: string; tip?: string }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  // What's in the field itself, not the draft: typed and left at once, the draft hasn't caught up.
  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v)) onSave(v);
    else setDraft(String(value));
  };
  return (
    <label data-tip={tip} className="flex h-8 items-center gap-1.5 rounded-control border border-line bg-card px-2.5 text-detail focus-within:border-accent">
      {before && <span className="text-muted">{before}</span>}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-16 bg-transparent text-right outline-none tnum"
      />
      {after && <span className="text-muted">{after}</span>}
    </label>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────

function Appearance() {
  const current = appearance('palette');
  const dark = shownTheme() === 'dark';
  const custom = current === 'custom' ? palette() : null;
  const customized = chartsCustomized();
  const kind = chartDefault();
  const icons: Partial<Record<ChartKind, typeof BarChart3>> = { bars: BarChart3, line: LineChart, area: AreaChart };
  return (
    <Card>
      <CardHead title="Appearance" sub="How the dashboard looks, and how you get around it" />
      <Row title="Theme" note={<>Light, dark, or the same as your Mac. Press <Kbd>T</Kbd> anywhere to switch between light and dark.</>}>
        <Seg label="Theme" value={themeChoice()} onChange={(v: ThemeChoice) => setTheme(v)} options={[['light', 'Light'], ['auto', 'Like your Mac'], ['dark', 'Dark']]} />
      </Row>
      <Row title="Colour theme" note="The accent and the sidebar's tint, each with a version for the dark theme. Claude Code, Codex and Pi keep their own colours, and red, green and amber always mean the same things." stack>
        <div role="radiogroup" aria-label="Colour theme" className="flex flex-wrap gap-1.5">
          {[...THEMES, { id: 'custom', name: 'Custom', note: 'Pick the accent yourself', light: { accent: custom?.accent || THEMES[0].light.accent } }].map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={current === t.id}
              onClick={() => setPaletteTheme(t.id)}
              data-tip={('note' in t && t.note) || t.name}
              className={cx('flex h-8 items-center gap-2 rounded-control border px-2.5 text-detail', current === t.id ? 'border-ink font-semibold' : 'border-line hover:bg-sunken')}
            >
              <span className="size-3.5 rounded-full" style={{ background: t.id === 'classic' ? 'var(--ink)' : ((dark && 'dark' in t ? t.dark : t.light) as { accent: string }).accent }} aria-hidden />
              {t.name}
              {current === t.id && <Check size={13} strokeWidth={2.2} aria-hidden />}
            </button>
          ))}
        </div>
        {custom && (
          <div className="flex flex-col gap-1.5">
            <span className="text-detail text-muted">Your accent. The dark theme gets a lighter version of it, worked out for you.</span>
            <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-1.5">
              {SWATCHES.map(([c, name]) => (
                <button key={c} type="button" role="radio" aria-checked={custom.accent === c} aria-label={name} data-tip={name} onClick={() => setCustomColor('accent', c)} className={cx('grid size-7 place-items-center rounded-full border-2', custom.accent === c ? 'border-ink' : 'border-transparent')} style={{ background: c }}>
                  {custom.accent === c && <Check size={13} strokeWidth={3} className="text-white" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
        )}
      </Row>
      <Row title="Text size" note="Every card, list and label, together.">
        <Seg label="Text size" value={appearance('text') as string} onChange={(v) => setAppearance('text', v)} options={TEXT_SIZES} />
      </Row>
      <Row title="Density" note="Compact packs cards and rows closer, for more on screen at once.">
        <Seg label="Density" value={appearance('density') as string} onChange={(v) => setAppearance('density', v)} options={DENSITIES} />
      </Row>
      <Row title="Charts" note="How charts are drawn, unless you pick another style on a card with the small switch in its corner. Heatmaps and a donut are on the cards they suit.">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Charts" className="inline-flex gap-0.5 rounded-[9px] bg-sunken p-[3px]">
            {(['bars', 'line', 'area'] as ChartKind[]).map((k) => {
              const Icon = icons[k]!;
              return (
                <button key={k} type="button" aria-pressed={k === kind} onClick={() => setChartDefault(k)} className={cx('flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-detail', k === kind ? 'bg-card font-semibold text-ink shadow-card' : 'text-muted hover:text-ink')}>
                  <Icon size={14} strokeWidth={2} aria-hidden />
                  {CHART_KINDS[k]}
                </button>
              );
            })}
          </div>
          {customized > 0 && (
            <button type="button" className="text-detail font-semibold text-accent hover:underline" data-tip={`${plural(customized, 'card')} ${customized === 1 ? 'has its' : 'have their'} own style. Put ${customized === 1 ? 'it' : 'them'} back to the default`} onClick={() => setChartDefault(kind, { all: true })}>
              Reset {plural(customized, 'card')}
            </button>
          )}
        </div>
      </Row>
      <Row title="Layout" note="Customize picks the Overview's cards and their order; Arrange, on the Cost, Agents and You pages, puts their cards in your order. Every card keeps its designed width.">
        <Button onClick={() => { location.hash = '#overview'; useUi.getState().setCustomizing(true); }}>Customize the Overview</Button>
      </Row>
      <Row title="Keyboard" note={<><Kbd>{MOD.replace('+', '')}K</Kbd> to go anywhere, <Kbd>/</Kbd> to search a page, <Kbd>j</Kbd> <Kbd>k</Kbd> to move through a list, <Kbd>T</Kbd> for light or dark.</>}>
        <Button onClick={() => useUi.getState().setKeysOpen(true)}>All shortcuts</Button>
      </Row>
    </Card>
  );
}

// ── The sidebar ──────────────────────────────────────────────────────────────

function Sidebar() {
  const nav = useUi((s) => s.nav);
  const setNav = useUi((s) => s.setNav);
  return (
    <Card id="nav-edit">
      <CardHead title="Sidebar" sub="Which sections it shows" />
      <Row title="Sections" note={<>Switch off the ones you don't use; a hidden one is still in the <Kbd>{MOD.replace('+', '')}K</Kbd> palette. To change the order, drag a section up or down in the sidebar itself, or press Alt+↑ or ↓ on one.</>} stack>
        <ul className="grid gap-x-6 gap-y-1 @min-[520px]:grid-cols-2">
          {nav.order.filter((p) => (ORDERABLE as readonly string[]).includes(p)).map((p) => {
            const Icon = ICONS[p];
            const on = !nav.hidden.has(p);
            return (
              <li key={p} className="flex items-center gap-2.5 py-1">
                {Icon && <Icon size={16} strokeWidth={1.8} className="text-muted" aria-hidden />}
                <span className={cx('grow text-body', !on && 'text-muted')}>{TITLES[p]}</span>
                <Switch
                  checked={on}
                  label={`Show ${TITLES[p]} in the sidebar`}
                  onChange={() => {
                    const next = toggleHidden(nav, p);
                    if (!next) {
                      note('At least one section stays in the sidebar', { level: 'info' });
                      return;
                    }
                    const before = nav;
                    setNav(next);
                    if (!on) return;
                    offerUndo(`${TITLES[p]} is hidden from the sidebar`, () => setNav(before));
                  }}
                />
              </li>
            );
          })}
        </ul>
      </Row>
    </Card>
  );
}

// ── Personal ─────────────────────────────────────────────────────────────────

function PlanRow({ provider, who }: { provider: 'claude' | 'codex'; who: string }) {
  const p = plans[provider];
  const presets = PLAN_PRESETS[provider];
  const value = p ? (presets.some(([id]) => id === p.plan) ? p.plan : 'custom') : '';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-detail font-semibold text-muted">{who}</span>
      <Select
        aria-label={`Your ${who} plan`}
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          const preset = presets.find(([k]) => k === id);
          if (!id) setPlan(provider, null);
          else if (preset) setPlan(provider, preset[2], id);
          else setPlan(provider, p?.usd || presets[0][2], 'custom');
        }}
      >
        <option value="">No plan set</option>
        {presets.map(([id, name, usd]) => (
          <option key={id} value={id}>
            {name} · {money(usd)}
          </option>
        ))}
        <option value="custom">Another amount</option>
      </Select>
      {p && (
        <NumberField
          label={`What you pay for ${who} a month`}
          before={env.currency.symbol.trim()}
          after="/mo"
          min={0}
          step={env.currency.whole ? 1 : 0.01}
          value={Math.round(fromUsd(p.usd) * 100) / 100}
          onSave={(v) => {
            if (!(v > 0)) return;
            const usd = toUsd(v);
            const preset = presets.find(([, , x]) => Math.abs(x - usd) < 0.005);
            setPlan(provider, usd, preset ? preset[0] : 'custom');
          }}
        />
      )}
    </div>
  );
}

function Personal() {
  const workday = useLive((s) => s.snap?.prefs?.workdayHour ?? 4);
  const n = customizedProjects().length;
  const usd = env.currency.code === 'USD';
  return (
    <Card id="personal-settings">
      <CardHead title="Personal" sub="Your money, your plans and your day" />
      <Row title="Currency" note="Costs estimate model tokens at each provider’s API list prices, which are in US dollars, so they’re converted at your rate; the dashboard never goes online to look one up. ≈ marks such an estimate, and a + after a figure means some usage had no known price.">
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Currency" value={env.currency.code} onChange={(e) => setCurrency(e.target.value, env.currency.rates?.[e.target.value] || CURRENCIES[e.target.value]?.rate)}>
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>
                {code} · {c.name}
              </option>
            ))}
          </Select>
          {!usd && <NumberField label="How much of your currency one US dollar buys" tip="How much of your currency one US dollar buys" before="1 US$ =" after={env.currency.code} min={0} step={0.01} value={env.currency.rate} onSave={(v) => v > 0 && setCurrency(env.currency.code, v)} />}
        </div>
      </Row>
      <Row title="Your plans" note="What you pay each month, so Cost can show how much API-priced usage your plan covers. Presets are the list prices as of writing; any amount works.">
        <div className="flex flex-col gap-2">
          <PlanRow provider="claude" who="Claude" />
          <PlanRow provider="codex" who="ChatGPT" />
        </div>
      </Row>
      <Row title="Compare by" note="What sessions, projects and days are ranked and totalled by: what they’d cost at API list prices, or the tokens they used. Tokens suit a subscription, and models with no known price. The Cost page always counts money.">
        <Seg label="Compare by" value={env.measure} onChange={(v) => setMeasure(v)} options={MEASURES} />
      </Row>
      <Row title="Your day starts at" note="Your working hours, agent hours and the window planner count a day from this hour, so a late night stays with the day it started.">
        <Select
          aria-label="Your working day starts at"
          value={String(workday)}
          onChange={async (e) => {
            try {
              await setServerPrefs({ workdayHour: Number(e.target.value) });
            } catch {
              note("Couldn't reach Overtime's server, so your day is as it was", { level: 'warn' });
            }
          }}
        >
          {Array.from({ length: 13 }, (_, h) => (
            <option key={h} value={h}>
              {h === 0 ? `Midnight (${hourLabel(0)})` : h === 12 ? `Noon (${hourLabel(12)})` : hourLabel(h)}
            </option>
          ))}
        </Select>
      </Row>
      <Row title="Clock" note="How times of day are written.">
        <Seg label="Clock" value={env.clock24 ? '24' : '12'} onChange={(v) => setClock24(v === '24')} options={[['12', '2:30pm'], ['24', '14:30']]} />
      </Row>
      <Row title="Project names and colours" note={n ? `${plural(n, 'project')} renamed or recoloured. Change one from its page in Projects; only this dashboard sees the names.` : 'Rename a project, or pick its colour, from its page in Projects. Only this dashboard sees the names.'}>
        <div className="flex gap-2">
          <TextLink href={pageLink('projects')} className="inline-flex h-8 items-center rounded-control border border-line px-3 no-underline hover:bg-sunken">
            Projects
          </TextLink>
          {n > 0 && (
            <Button
              onClick={() => {
                const before = customizedProjects().map((name) => [name, projectPref(name)] as const);
                resetProjectPrefs();
                offerUndo(`${plural(before.length, 'project')} back to ${before.length === 1 ? 'its' : 'their'} own names and colours`, () => {
                  for (const [name, pref] of before) setProjectPref(name, pref);
                });
              }}
            >
              Reset all
            </Button>
          )}
        </div>
      </Row>
    </Card>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────────────

const ALERTS: [keyof AlertPrefs, string, string][] = [
  ['needs', 'An agent needs you', "Its turn is done, it asked a question, its plan is ready, or it's waiting for your approval."],
  ['waiting', 'An agent has waited for you', `A reminder when one has sat done and waiting this long. Up to ${WAIT_MAX_MINUTES} minutes, since an agent idle for 30 leaves the live view.`],
  ['stuck', 'An agent may be stuck', 'Its tool calls keep failing, one call has run this long, or it has gone this long with no progress. The Overview flags it either way.'],
  ['limits', 'A limit is 80% or 90% used', 'For each provider’s quota windows, and when you hit one. Once per window.'],
  ['pace', "You're on pace to run out", 'When your recent pace would use up a Claude Code or Codex limit before it resets. Once per window.'],
  ['reset', 'A limit you hit resets', 'When a window you used 90% or more of starts over, so you know you can carry on.'],
  ['budget', "Today's cost passes a budget", 'At API list prices, once a day.'],
  ['digest', 'Your week in review', "On Monday morning, when last week's digest is ready. It's on the Overview either way."],
];

function Alerts() {
  useChanged();
  const prefs = readAlertPrefs();
  const put = (next: AlertPrefs) => {
    saveAlertPrefs(next);
    checkAll();
  };
  return (
    <Card>
      <CardHead title="Alerts" sub="A chime and a note on this page, or a notification while it is in the background" />
      <p className="mb-3 text-detail text-muted">Your browser asks for permission the first time you switch one on.</p>
      {ALERTS.map(([key, title, text]) => (
        <Row key={key} title={title} note={text}>
          <div className="flex items-center gap-2">
            {key === 'waiting' && <NumberField label="Minutes before the reminder" tip="Minutes an agent waits before the reminder" after="min" min={1} max={WAIT_MAX_MINUTES} value={prefs.waitMinutes} onSave={(v) => v >= 1 && put({ ...prefs, waitMinutes: Math.min(WAIT_MAX_MINUTES, Math.round(v)) })} />}
            {key === 'stuck' && <NumberField label="Minutes before an agent counts as stuck" tip="Minutes before an agent counts as stuck" after="min" min={2} max={STUCK_MAX_MINUTES} value={prefs.stuckMinutes} onSave={(v) => v >= 2 && put({ ...prefs, stuckMinutes: Math.min(STUCK_MAX_MINUTES, Math.round(v)) })} />}
            {key === 'budget' && <NumberField label="Daily budget" tip="Your daily budget, in your currency" before={env.currency.symbol.trim()} min={1} value={Math.round(fromUsd(prefs.budgetUsd))} onSave={(v) => v > 0 && put({ ...prefs, budgetUsd: toUsd(v) })} />}
            <Switch
              checked={!!prefs[key]}
              label={title}
              onChange={async (on) => {
                put({ ...prefs, [key]: on });
                if (on) await askPermission();
              }}
            />
          </div>
        </Row>
      ))}
      <Row title="Try it" note="Plays the chime and shows a sample alert, to check sound and notifications.">
        <Button
          onClick={async () => {
            await askPermission();
            deliver({ title: 'This is how alerts look', body: 'A chime, this note while you are on the page, and a notification while it is in the background.', tag: 'test', level: 'info' });
          }}
        >
          Send a test alert
        </Button>
      </Row>
    </Card>
  );
}

// ── Plan limits ──────────────────────────────────────────────────────────────

function PlanLimits() {
  const exactOn = useLimits((s) => s.exactOn);
  const codexOn = useLimits((s) => s.codexExactOn);
  const checks = demo ? [] : [exactOn && 'with Anthropic, using your Claude Code login', codexOn && 'with OpenAI, through the Codex app and its login'].filter(Boolean);
  const privacy = checks.length ? `Only your plan limits are checked, ${checks.join(', and ')}; nothing else leaves this machine.` : 'Exact limits are off, so nothing leaves this machine.';
  return (
    <Card>
      <CardHead title="Plan limits" sub="Where the numbers on the Usage page come from" />
      <Row title="Exact limits from Anthropic" note="Asks api.anthropic.com for your real limits every 10 minutes, or when you press Refresh, using your Claude Code login. Off, limits are estimated from this Mac only.">
        {!demo && <Switch checked={exactOn} label="Exact limits from Anthropic" onChange={(on) => setExact(on)} />}
      </Row>
      <Row title="Live limits from Codex" note="Codex writes your plan windows into its transcripts each time you use it, and those are shown by default. On, the dashboard also asks the installed Codex app every 10 minutes, which briefly starts it and asks OpenAI using your Codex login.">
        {!demo && <Switch checked={codexOn} label="Live limits from Codex" onChange={(on) => setCodexExact(on)} />}
      </Row>
      <p className="mt-1 text-detail text-muted">{privacy}</p>
    </Card>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────

function Data() {
  const watching = useLive((s) => s.snap?.watching);
  const searchOn = useLive((s) => s.snap?.prefs?.search !== false);
  const file = useRef<HTMLInputElement>(null);
  const stats = useQuery({ queryKey: ['search-stats', searchOn], queryFn: () => getJson<{ stats: { on: boolean; messages: number; chars: number } }>('/api/search?q='), enabled: !demo, staleTime: 5000 });
  const s = stats.data?.stats;
  const held = s?.on && s.messages ? ` It holds ${s.messages.toLocaleString()} messages now, about ${Math.max(1, Math.round((s.chars * 2) / 1e6))} MB of memory.` : '';
  const text = demo
    ? 'Finds words in what you wrote and what the agents replied. The demo only searches titles.'
    : searchOn
      ? `Finds words in what you wrote and what the agents replied over the last 30 days, from ${MOD.replace('+', '')}K and the Sessions page. Overtime keeps that text in memory for it, never on disk.${held} Off, only titles and projects are searched.`
      : 'Off: only titles and projects are searched, and no conversation text is kept in memory. On again, Overtime reads the transcripts once more, which takes a few seconds.';
  const toggleSearch = async (on: boolean) => {
    try {
      await setServerPrefs({ search: on });
      note(on ? 'Search inside conversations is on. It takes a few seconds to read them' : 'Search inside conversations is off, and its text is gone from memory');
      setTimeout(() => stats.refetch(), on ? 4000 : 300);
    } catch {
      note("Couldn't reach Overtime's server, so search is as it was", { level: 'warn' });
    }
  };
  return (
    <Card>
      <CardHead title="Data" sub="What Overtime reads, and what it keeps" />
      <Row title="Transcripts" note="Read, never changed, on this Mac.">
        <code className="rounded-sm bg-sunken px-1.5 py-0.5 text-detail">{watching?.length ? watching.join(' and ') : '~/.claude/projects'}</code>
      </Row>
      <Row title="Overtime's own files" note="Everything on this page, your names, pins, layouts and plans (settings.json), the hour your day starts and whether search is on (prefs.json), and a summary of each day for the activity heatmap (history.json), so it reaches back past the 30 days your transcripts cover.">
        <code className="rounded-sm bg-sunken px-1.5 py-0.5 text-detail">~/.overtime</code>
      </Row>
      <Row title="Search inside conversations" note={text}>
        <Switch checked={searchOn} label="Search inside conversations" onChange={toggleSearch} />
      </Row>
      <Row title="Back up or start over" note="Save your settings as a file, put a saved copy back, or reset everything to how it was the first time. Resetting asks first.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveCopy}>Save a copy</Button>
          <Button onClick={() => file.current?.click()}>Restore…</Button>
          <Button className="border-bad/40 text-bad hover:bg-bad-soft" onClick={() => useReset.getState().open('reset')}>
            Reset everything…
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) restoreFrom(f);
            }}
          />
        </div>
      </Row>
      <Row title="Pixel office" note="Your agents as pixel-art characters walking around an office. It has its own page.">
        <a href="/office/" target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line bg-card px-3 text-detail font-medium text-ink no-underline hover:bg-sunken">
          Open the office
          <ExternalLink size={13} strokeWidth={2} aria-hidden />
        </a>
      </Row>
    </Card>
  );
}

export function Settings() {
  useChanged();
  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader title="Settings" id="h-settings" sub="Saved on this Mac, in ~/.overtime, so every browser gets them and clearing one doesn't lose them" />
      <div className="grid items-start gap-4 @min-[1000px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Appearance />
          <Sidebar />
          <Personal />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Alerts />
          <PlanLimits />
          <Data />
        </div>
      </div>
    </div>
  );
}
