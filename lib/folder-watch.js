// Says when anything under the transcripts' folders changes, so the server only
// looks for new transcripts and reads the history when there's something to find,
// however many old transcripts there are (Codex never deletes its own). On a Mac
// this is the system's own file events. Where a folder can't be watched (an older
// Node on Linux has no recursive watching), `ok` is false and the server keeps
// looking every few seconds, as it would without this.

import fs from 'node:fs';

/** Watch `folders` (those that exist) and call `onChange` when anything in them changes. */
export function watchFolders(onChange) {
  let watchers = [];
  let ok = false;
  let key = null;

  function close() {
    for (const w of watchers) w.close();
    watchers = [];
  }

  return {
    /** Follow these folders from now on: a no-op when they're the ones already followed. */
    set(folders) {
      const next = [...folders].sort().join('\n');
      if (next === key && ok) return;
      close();
      key = next;
      ok = folders.length > 0;
      for (const dir of folders) {
        try {
          const w = fs.watch(dir, { recursive: true, persistent: false }, () => onChange());
          // A folder deleted or unreachable: back to looking every few seconds until it's set again.
          w.on('error', () => {
            ok = false;
            onChange();
          });
          watchers.push(w);
        } catch {
          ok = false;
        }
      }
      // Whatever happened before the watch began is unknown, so it counts as a change.
      onChange();
    },
    /** Whether every folder is being watched, so a missed change is the only thing a slow check is for. */
    get ok() {
      return ok;
    },
    close,
  };
}
