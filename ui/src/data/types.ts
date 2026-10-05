// The shapes the server sends. Each is defined once, in types/api.d.ts at the
// repo's root, which the server's own code is checked against (npm run
// check:server); this re-exports them, so the dashboard imports them from here.

import type { Source as ApiSource } from '../../../types/api';
import type { Source as UiSource } from '@/lib/sources';

export type * from '../../../types/api';

/** The dashboard's sources (lib/sources.ts) and the server's are the same ones: this fails to compile when they part. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type SourcesAgree = Assert<Same<UiSource, ApiSource>>;
