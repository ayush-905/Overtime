// A tiny change signal: settings and labels say when they change (from this tab
// or another), and React redraws what reads them (useChanged in data/hooks.ts).

type Listener = (topic: string) => void;

const listeners = new Set<Listener>();
let version = 0;

export function onChange(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Something that pages read changed: 'prefs' (currency, clock, measure…), 'labels' (names, pins, notes, tags), 'nav', 'appearance'. */
export function changed(topic: string) {
  version++;
  for (const fn of listeners) fn(topic);
}

export const changeVersion = () => version;
