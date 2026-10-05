// Buttons, as the parts sheet has them: a plain one with a border (most), the
// primary one (ink, for the one thing a dialog is for), a quiet one with no border
// (in toolbars and headers), and a link that reads as text with an arrow.

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

type Variant = 'plain' | 'primary' | 'quiet';
type Size = 'sm' | 'md';

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:opacity-40';
const variants: Record<Variant, string> = {
  plain: 'border border-line bg-card text-ink hover:bg-sunken',
  primary: 'bg-accent text-on-accent font-semibold hover:opacity-90',
  quiet: 'text-ink hover:bg-sunken',
};
const sizes: Record<Size, string> = { sm: 'h-7 px-2.5 text-detail', md: 'h-8 px-3 text-detail' };
const iconSizes: Record<Size, string> = { sm: 'size-7', md: 'size-8' };

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'plain', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
});

/** A button that's only an icon: it needs a label (aria-label), which is also its tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Props & { label: string; tip?: string }>(function IconButton(
  { variant = 'plain', size = 'md', label, tip, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-tip={tip ?? label}
      className={cx(base, variants[variant], iconSizes[size], 'text-muted hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
});

/** A link that reads as text: "All sessions →". */
export function TextLink({ className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cx('text-detail font-medium text-ink no-underline hover:underline', className)} {...rest}>
      {children}
    </a>
  );
}
