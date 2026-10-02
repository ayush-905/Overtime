// Starting over, and a safety net for it, from Settings → Data: save a copy of
// your settings as a file, put one back, or reset everything. Resetting asks
// first, says what goes, offers to save a copy, and wants a tick before its
// button works, since it can't be undone. Every open tab reloads after.

import { useState } from 'react';
import { create } from 'zustand';
import { Copy, TriangleAlert } from 'lucide-react';
import { useLive } from '@/data/live';
import { useHistory } from '@/data/queries';
import { plural } from '@/lib/format';
import { dayParam } from '@/lib/route';
import { Dialog } from '@/components/Dialog';
import { Button } from '@/components/Button';
import { note } from './toasts';

type Copy = { app: string; version?: number; savedAt?: string; settings: Record<string, unknown>; prefs?: Record<string, unknown> };
type ResetState = { mode: 'reset' | 'restore' | null; copy: Copy | null; open: (mode: 'reset' | 'restore', copy?: Copy) => void; close: () => void };

export const useReset = create<ResetState>((set) => ({ mode: null, copy: null, open: (mode, copy) => set({ mode, copy: copy || null }), close: () => set({ mode: null, copy: null }) }));

const send = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'X-Overtime': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

/** Clear this browser's copy too, tell other tabs, and start again from what's on disk. */
function reloadEverywhere() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)!.startsWith('overtime-')) keys.push(localStorage.key(i)!);
    for (const k of keys) localStorage.removeItem(k);
  } catch {}
  try {
    new BroadcastChannel('overtime').postMessage('reload');
  } catch {}
  location.reload();
}

/** Your settings as a file, to keep or to put back later. */
export async function saveCopy() {
  try {
    const saved = await fetch('/api/settings').then((r) => r.json());
    const copy: Copy = { app: 'overtime', version: 1, savedAt: new Date().toISOString(), settings: saved.values || {}, prefs: (useLive.getState().snap?.prefs as Record<string, unknown>) || {} };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }));
    a.download = `overtime-settings-${dayParam(Date.now())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    note('Saved a copy of your settings');
  } catch {
    note("Couldn't get your settings from Overtime's server", { level: 'warn' });
  }
}

/** Read a saved copy and ask before putting it back. */
export async function restoreFrom(file: File) {
  let copy: Copy | null = null;
  try {
    copy = JSON.parse(await file.text());
  } catch {}
  if (copy?.app !== 'overtime' || typeof copy.settings !== 'object' || !copy.settings) {
    note("That file isn't a copy of Overtime's settings", { level: 'warn' });
    return;
  }
  useReset.getState().open('restore', copy);
}

export function ResetDialog() {
  const { mode, copy, close } = useReset();
  const [history, setHistory] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data } = useHistory('all', mode === 'reset');
  const days = Math.max(0, ((data?.days as unknown[]) || []).length - 30);
  const done = () => {
    setSure(false);
    setHistory(false);
    setBusy(false);
    close();
  };
  const reset = async () => {
    setBusy(true);
    try {
      const res = await send('/api/reset', { history });
      if (!res.ok) throw new Error();
      reloadEverywhere();
    } catch {
      setBusy(false);
      note("Couldn't reach Overtime's server, so nothing was reset", { level: 'warn' });
    }
  };
  const putBack = async () => {
    if (!copy) return;
    setBusy(true);
    try {
      const res = await send('/api/settings', { replace: copy.settings });
      if (!res.ok) throw new Error();
      if (copy.prefs && typeof copy.prefs === 'object') await send('/api/prefs', copy.prefs);
      reloadEverywhere();
    } catch {
      setBusy(false);
      note("Couldn't reach Overtime's server, so nothing changed", { level: 'warn' });
    }
  };
  const warn = (text: string) => (
    <p className="flex items-start gap-2 rounded-row bg-bad-soft px-3 py-2.5 text-detail text-bad">
      <TriangleAlert size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
  const saveRow = (text: string) => (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-row border border-line px-3 py-2.5 text-detail">
      <span>{text}</span>
      <Button size="sm" icon={<Copy size={13} strokeWidth={2} aria-hidden />} onClick={saveCopy}>
        Save a copy
      </Button>
    </div>
  );
  if (mode === 'restore' && copy) {
    const when = copy.savedAt ? new Date(copy.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'an earlier date';
    return (
      <Dialog open onOpenChange={(o) => !o && done()} title="Put this copy back?" description={`Saved ${when}, with ${plural(Object.keys(copy.settings).length, 'setting')}`}>
        <div className="flex flex-col gap-4">
          {warn('Your settings now, in every browser on this Mac, are replaced by the ones in this copy. Save a copy of these first if you might want them back.')}
          {saveRow('Keep what you have now too?')}
          <footer className="flex justify-end gap-2">
            <Button onClick={done}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={putBack}>
              {busy ? 'Putting it back…' : 'Put it back'}
            </Button>
          </footer>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog open={mode === 'reset'} onOpenChange={(o) => !o && done()} title="Reset everything?" description="Overtime goes back to how it was the first time you opened it, in every browser on this Mac">
      <div className="flex flex-col gap-4">
        {warn("This can't be undone. Your transcripts aren't touched, and nothing leaves this Mac.")}
        <div>
          <h3 className="mb-1.5 text-detail font-semibold text-muted">What goes</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-detail">
            <li>Session names, pins, notes and tags, your saved views, and your project names and colours</li>
            <li>The Overview's cards, the sidebar, chart styles, the theme and colours, text size and density</li>
            <li>Currency, what you pay for your plans, and the hour your day starts</li>
            <li>Every alert, its settings, and what it has already told you, so some may come once more</li>
          </ul>
        </div>
        <label className="flex items-start gap-2.5 text-detail">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="mt-0.5 size-4 accent-[var(--bad-fill)]" />
          <span>
            <b className="font-semibold">Also delete your activity history</b>
            <small className="block text-muted">
              The days Overtime keeps for the heatmap{days ? `, ${plural(days, 'day')} of it from before the last 30,` : ''} which your transcripts can't bring back. The last 30 days come back on their own.
            </small>
          </span>
        </label>
        {saveRow('Want a way back? Save a copy first, and put it back from Settings any time.')}
        <footer className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-detail">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="size-4" />
            I understand this can't be undone
          </label>
          <span className="grow" />
          <Button onClick={done}>Cancel</Button>
          <Button className="bg-bad-fill text-white hover:opacity-90" disabled={!sure || busy} onClick={reset}>
            {busy ? 'Resetting…' : 'Reset everything'}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
