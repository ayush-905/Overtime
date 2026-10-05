// What the formatting reads: the clock you chose, when your working day starts,
// the currency and your names and colours for projects, how far this machine's
// clock is from the server's, the section on screen and what things are compared
// by. Your settings (lib/prefs.ts, lib/measure.ts), the live feed (data/live.ts)
// and the router keep it up to date; the functions in format.ts read it, so they
// work the same inside React and out.

export type Currency = {
  code: string;
  symbol: string;
  rate: number;
  locale: string;
  whole: boolean;
  rates: Record<string, number>;
};

export type ProjectPref = { alias?: string; hue?: number | null };

export const env = {
  clock24: false,
  workdayHour: 4,
  timeOffset: 0,
  currency: { code: 'USD', symbol: '$', rate: 1, locale: 'en-US', whole: false, rates: {} } as Currency,
  projects: {} as Record<string, ProjectPref>,
  /** The section on screen: the Cost page always counts money (see measure.ts). */
  page: 'overview',
  /** What things are compared by. */
  measure: 'cost' as 'cost' | 'tokens',
};

/** Now, by the server's clock. */
export const serverNow = () => Date.now() - env.timeOffset;
