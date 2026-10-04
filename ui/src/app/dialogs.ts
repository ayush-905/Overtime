// Which of the dialogs that load later (later.tsx) is open, and with what: making
// a prompt into a command, comparing two sessions, a project's name and colour,
// and resetting or putting back your settings. Small, so the page knows about
// them from the start: Back closes them, and anything can open one.

import { create } from 'zustand';
import type { Repeat } from '@/pages/You';

/** Making a prompt you repeat into a slash command (CommandDialog.tsx). */
export const useCommand = create<{ group: Repeat | null; open: (g: Repeat) => void; close: () => void }>((set) => ({
  group: null,
  open: (group) => set({ group }),
  close: () => set({ group: null }),
}));

type CompareState = { picks: [string | null, string | null]; picking: 0 | 1 | null; open: boolean; show: (a?: string | null, b?: string | null) => void; close: () => void };

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
export const useProjectDialog = create<{ name: string | null; open: (name: string) => void; close: () => void }>((set) => ({
  name: null,
  open: (name) => set({ name }),
  close: () => set({ name: null }),
}));

/** A saved copy of your settings, as a file. */
export type SettingsCopy = { app: string; version?: number; savedAt?: string; settings: Record<string, unknown>; prefs?: Record<string, unknown> };
type ResetState = { mode: 'reset' | 'restore' | null; copy: SettingsCopy | null; open: (mode: 'reset' | 'restore', copy?: SettingsCopy) => void; close: () => void };

/** Resetting everything, or putting a saved copy back (ResetDialog.tsx). */
export const useReset = create<ResetState>((set) => ({ mode: null, copy: null, open: (mode, copy) => set({ mode, copy: copy || null }), close: () => set({ mode: null, copy: null }) }));
