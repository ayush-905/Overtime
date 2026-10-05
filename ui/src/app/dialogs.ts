// Which of the dialogs that load later (later.tsx) is open, and with what: making
// a prompt into a command, comparing two sessions, a project's name and colour,
// resetting or putting back your settings, arranging a page's cards, and a card
// expanded. Small, so the page knows about them from the start: Back closes
// them, and anything can open one. The palette, the shortcuts, the weekly
// digest and Customize belong to the shell, in ui.ts.

import { create } from 'zustand';
import type { RepeatedPrompt } from '@/data/types';

/** The commands you've made from prompts you repeat, by prompt, saved with your settings. */
export const MADE_KEY = 'commands-made';
export type MadeCommands = Record<string, { name: string; target: string; at?: number }>;

/** Making a prompt you repeat into a slash command (CommandDialog.tsx). */
export const useCommand = create<{
  group: RepeatedPrompt | null;
  open: (g: RepeatedPrompt) => void;
  close: () => void;
}>((set) => ({
  group: null,
  open: (group) => set({ group }),
  close: () => set({ group: null }),
}));

type CompareState = {
  picks: [string | null, string | null];
  picking: 0 | 1 | null;
  open: boolean;
  show: (a?: string | null, b?: string | null) => void;
  close: () => void;
};

/** Two sessions side by side (CompareDialog.tsx). */
export const useCompare = create<CompareState>((set) => ({
  picks: [null, null],
  picking: 0,
  open: false,
  show: (a = null, b = null) => {
    const picks: [string | null, string | null] = [a, b && b !== a ? b : null];
    set({ open: true, picks, picking: picks[0] ? (picks[1] ? null : 1) : 0 });
  },
  close: () => set({ open: false }),
}));

/** A project's name and colour (ProjectDialog.tsx). */
export const useProjectDialog = create<{ name: string | null; open: (name: string) => void; close: () => void }>(
  (set) => ({
    name: null,
    open: (name) => set({ name }),
    close: () => set({ name: null }),
  }),
);

/** A saved copy of your settings, as a file. */
export type SettingsCopy = {
  app: string;
  version?: number;
  savedAt?: string;
  settings: Record<string, unknown>;
  prefs?: Record<string, unknown>;
};
type ResetState = {
  mode: 'reset' | 'restore' | null;
  copy: SettingsCopy | null;
  open: (mode: 'reset' | 'restore', copy?: SettingsCopy) => void;
  close: () => void;
};

/** Resetting everything, or putting a saved copy back (ResetDialog.tsx). */
export const useReset = create<ResetState>((set) => ({
  mode: null,
  copy: null,
  open: (mode, copy) => set({ mode, copy: copy || null }),
  close: () => set({ mode: null, copy: null }),
}));

export type Arranging = { page: string; title: string; cards: { id: string; name: string; span: number }[] } | null;

/** Putting a page's cards in your order (ArrangeDialog.tsx, from "Arrange" in PageGrid.tsx). */
export const useArrange = create<{ arranging: Arranging; open: (a: Arranging) => void }>((set) => ({
  arranging: null,
  open: (arranging) => set({ arranging }),
}));

/** A card expanded to fill most of the window (cards/Expand.tsx), by its id. */
export const useExpand = create<{ card: string | null; set: (card: string | null) => void }>((set) => ({
  card: null,
  set: (card) => set({ card }),
}));
