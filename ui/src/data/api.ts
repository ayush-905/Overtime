// Talking to the Overtime server. Actions are POSTs with the X-Overtime
// header, which forces a CORS preflight no other website can pass, so only this
// page can trigger them.

export const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error(`${path} answered ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}

/** An action on the server; `body`, if given, goes as JSON. */
export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'X-Overtime': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`${path} answered ${res.status}`), { status: res.status });
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
