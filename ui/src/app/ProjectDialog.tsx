// A project's name and colour, on this dashboard only: opened from a project's
// page. Twelve colours around the wheel, or "Auto" (one from its name). Saving
// can be undone.

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { projectHue, projectName } from '@/lib/format';
import { projectPref, setProjectPref } from '@/lib/prefs';
import { Dialog } from '@/components/Dialog';
import { Button } from '@/components/Button';
import { cx } from '@/components/cx';
import { offerUndo } from './toasts';
import { useProjectDialog } from './dialogs';

const HUES = [0, 25, 45, 90, 140, 170, 195, 215, 240, 265, 295, 330];

function save(name: string, alias: string, hue: number | null | undefined) {
  const before = projectPref(name);
  const next = alias.trim();
  if (next === (before.alias || '') && hue === before.hue) return;
  setProjectPref(name, { alias: next, hue });
  const label = projectName(name);
  offerUndo(next && next !== before.alias ? `Renamed ${name} to ${label}` : `Updated ${label}`, () =>
    setProjectPref(name, { alias: before.alias || '', hue: before.hue }),
  );
}

export function ProjectDialog() {
  const name = useProjectDialog((s) => s.name);
  const close = useProjectDialog((s) => s.close);
  // It opens with the project's own (and again if another is opened).
  const [alias, setAlias] = useState(() => (name && projectPref(name).alias) || '');
  const [hue, setHue] = useState<number | null>(() =>
    name && Number.isFinite(projectPref(name).hue) ? (projectPref(name).hue as number) : null,
  );
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!name) return;
    const pref = projectPref(name);
    setAlias(pref.alias || '');
    setHue(Number.isFinite(pref.hue) ? (pref.hue as number) : null);
  }, [name]);
  if (!name)
    return (
      <Dialog open={false} onOpenChange={() => {}} title="Name and colour">
        {null}
      </Dialog>
    );
  const pref = projectPref(name);
  const shown = hue ?? projectHue(name);
  const done = (next: { alias: string; hue: number | null }) => {
    close();
    save(name, next.alias, next.hue);
  };
  const swatch = 'grid size-8 place-items-center rounded-full border-2 outline-offset-2';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Name and colour"
      description={
        <>
          For the project in the folder <b className="text-ink">{name}</b>, on this dashboard only
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          done({ alias, hue });
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-detail font-semibold">Name</span>
          <input
            ref={field}
            autoFocus
            onFocus={(e) => e.target.select()}
            type="text"
            maxLength={60}
            placeholder={name}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-9 rounded-control border border-line bg-card px-3 text-body outline-none focus:border-accent"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-detail font-semibold">Colour</span>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={hue == null}
              onClick={() => setHue(null)}
              data-tip="From its name"
              className={cx(
                'h-8 rounded-full border-2 px-3 text-detail font-semibold',
                hue == null ? 'border-ink' : 'border-line',
              )}
            >
              Auto
            </button>
            {HUES.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={hue === h}
                aria-label={`Hue ${h}`}
                onClick={() => setHue(h)}
                className={cx(swatch, hue === h ? 'border-ink' : 'border-transparent')}
                style={{ background: `hsl(${h} 55% 50%)` }}
              >
                {hue === h && <Check size={14} strokeWidth={3} className="text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
        <p className="flex items-center gap-2 rounded-row bg-sunken px-3 py-2 text-body">
          <i className="size-2.5 rounded-full" style={{ background: `hsl(${shown} 55% 50%)` }} />
          <b>{alias.trim() || name}</b>
        </p>
        <footer className="flex items-center gap-2">
          {(pref.alias || Number.isFinite(pref.hue)) && (
            <button
              type="button"
              className="text-detail font-semibold text-accent hover:underline"
              onClick={() => done({ alias: '', hue: null })}
            >
              Use its own name and colour
            </button>
          )}
          <span className="grow" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
