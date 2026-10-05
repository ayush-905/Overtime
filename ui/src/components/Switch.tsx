// An on/off switch, Radix's, for Settings and Customize.

import { Switch as RadixSwitch } from 'radix-ui';

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent"
    >
      <RadixSwitch.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-card shadow-card transition-transform data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}
