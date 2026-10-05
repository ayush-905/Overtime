// Your settings in the browser's storage, under overtime-* keys, which
// @shared/settings.js keeps in ~/.overtime/settings.json too. Everything the
// dashboard saves goes through here. A key is named without its prefix ('clock'
// is overtime-clock); storage that's off or full (a private window) reads as
// nothing saved; a saved value that no longer makes sense gives the usual one;
// and a change goes to the server at once, not at its next check. A write can
// say on the bus (lib/bus.ts) what changed, so whatever shows it redraws.

import { settingsChanged, stopSettingsSync } from '@shared/settings.js';
import { changed } from './bus';

const PREFIX = 'overtime-';

/** A setting as saved, or null. */
export function readSetting(key: string): string | null;
/** A setting, if it's one of `allowed`; else `fallback`. */
export function readSetting<T extends string | null>(key: string, fallback: T, allowed: readonly T[]): T;
export function readSetting(key: string, fallback: string | null = null, allowed?: readonly (string | null)[]) {
  let value: string | null = null;
  try {
    value = localStorage.getItem(PREFIX + key);
  } catch {}
  if (value == null) return fallback;
  return !allowed || allowed.includes(value) ? value : fallback;
}

/**
 * A setting saved as JSON, or `fallback` when there's none, it doesn't parse, it
 * isn't the same kind of thing as `fallback` (a number where an object should be),
 * or `check` turns it down.
 */
export function readJson<T>(key: string, fallback: T, check?: (value: unknown) => boolean): T {
  try {
    const value = JSON.parse(readSetting(key) || 'null');
    return value != null && typeof value === typeof fallback && (!check || check(value)) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Save a setting, or forget it with null. `topic` says on the bus what changed ('prefs', 'labels'…). */
export function writeSetting(key: string, value: string | null, topic?: string) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
    settingsChanged();
  } catch {}
  if (topic) changed(topic);
}

/** Save a setting as JSON, or forget it with null. */
export const writeJson = (key: string, value: unknown, topic?: string) =>
  writeSetting(key, value == null ? null : JSON.stringify(value), topic);

export const removeSetting = (key: string, topic?: string) => writeSetting(key, null, topic);

/** Another tab changed a setting: `fn` hears which (its key without the prefix) and its new value. Gives back a way to stop listening. */
export function onOtherTab(fn: (key: string, value: string | null) => void) {
  if (typeof window === 'undefined') return () => {};
  const on = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) fn(e.key.slice(PREFIX.length), e.newValue);
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}

/**
 * Forget every setting in this browser, before the page starts again from what's
 * on disk (after a reset, or putting back a saved copy). The server already has
 * the new ones, so nothing is sent: forgetting them here mustn't forget them there.
 */
export function forgetAllSettings() {
  stopSettingsSync();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
