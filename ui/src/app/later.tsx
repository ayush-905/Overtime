// What opens only now and then (the session panel, the palette, the dialogs, the
// sidebar's drag to reorder) is left out of what the page loads first, so the
// window and the popover start sooner. Each part loads the first time it's
// wanted, and in a quiet moment after startup anyway (loadLater), so it's there
// by the time you open it and opens at once.

import { useEffect, useState, type ComponentType } from 'react';

const waiting: (() => Promise<unknown>)[] = [];

/**
 * A part that loads later. Until it's here it draws `Before` (or nothing), then
 * itself. A load that fails (a newer build since the page opened) is tried again
 * the next time it's wanted.
 */
export function later<P extends object>(load: () => Promise<ComponentType<P>>, Before?: ComponentType<P>) {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<unknown> | null = null;
  const get = () =>
    (loading ||= load().then(
      (c) => {
        loaded = c;
      },
      (error) => {
        loading = null;
        console.error(error);
      },
    ));
  waiting.push(get);
  function Later(props: P) {
    const [, redraw] = useState(0);
    useEffect(() => {
      if (!loaded) get().then(() => loaded && redraw((n) => n + 1));
    }, []);
    const Part = loaded || Before;
    return Part ? <Part {...props} /> : null;
  }
  return Later;
}

/** Load every later part in the first quiet moment after startup. */
export function loadLater() {
  const all = () => {
    for (const get of waiting) get();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(all, { timeout: 3000 });
  else setTimeout(all, 1500);
}
