import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Select } from 'radix-ui';
import { cx } from './cx';

type Option = { value: string; label: string };

/** A themed filter menu with keyboard navigation, typeahead and a visible selection. */
export function Dropdown({ label, value, options, onChange, className }: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    // Prefix all values so the "all" filter isn't Radix's reserved empty placeholder.
    <Select.Root value={`v${value}`} onValueChange={(next) => onChange(next.slice(1))}>
      <Select.Trigger aria-label={label} className={cx('filter-dropdown inline-flex h-8 min-w-0 items-center justify-between gap-3 rounded-control border border-line bg-card pl-3 pr-2.5 text-detail text-ink hover:border-line-strong data-[state=open]:border-accent', className)}>
        <span className="min-w-0 truncate"><Select.Value /></span>
        <Select.Icon className="shrink-0 text-muted"><ChevronDown size={15} strokeWidth={1.8} aria-hidden /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={6} collisionPadding={12} className="filter-dropdown-menu z-[3500] overflow-hidden rounded-row border border-line bg-raised p-1 text-detail text-ink shadow-raised">
          <Select.ScrollUpButton className="grid h-6 place-items-center text-muted"><ChevronUp size={14} aria-hidden /></Select.ScrollUpButton>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item key={option.value} value={`v${option.value}`} textValue={option.label} className="relative flex min-h-9 cursor-pointer items-center rounded-sm py-2 pl-3 pr-9 outline-none data-[highlighted]:bg-sunken data-[state=checked]:font-semibold">
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2.5 grid place-items-center"><Check size={15} strokeWidth={2} aria-hidden /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="grid h-6 place-items-center text-muted"><ChevronDown size={14} aria-hidden /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
