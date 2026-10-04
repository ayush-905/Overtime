// Text that counts up as you watch ("45s", "3m", "2h 5m"), kept up to the second
// by the shared clock (data/hooks.ts). Each is a small part of its own, so only
// its text is drawn again each second, not the card or panel around it.

import type { ReactNode } from 'react';
import { useNow } from '@/data/hooks';
import { serverNow } from '@/lib/env';
import { ago } from '@/lib/format';

/** How long ago `t` was, by the server's clock: "45s", "3m", "2h 5m". */
export function Ago({ t }: { t: number }) {
  useNow();
  return <>{ago(Math.max(0, serverNow() - t))}</>;
}

/** What `children` makes of the time (by the server's clock), drawn again each second: for a line with an "x ago" in it. */
export function EachSecond({ children }: { children: (now: number) => ReactNode }) {
  useNow();
  return <>{children(serverNow())}</>;
}
