// A dialog over the page: Radix's, so focus stays inside and Esc closes it, with
// the dashboard's header (a title, what it's for, tools and a close button).

import type { ReactNode } from 'react';
import { Dialog as Radix } from 'radix-ui';
import { X } from 'lucide-react';
import { cx } from './cx';

/** `bare`: no header, for content that has its own (an expanded card); the title is only for screen readers, and the close button sits in the corner. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  tools,
  children,
  className,
  wide,
  bare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  bare?: boolean;
}) {
  const close = (
    <Radix.Close
      aria-label="Close"
      data-tip="Close (Esc)"
      className={cx(
        'grid size-8 place-items-center rounded-control text-muted hover:bg-sunken hover:text-ink',
        bare && 'absolute right-3 top-3 z-10',
      )}
    >
      <X size={16} strokeWidth={2} aria-hidden />
    </Radix.Close>
  );
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-[3000] bg-[var(--scrim)]" />
        <Radix.Content
          className={cx(
            'fixed left-1/2 top-[10vh] z-[3001] flex max-h-[80vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-line bg-raised text-ink shadow-raised outline-none',
            wide ? 'max-w-[960px]' : 'max-w-[560px]',
            className,
          )}
        >
          {bare ? (
            <>
              <Radix.Title className="sr-only">{title}</Radix.Title>
              <Radix.Description className="sr-only">{description || title}</Radix.Description>
              {close}
            </>
          ) : (
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Radix.Title className="text-title font-semibold">{title}</Radix.Title>
                {description ? (
                  <Radix.Description className="text-detail text-muted">{description}</Radix.Description>
                ) : (
                  <Radix.Description className="sr-only">{title}</Radix.Description>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {tools}
                {close}
              </div>
            </header>
          )}
          <div className={cx('min-h-0 overflow-y-auto overscroll-contain', !bare && 'px-5 py-4')}>{children}</div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
