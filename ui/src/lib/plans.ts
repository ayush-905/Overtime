// What you pay for each provider's plan, and what it's worth: the usage your
// subscription covered, at API list prices, against what you pay each month.
// Saved with your settings, in US dollars.

import { changed } from './bus';
import { DAY, money } from './format';
import { onOtherTab, readJson, writeJson } from './storage';
import type { SpendSummary } from '@/data/types';

const KEY = 'plans';

/** Monthly prices in US dollars, as listed when this was written; any amount works. */
export const PLAN_PRESETS: Record<'claude' | 'codex', [string, string, number][]> = {
  claude: [
    ['pro', 'Pro', 20],
    ['max5', 'Max 5×', 100],
    ['max20', 'Max 20×', 200],
  ],
  codex: [
    ['plus', 'ChatGPT Plus', 20],
    ['pro', 'ChatGPT Pro', 200],
  ],
};

export type Plan = { usd: number; plan: string };
export const plans: Record<'claude' | 'codex', Plan | null> = { claude: null, codex: null };

function load() {
  const saved = readJson<Partial<Record<'claude' | 'codex', { usd?: number; plan?: string } | null>>>(KEY, {});
  for (const p of ['claude', 'codex'] as const) {
    const s = saved[p];
    plans[p] = s?.usd && s.usd > 0 ? { usd: Number(s.usd), plan: String(s.plan || 'custom') } : null;
  }
}
load();

onOtherTab((key) => {
  if (key !== KEY) return;
  load();
  changed('prefs');
});

/** Set what you pay for a provider each month, in US dollars; null for no plan. */
export function setPlan(provider: 'claude' | 'codex', usd: number | null, plan = 'custom') {
  plans[provider] = usd && usd > 0 ? { usd, plan } : null;
  writeJson(KEY, plans, 'prefs');
}

export const planName = (provider: 'claude' | 'codex') => {
  const p = plans[provider];
  return p ? PLAN_PRESETS[provider].find(([id]) => id === p.plan)?.[1] || 'Your plan' : '';
};

export const times = (x: number) => (x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1).replace(/\.0$/, '')}×`);

/** A provider's spend (analytics[view].spend). */
type ProviderSpend = Pick<SpendSummary, 'month' | 'last7' | 'last30'> | null | undefined;

/** The month so far, and where it lands at the pace of the last 7 days. */
export function monthOf(spend: ProviderSpend, now: number) {
  const m = spend?.month;
  if (!m) return null;
  const end = new Date(m.from);
  end.setMonth(end.getMonth() + 1);
  const left = Math.max(0, (end.getTime() - now) / DAY);
  const pace = (spend?.last7?.cost || 0) / 7;
  return { cost: m.cost, partial: m.partial, projected: m.cost + pace * left, lastDay: end.getTime() - DAY, left };
}

export type PlanBlock = {
  provider: 'claude' | 'codex';
  p: Plan;
  ratio: number | null;
  last30: number | null;
  mo: ReturnType<typeof monthOf>;
};

export function planBlock(provider: 'claude' | 'codex', spend: ProviderSpend, now: number): PlanBlock {
  const p = plans[provider]!;
  const last30 = spend?.last30?.cost ?? null;
  return { provider, p, last30, ratio: last30 != null ? last30 / p.usd : null, mo: monthOf(spend, now) };
}

/** Together, and the one thing worth saying about what they're worth. */
export function planInsight(blocks: PlanBlock[], name: (p: string) => string) {
  let together = '';
  if (blocks.length === 2 && blocks.every((b) => b.last30 != null)) {
    const paid = blocks.reduce((n, b) => n + b.p.usd, 0);
    const used = blocks.reduce((n, b) => n + (b.last30 || 0), 0);
    together = `Together: ≈ ${money(used)} of usage for ${money(paid)} a month, ${times(used / paid)}.`;
  }
  const top = [...blocks].sort((a, b) => (b.ratio || 0) - (a.ratio || 0))[0];
  let tip = '';
  if (top.ratio != null && top.ratio >= 1.2)
    tip = `At API prices, the last 30 days would have cost ≈ ${money(top.last30! - top.p.usd)} more than your ${name(top.provider)} plan.`;
  else if (top.ratio != null && top.ratio < 1)
    tip = `You used less than your plan's price at API rates (≈ ${money(top.last30)} of ${money(top.p.usd)}). A smaller plan, or paying per token, could cost less.`;
  const pace = blocks.find((b) => b.mo && b.mo.projected > b.p.usd * 5 && b.mo.left > 3);
  if (!tip && pace)
    tip = `At your pace this month, ${name(pace.provider)} usage lands around ${times(pace.mo!.projected / pace.p.usd)} your plan.`;
  return { together, tip };
}
