// The transcript sources Overtime reads, in the order they're shown. Claude
// Code's sessions go by their own id; the others' carry their source in front
// of it (`codex-<id>`, `pi-<id>`), so ids never collide.

export const SOURCES = ['claude', 'codex', 'pi'];

/** Any session id the routes take: a Claude Code or Codex uuid, or a pi session id (a uuid unless you named it). */
export const SESSION_ID = /^(?:(?:codex-)?[0-9a-f-]{36}|pi-[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?)$/;

/** The session's id in its own transcripts, without Overtime's prefix. */
export const nativeIdOf = (id) => String(id).replace(/^(?:codex|pi)-/, '');
