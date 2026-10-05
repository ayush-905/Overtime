// Light, dark, or follow the system. Each page applies the saved choice in its
// <head> before the first paint; this wires up the buttons, the T shortcut
// (see toggleTheme) and keeps open pages in step.

const KEY = 'overtime-theme';
const dark = window.matchMedia('(prefers-color-scheme: dark)');

let buttons = null;
let current = 'auto';

function apply(choice) {
  current = choice === 'light' || choice === 'dark' ? choice : 'auto';
  if (current === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = current;
  for (const b of buttons?.querySelectorAll('[data-theme-choice]') || [])
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === current));
}

/** Light, dark or auto (the same as the system), saved. */
export function setTheme(choice) {
  apply(choice);
  try {
    if (current === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, current);
  } catch {}
}

export const themeChoice = () => current;

/** What's on screen: light or dark, whichever way it was chosen. */
export const shownTheme = () => (current === 'auto' ? (dark.matches ? 'dark' : 'light') : current);

/** Switch between light and dark; from auto, to the opposite of what's showing. Returns what it was. */
export function toggleTheme() {
  const before = current;
  setTheme(shownTheme() === 'dark' ? 'light' : 'dark');
  return before;
}

/** `group` holds buttons with data-theme-choice="light|auto|dark". */
export function initTheme(group) {
  buttons = group;
  let choice = 'auto';
  try {
    choice = localStorage.getItem(KEY) || 'auto';
  } catch {}
  apply(choice);
  group?.addEventListener('click', (e) => {
    const next = e.target.closest('[data-theme-choice]')?.dataset.themeChoice;
    if (next) setTheme(next);
  });
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) apply(e.newValue || 'auto');
  });
}

/** T, anywhere but a field you're typing in, switches between light and dark. */
export function isThemeKey(e) {
  return (
    e.key?.toLowerCase() === 't' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    !e.target.closest?.('input, textarea, select, [contenteditable]')
  );
}
