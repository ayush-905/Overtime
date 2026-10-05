// How the app tells that it's Overtime answering on a port, and not
// something else there: see server-host.js.

/** Overtime's answer on a port, or null if it isn't there. */
export async function hello(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hello`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return body?.app === 'overtime' ? body : null;
  } catch {
    return null;
  }
}
