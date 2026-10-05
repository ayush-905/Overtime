// Where you are, in the address: `#sessions?project=shop&range=7` opens the
// Sessions page with those filters, so a view can be bookmarked, shared with
// another tab, or opened straight from a card or the Mac app.

export type Params = Record<string, string>;

/** A link to a section, with its filters. Empty values are left out. */
export function pageLink(page: string, params: Record<string, string | number | null | undefined> = {}) {
  const q = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  );
  const text = q.toString();
  return `#${page}${text ? `?${text}` : ''}`;
}

/** `#sessions?range=7` → { page: 'sessions', params: { range: '7' } }. */
export function parseHash(hash = location.hash): { page: string; params: Params } {
  const [page, query = ''] = hash.replace(/^#/, '').split('?');
  return { page, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** Keep the address in step with a page's filters, without a new history entry. */
export function replaceParams(page: string, params: Record<string, string | number | null | undefined>) {
  if (parseHash().page !== page) return;
  const next = pageLink(page, params);
  if (next !== location.hash) history.replaceState(history.state, '', next);
}

/** A day as the address writes it: 2026-09-24, in local time. */
export const dayParam = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Midnight of a day written as 2026-09-24, or null. */
export function parseDay(text: string | null | undefined) {
  const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(t) ? t : null;
}
