// A running index of the last 31 days of Claude Code, Codex and pi usage: every
// request's cost and tokens (with its cache use and context size), which
// project, model and session it belongs to, lines changed by edits, every tool
// call and whether it failed or you denied it, when you sent messages,
// compactions, the moments a plan limit was hit, the skills agents were offered
// and the ones used, and (unless search is off) the text of the conversations,
// for searching them. It powers the plan-limit estimate and the insights, and
// only rereads what changed.

import { promises as fsp } from 'node:fs';
import { openHarnesses } from './harnesses/index.js';

const DAY = 86_400_000;
const CHUNK_BYTES = 4 * 1024 * 1024;
// What search keeps of each message: plenty to find it by, without holding whole essays.
const TEXT_CAP = { you: 4000, agent: 6000 };

/** A message's text for search: one line of it, trimmed to what search keeps. */
export const searchable = (text, who) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_CAP[who] || 4000);

/** A query as the words (or "quoted phrases") every match must have, lowercased. */
export function queryTerms(q) {
  const terms = [];
  for (const m of String(q || '')
    .toLowerCase()
    .matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term) terms.push(term);
  }
  return terms.slice(0, 8);
}

/** A short piece of `text` around the first of the terms, cut at word boundaries, without Markdown's ** and `. */
export function snippet(raw, terms, width = 150) {
  const text = raw.replace(/\*\*|__|`+/g, '');
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (text.length <= width) return text;
  // A few words before the match, so it's near the start where a narrow row still shows it.
  let from = Math.max(0, at - 28);
  let to = Math.min(text.length, from + width);
  from = Math.max(0, to - width);
  if (from > 0) from = text.indexOf(' ', from) + 1 || from;
  if (to < text.length) to = text.lastIndexOf(' ', to) > from ? text.lastIndexOf(' ', to) : to;
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/**
 * `harnesses` are the open harnesses to read (openHarnesses()); without them,
 * the ones whose folders are given, as tests do.
 */
export function createUsageIndex({ harnesses, claudeDir, codexDir, piDir, piHome, days = 31, keepText = true }) {
  const open = harnesses || openHarnesses({ dirs: { claude: claudeDir, codex: codexDir, pi: piDir }, piHome });
  const bySource = new Map(open.map((h) => [h.id, h]));
  // path → record. Events are [t, cost, tokens, model, record, detail], where detail
  // holds cache use and context size; edits are [t, added, removed, record].
  const files = new Map();
  let textOn = keepText;
  let busy = false;
  let version = 0;
  const cache = { version: -1 };
  let scanned = false;
  const scoped = new Map();

  function record(file, source, info) {
    return {
      file,
      source,
      ...info,
      size: 0,
      mtimeMs: 0,
      offset: 0,
      leftover: null,
      seen: new Set(),
      events: [],
      hits: [],
      edits: [],
      compactions: [],
      lastT: 0,
      calls: [],
      callById: new Map(),
      prompts: [],
      project: null,
      rooted: false,
      cwd: null,
      title: null,
      customTitle: null,
      aiTitle: null,
      agentName: null,
      firstPrompt: null,
      work: [],
      model: null,
      tokenTotal: null,
      quotas: {},
      quotaLog: [],
      // Skills: [t, name, 'you' | 'agent', id, dir]; the latest list it was offered; and search's text, [t, 'you' | 'agent', text].
      skills: [],
      skillList: null,
      keepText: textOn,
      texts: [],
      textSeen: new Set(),
      // Lines already read: a transcript can have its conversation written into it
      // again (the Claude app does when a session moves folder), with the same ids.
      lineSeen: new Set(),
    };
  }

  /** A message's text, for search; each only once, however often its line is written. */
  function addText(f, t, who, text, key) {
    if (!t || !text) return;
    if (key) {
      if (f.textSeen.has(key)) return;
      f.textSeen.add(key);
    }
    const kept = searchable(text, who);
    if (kept) f.texts.push([t, who, kept]);
  }

  function parseLines(f, text) {
    const { indexLine } = bySource.get(f.source);
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        indexLine(f, line, addText);
      } catch {}
    }
    version++;
  }

  async function readFile(file, st, source, info) {
    let f = files.get(file);
    // Search was turned back on: read the whole file again for its text, while the old record stands in.
    const again = f && textOn && !f.keepText;
    if (f && !again && f.size === st.size && f.mtimeMs === st.mtimeMs) return;
    const fresh = !f || again || st.size < f.offset;
    if (fresh) f = record(file, source, info);
    const fh = await fsp.open(file, 'r');
    try {
      // In pieces, so a big transcript never sits in memory all at once. Lines are
      // cut at newline bytes, which never fall inside a multi-byte character.
      while (f.offset < st.size) {
        const len = Math.min(CHUNK_BYTES, st.size - f.offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, f.offset);
        if (!bytesRead) break;
        f.offset += bytesRead;
        const data = f.leftover ? Buffer.concat([f.leftover, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        const cut = data.lastIndexOf(10);
        f.leftover = Buffer.from(cut === -1 ? data : data.subarray(cut + 1));
        if (cut !== -1) parseLines(f, data.subarray(0, cut).toString('utf8'));
      }
    } finally {
      await fh.close();
    }
    f.size = st.size;
    f.mtimeMs = st.mtimeMs;
    if (fresh) {
      files.set(file, f);
      version++;
    }
  }

  async function scan() {
    if (busy) return;
    busy = true;
    const cutoff = Date.now() - days * DAY;
    const alive = new Set();
    try {
      for (const h of open) {
        await h.refresh?.();
        for await (const { file, st, ...info } of h.transcripts(cutoff)) {
          alive.add(file);
          try {
            await readFile(file, st, h.id, info);
          } catch {}
        }
        // A harness that keeps its chats' names apart from their transcripts (Codex).
        if (!h.titleOf) continue;
        for (const f of files.values()) {
          if (f.source !== h.id) continue;
          const name = h.titleOf(f.nativeId);
          if (f.title !== name) {
            f.title = name;
            version++;
          }
        }
      }
      for (const file of files.keys()) {
        if (!alive.has(file)) {
          files.delete(file);
          version++;
        }
      }
      // Resolve nested subagents to their root session after all metadata is read.
      const byId = new Map([...files.values()].filter((f) => f.id).map((f) => [f.id, f]));
      for (const f of files.values())
        if (f.parentId) {
          let parent = f.parentId;
          const visited = new Set([f.id]);
          while (byId.get(parent)?.parentId && !visited.has(parent)) {
            visited.add(parent);
            parent = byId.get(parent).parentId;
          }
          f.session = parent;
        }
      scanned = true;
    } finally {
      busy = false;
    }
  }

  function merged() {
    if (cache.version === version) return cache;
    const events = [];
    const edits = [];
    const hits = [];
    const compactions = [];
    const calls = [];
    const prompts = [];
    const quotaLog = [];
    const skills = [];
    const skillSeen = new Set(); // a forked session repeats its parent's skills
    for (const f of files.values()) {
      for (const x of f.skills) {
        const key = `${f.source}:${x[3]}`;
        if (skillSeen.has(key)) continue;
        skillSeen.add(key);
        skills.push({ t: x[0], name: x[1], by: x[2], dir: x[4], rec: f });
      }
      for (const e of f.events) events.push(e);
      for (const q of f.quotaLog || []) quotaLog.push(q);
      for (const e of f.edits) edits.push(e);
      for (const c of f.calls) calls.push(c);
      for (const p of f.prompts) prompts.push(p);
      hits.push(...f.hits);
      compactions.push(...f.compactions);
    }
    events.sort((a, b) => a[0] - b[0]);
    edits.sort((a, b) => a[0] - b[0]);
    calls.sort((a, b) => a.t - b.t);
    prompts.sort((a, b) => a[0] - b[0]);
    hits.sort((a, b) => a.t - b.t);
    compactions.sort((a, b) => a.t - b.t);
    quotaLog.sort((a, b) => a[0] - b[0]);
    skills.sort((a, b) => a.t - b.t);
    Object.assign(cache, { version, events, edits, hits, compactions, calls, prompts, quotaLog, skills });
    return cache;
  }

  /** The main session's record, for titles; falls back to any record of that session. */
  function sessionRecord(session) {
    let fallback = null;
    for (const f of files.values()) {
      if (f.session !== session) continue;
      if (!f.sub) return f;
      fallback ||= f;
    }
    return fallback;
  }

  // Subagents often run inside a subfolder, so they belong to their session's project.
  const projectCache = { version: -1, bySession: new Map() };
  function projectOf(rec) {
    if (projectCache.version !== version) {
      projectCache.version = version;
      projectCache.bySession = new Map();
      for (const f of files.values()) if (!f.sub && f.project) projectCache.bySession.set(f.session, f.project);
    }
    return projectCache.bySession.get(rec.session) || rec.project || 'Unknown';
  }

  const api = {
    scan,
    events: () => merged().events,
    edits: () => merged().edits,
    hits: () => merged().hits,
    compactions: () => merged().compactions,
    calls: () => merged().calls,
    prompts: () => merged().prompts,
    /** Every skill used: { t, name, by: 'you' | 'agent', dir, rec }, oldest first. Commands that aren't skills are in here too, until checked against the skills on offer. */
    skills: () => merged().skills,
    /** The latest list of skills each session was offered: { t, names, about, files?, rec }. */
    skillLists: () => [...files.values()].filter((f) => f.skillList).map((f) => ({ ...f.skillList, rec: f })),
    /** Whether search keeps the conversations' text. Turning it back on reads every transcript again. */
    searchOn: () => textOn,
    setSearch(on) {
      if (on === textOn) return;
      textOn = on;
      // Off: forget the text now. On: the next scan reads every file again for it.
      if (!on)
        for (const f of files.values()) {
          f.keepText = false;
          f.texts = [];
          f.textSeen = new Set();
        }
      version++;
    },
    /** The full text of a message you sent at `t` in `rec`, while search keeps it. */
    youTextAt(rec, t) {
      if (!rec?.texts?.length) return null;
      if (rec.textIndex?.length !== rec.texts.length)
        rec.textIndex = {
          length: rec.texts.length,
          byT: new Map(rec.texts.filter((x) => x[1] === 'you').map((x) => [x[0], x[2]])),
        };
      return rec.textIndex.byT.get(t) || null;
    },
    /** How much text search holds: messages and characters. */
    searchStats() {
      let messages = 0;
      let chars = 0;
      for (const f of files.values())
        for (const x of f.texts) {
          messages++;
          chars += x[2].length;
        }
      return { on: textOn, messages, chars };
    },
    /**
     * Messages with every word of `q` in them (or "a phrase"), from your side
     * and the agents', grouped by session, the latest first. Main sessions only.
     */
    search(q, { source = 'all', limit = 40, perSession = 3 } = {}) {
      const terms = queryTerms(q);
      if (!terms.length || !textOn) return { terms, results: [], total: 0 };
      const bySession = new Map();
      let total = 0;
      for (const f of files.values()) {
        if (f.sub || (source !== 'all' && f.source !== source)) continue;
        for (const [t, who, text] of f.texts) {
          const lower = text.toLowerCase();
          if (!terms.every((term) => lower.includes(term))) continue;
          total++;
          let s = bySession.get(f.session);
          if (!s)
            bySession.set(
              f.session,
              (s = { session: f.session, source: f.source, rec: f, count: 0, lastAt: 0, hits: [] }),
            );
          s.count++;
          s.lastAt = Math.max(s.lastAt, t);
          s.hits.push([t, who, text]);
        }
      }
      const results = [...bySession.values()]
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, limit)
        .map((s) => ({
          session: s.session,
          source: s.source,
          title: s.rec.agentName || s.rec.title || s.rec.firstPrompt || null,
          project: projectOf(s.rec),
          count: s.count,
          lastAt: s.lastAt,
          hits: s.hits
            .sort((a, b) => b[0] - a[0])
            .slice(0, perSession)
            .map(([t, who, text]) => ({ t, who, text: snippet(text, terms) })),
        }));
      return { terms, results, total, sessions: bySession.size };
    },
    /** Every reading of Codex's plan windows, oldest first: [t, bucket, kind, % used, resets at]. */
    quotaLog: () => merged().quotaLog,
    sessionRecord,
    /** Every record of one session: its main transcript and its subagents'. */
    recordsOf: (session) => [...files.values()].filter((f) => f.session === session || f.id === session),
    projectOf,
    version: () => version,
    ready: () => scanned,
    work: () => [...files.values()].flatMap((f) => f.work.map((w) => ({ ...w, rec: f, sub: f.sub }))),
    /** The latest report of each Codex quota bucket across all sessions, as one set; null before the first. */
    quota() {
      const latest = {};
      for (const f of files.values()) {
        for (const [bucket, q] of Object.entries(f.quotas || {}))
          if (!latest[bucket] || q.t > latest[bucket].t) latest[bucket] = q;
      }
      const reports = Object.values(latest);
      if (!reports.length) return null;
      return {
        t: Math.max(...reports.map((q) => q.t)),
        value: {
          rateLimitsByLimitId: Object.fromEntries(Object.entries(latest).map(([bucket, q]) => [bucket, q.value])),
        },
      };
    },
    /** Every main session of the last 31 days: its folder, first and last activity, and title. */
    sessions() {
      const out = [];
      for (const f of files.values()) {
        if (f.sub) continue;
        const firstAt = Math.min(f.prompts[0]?.[0] ?? Infinity, f.events[0]?.[0] ?? Infinity);
        const lastAt = Math.max(f.prompts[f.prompts.length - 1]?.[0] ?? 0, f.events[f.events.length - 1]?.[0] ?? 0);
        out.push({
          id: f.session,
          nativeId: f.nativeId || f.session,
          source: f.source,
          cwd: f.cwd,
          dir: f.dirName,
          firstAt: Number.isFinite(firstAt) ? firstAt : null,
          lastAt: lastAt || null,
          title: f.agentName || f.title || f.firstPrompt || null,
          project: projectOf(f),
        });
      }
      return out;
    },
    scope(source) {
      if (!source || source === 'all') return api;
      if (scoped.has(source)) return scoped.get(source);
      const view = { ...api, source };
      for (const [key, recordOf] of Object.entries({
        events: (e) => e[4],
        edits: (e) => e[3],
        calls: (e) => e.rec,
        prompts: (e) => e[1],
        compactions: (e) => e.rec,
        work: (e) => e.rec,
        skills: (e) => e.rec,
        skillLists: (e) => e.rec,
      })) {
        let v = -1,
          items = [];
        view[key] = () => {
          if (v !== version) {
            items = api[key]().filter((e) => recordOf(e).source === source);
            v = version;
          }
          return items;
        };
      }
      view.hits = () => (source === 'claude' ? api.hits() : []);
      view.sessions = () => api.sessions().filter((s) => s.source === source);
      scoped.set(source, view);
      return view;
    },
  };
  return api;
}
