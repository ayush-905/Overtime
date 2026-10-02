// A segmented control: a few choices side by side, one picked. Radix's toggle
// group, so the arrow keys move between them.

import { ToggleGroup } from 'radix-ui';
import type { CSSProperties } from 'react';
import { cx } from './cx';

type Option<T extends string> = readonly [T, string] | { value: T; label: string; tip?: string };

export function Seg<T extends string>({ label, value, options, onChange, size = 'md', className, fill }: { label: string; value: T; options: readonly Option<T>[]; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string; fill?: boolean }) {
  const items = options.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1], tip: undefined } : o) as { value: T; label: string; tip?: string });
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className={cx('seg-control inline-grid gap-0.5 rounded-[9px] bg-sunken p-[3px]', fill && 'grid w-full', className)}
      // Each at least as wide as its label, so none wraps; equal when there's room.
      style={{ '--seg-columns': items.length } as CSSProperties}
    >
      {items.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          data-slot="seg-item"
          data-tip={o.tip}
          className={cx(
            'whitespace-nowrap rounded-[7px] text-muted transition-colors hover:text-ink data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-ink data-[state=on]:shadow-card',
            size === 'sm' ? 'h-6 px-2.5 text-label' : 'h-7 px-3 text-detail',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
