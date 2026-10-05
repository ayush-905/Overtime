// "?": every keyboard shortcut on the dashboard (keys.tsx has what they do).

import { MOD } from '@/data/hooks';
import { Dialog } from '@/components/Dialog';
import { Kbd } from '@/components/Bits';
import { useUi } from './ui';

const KEYS: [string[], string][] = [
  [[MOD.replace('+', ''), 'K'], 'Open the palette: go anywhere, or run an action'],
  [['/'], "Search the page you're on (the palette, where there's no search)"],
  [['j', 'k'], 'Next and previous row in a list'],
  [['↵'], 'Open the row you’re on'],
  [['t'], 'Switch between light and dark'],
  [[MOD.replace('+', ''), 'B'], 'Hide or show the sidebar'],
  [['Alt', '↑', '↓'], 'Move the sidebar section you’re on up or down'],
  [[MOD.replace('+', ''), 'Z'], 'Undo the change you just made, while its note shows'],
  [['⌘', '['], 'Back, in the Mac app (⌘] for forward)'],
  [['Esc'], 'Close a panel or dialog, or clear a search'],
  [['?'], 'This list'],
];

export function KeysDialog() {
  const open = useUi((s) => s.keysOpen);
  const setOpen = useUi((s) => s.setKeysOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Keyboard shortcuts"
      description="Anywhere on the dashboard, except while you're typing"
    >
      <dl className="grid gap-2.5">
        {KEYS.map(([keys, what]) => (
          <div key={what} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
            <dt className="flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dt>
            <dd className="text-detail">{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
