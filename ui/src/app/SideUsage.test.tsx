import { beforeEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuotaItem } from '@/lib/limits';

const quota = vi.hoisted(() => ({ items: [] as QuotaItem[] }));
vi.mock('@/data/scope', () => ({ useQuota: () => ({ items: quota.items }) }));
import { SideUsage } from './SideUsage';

beforeEach(() => { quota.items = []; });

test('the sidebar keeps its Usage link when no readings are available', () => {
  const full = renderToStaticMarkup(<SideUsage folded={false} />);
  expect(full).toContain('Usage left, open Usage');
  expect(full).toContain('no reading yet');
  expect(renderToStaticMarkup(<SideUsage folded />)).toContain('Usage left, open Usage');
});

test('all windows show in the sidebar, and the folded rail shows the lowest allowance', () => {
  const reading = { resetsAt: null, source: 'exact', stale: false, limited: false, outlook: null, observedAt: 0 };
  quota.items = [
    { ...reading, provider: 'claude', id: 'claude:session', label: '5-hour', usedPercent: 4 },
    { ...reading, provider: 'claude', id: 'claude:weekly', label: 'Weekly', usedPercent: 33 },
    { ...reading, provider: 'codex', id: 'codex:primary', label: '5-hour', usedPercent: 32 },
    { ...reading, provider: 'codex', id: 'codex:secondary', label: 'Weekly', usedPercent: null },
  ];
  const full = renderToStaticMarkup(<SideUsage folded={false} />);
  expect(full.match(/role="meter"/g)).toHaveLength(4);
  expect(full).toContain('96%');
  expect(full).toContain('67%');
  expect(full).toContain('68%');
  expect(full).toContain('No reading');
  const folded = renderToStaticMarkup(<SideUsage folded />);
  expect(folded).toContain('67%');
  expect(folded).toContain('68%');
  expect(folded).not.toContain('>96%</b>');
});
