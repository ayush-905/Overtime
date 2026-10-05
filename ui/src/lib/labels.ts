// What you call your sessions: a name you gave one, the ones you pinned, a note on
// one, and its tags, all saved with your settings. Every card shows a session's title
// through `titleFor`, so a rename shows up everywhere at once.

import { changed } from './bus';

const NAMES_KEY = 'overtime-session-names';
const PINS_KEY = 'overtime-pinned';
const NOTES_KEY = 'overtime-session-notes';
const TAGS_KEY = 'overtime-session-tags';
export const LABEL_KEYS = [NAMES_KEY, PINS_KEY, NOTES_KEY, TAGS_KEY];
export const MAX_TAGS = 8;
export const MAX_NOTE = 2000;

let names: Record<string, string> = {};
let pins = new Set<string>();
let notes: Record<string, string> = {};
let tags: Record<string, string[]> = {};

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) || 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadLabels() {
  names = read(NAMES_KEY, {}) || {};
  pins = new Set(read<string[]>(PINS_KEY, []));
  notes = read(NOTES_KEY, {}) || {};
  tags = read(TAGS_KEY, {}) || {};
}
loadLabels();

function save(key: string, value: unknown, empty = false) {
  try {
    if (empty) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// A title made from your first message reads better without the greeting.
// A greeting only counts when it's clearly one: followed by a comma, a name, or the request itself.
const GREETING =
  /^(?:hi+|hey+|hello|yo|hiya)(?:\s*[,!.]+|\s+(?:bro|there|claude|codex|pi|buddy|man|team)\b[\s,!.]*|(?=\s+(?:i|i'm|im|so|can|could|would|please|kindly|pls|we|need|let's|lets)\b))\s*/i;
const ASKING = /^(?:(?:can|could|would|will) you\s+(?:please\s+|kindly\s+|pls\s+)?|(?:please|kindly|pls)\s+)/i;

/** A title without "hi bro", "can you please" and the like in front, when enough is left. */
export function tidyTitle(title: string | null | undefined) {
  const text = String(title || '').trim();
  let t = text.replace(GREETING, '');
  t = t.replace(ASKING, '').trim();
  if (t.length < 8 || t === text) return text;
  return t[0].toUpperCase() + t.slice(1);
}

/** A session's title: the name you gave it, else its own, tidied. */
export function titleFor(id: string | null | undefined, fallback: string | null | undefined) {
  return (id && names[id]) || tidyTitle(fallback) || 'Untitled session';
}

export const customName = (id: string) => names[id] || '';
export const isPinned = (id: string) => pins.has(id);

/** Give a session a name, or clear it with an empty one. */
export function rename(id: string, name: string) {
  const clean = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (clean) names[id] = clean;
  else delete names[id];
  save(NAMES_KEY, names);
  changed('labels');
}

export function togglePin(id: string) {
  if (pins.has(id)) pins.delete(id);
  else pins.add(id);
  save(PINS_KEY, [...pins]);
  changed('labels');
}

export const noteFor = (id: string | null | undefined) => (id && notes[id]) || '';

/** Write a note on a session, or clear it with an empty one. */
export function setNote(id: string, text: string) {
  const clean = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim()
    .slice(0, MAX_NOTE);
  if (clean === noteFor(id)) return;
  if (clean) notes[id] = clean;
  else delete notes[id];
  save(NOTES_KEY, notes, !Object.keys(notes).length);
  changed('labels');
}

export const tagsFor = (id: string | null | undefined) => (id && tags[id]) || [];

/** A tag as it's kept: a short label, no commas, spaces tidied. */
export const cleanTag = (tag: string) =>
  String(tag || '')
    .replace(/[,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);

/** Every tag you've used, the most used first, with how many sessions have it. */
export function allTags(): [string, number][] {
  const count = new Map<string, number>();
  for (const list of Object.values(tags)) for (const t of list) count.set(t, (count.get(t) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Give a session these tags. A tag you've used before keeps the way you wrote it first. */
export function setTags(id: string, list: string[]) {
  const known = new Map(allTags().map(([t]) => [t.toLowerCase(), t]));
  const next: string[] = [];
  for (const raw of list) {
    const t = cleanTag(raw);
    if (!t || next.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    next.push(known.get(t.toLowerCase()) || t);
  }
  const kept = next.slice(0, MAX_TAGS);
  if (JSON.stringify(kept) === JSON.stringify(tagsFor(id))) return;
  if (kept.length) tags[id] = kept;
  else delete tags[id];
  save(TAGS_KEY, tags, !Object.keys(tags).length);
  changed('labels');
}

export const hasTag = (id: string, tag: string) =>
  tagsFor(id).some((t) => t.toLowerCase() === String(tag).toLowerCase());
