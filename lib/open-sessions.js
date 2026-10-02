// Open agent sessions: every Claude Code (and Codex) process running on this Mac,
// matched to its session, with the memory and CPU it and the MCP servers and tools
// it started are using. Sampled at most every 10 s, and only while a page is open,
// with `ps` and `lsof`. CPU is the share of one core, like Activity Monitor.

import path from 'node:path';
import { execFile } from 'node:child_process';

const SAMPLE_MS = 10_000;
// Judged by the executable's own name: the desktop app's launcher passes the agent's path in its arguments.
const AGENT_EXE = new Set(['claude', 'codex']);
const AGENT_SCRIPT = /@anthropic-ai\/claude-code\/cli\.m?js|@openai\/codex/;
const CLOCK_SLACK_MS = 60_000; // a session's first line can land a moment before ps's start time rounds

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

/** `ps` TIME or ETIME, like 1-02:03:04.56 or 12:34, in seconds. */
function seconds(text) {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  return rest.split(':').reduce((n, part) => n * 60 + Number(part), 0) + Number(days) * 86_400;
}

/**
 * `sessions()` lists known sessions ({ id, dir, firstAt, lastAt, title, project }),
 * `live(id)` gives the office's current view of one, if it's there.
 */
export function createSessionMonitor({ sessions, live }) {
  let latest = null;
  let busy = false;
  let samples = 0;
  let lastCpu = new Map();
  let lastT = 0;

  async function sample() {
    const now = Date.now();
    const [ps, exes] = await Promise.all([
      run('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,etime=,args=']),
      run('ps', ['-A', '-o', 'pid=,comm=']), // the executable's path, which can contain spaces
    ]);
    const exeOf = new Map();
    for (const line of (exes || '').split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (m) exeOf.set(+m[1], m[2].trim().split('/').pop());
    }
    const procs = [];
    for (const line of (ps || '').split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (m) procs.push({ pid: +m[1], ppid: +m[2], rss: +m[3] * 1024, cpu: seconds(m[4]), startedAt: now - seconds(m[5]) * 1000, args: m[6] });
    }
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    const isAgent = (p) => p.pid !== process.pid && (AGENT_EXE.has(exeOf.get(p.pid)) || (exeOf.get(p.pid) === 'node' && AGENT_SCRIPT.test(p.args)));
    const ownChild = (p) => {
      for (let q = p, n = 0; q && n < 30; q = byPid.get(q.ppid), n++) if (q.ppid === process.pid) return true;
      return false;
    };
    const sourceOf = (p) => exeOf.get(p.pid) === 'codex' || /@openai\/codex/.test(p.args) ? 'codex' : 'claude';
    const isShared = (p) => sourceOf(p) === 'codex' && /\bapp-server\b/.test(p.args);
    const agentProcs = procs.filter((p) => isAgent(p) && !ownChild(p) && !(sourceOf(p) === 'codex' && /\b(?:sandbox|mcp-server|exec-server)\b/.test(p.args)));

    // Each agent's folder, in one lsof call.
    const cwdOf = new Map();
    if (agentProcs.length) {
      const out = await run('lsof', ['-a', '-d', 'cwd', '-p', agentProcs.map((p) => p.pid).join(','), '-Fpn']);
      let pid = null;
      for (const line of (out || '').split('\n')) {
        if (line[0] === 'p') pid = Number(line.slice(1));
        else if (line[0] === 'n' && pid) cwdOf.set(pid, line.slice(1));
      }
    }

    // What each agent started: MCP servers, shells and commands.
    const agentPids = new Set(agentProcs.map((p) => p.pid));
    const toolsOf = new Map(agentProcs.map((p) => [p.pid, []]));
    for (const p of procs) {
      if (agentPids.has(p.pid) || p.pid === process.pid) continue;
      for (let q = byPid.get(p.ppid), hops = 0; q && hops < 20; q = byPid.get(q.ppid), hops++) {
        if (agentPids.has(q.pid)) { toolsOf.get(q.pid).push(p); break; }
      }
    }
    const wall = lastT ? (now - lastT) / 1000 : 0;
    const cpuPct = (list) => {
      let s = 0;
      let known = false;
      for (const p of list) {
        const before = lastCpu.get(p.pid);
        if (before == null) continue;
        s += Math.max(0, p.cpu - before);
        known = true;
      }
      return wall && known ? (s / wall) * 100 : null;
    };

    // Match processes to sessions. A resumed one names its session; a new or
    // cleared one starts a fresh session in its folder, so it gets the first
    // session there that began after the process did. Youngest first, so a newer
    // process doesn't lose its session to an older one that hasn't sent anything.
    const known = sessions();
    const byId = new Map(known.map((s) => [s.id, s]));
    const claimed = new Set();
    const matched = new Map();
    for (const p of agentProcs) {
      const native = p.args.match(/(?:--(?:resume|session-id)[= ]|\bresume +)([0-9a-f-]{36})/)?.[1];
      const id = native ? (sourceOf(p) === 'codex' ? `codex-${native}` : native) : null;
      if (id && byId.has(id) && !claimed.has(id)) {
        matched.set(p.pid, id);
        claimed.add(id);
      }
    }
    for (const p of [...agentProcs].sort((a, b) => b.startedAt - a.startedAt)) {
      if (matched.has(p.pid) || isShared(p)) continue;
      const dir = cwdOf.get(p.pid)?.replace(/[^a-zA-Z0-9]/g, '-');
      const next = known
        .filter((s) => s.source === sourceOf(p) && s.dir === dir && s.firstAt != null && s.firstAt >= p.startedAt - CLOCK_SLACK_MS && !claimed.has(s.id))
        .sort((a, b) => a.firstAt - b.firstAt)[0];
      if (next) {
        matched.set(p.pid, next.id);
        claimed.add(next.id);
      }
    }

    const rows = agentProcs.map((p) => {
      const id = matched.get(p.pid) || null;
      const s = id ? byId.get(id) : null;
      const view = id ? live(id) : null;
      const tools = toolsOf.get(p.pid);
      const cwd = cwdOf.get(p.pid) || null;
      const status = !id ? 'new' : view?.needsYou ? 'needs' : ['working', 'thinking', 'replying'].includes(view?.status) ? 'working' : 'idle';
      return {
        pid: p.pid,
        source: sourceOf(p),
        shared: isShared(p),
        id,
        title: view?.title || s?.title || null,
        project: view?.project || s?.project || (cwd ? path.basename(cwd) : null),
        openedAt: p.startedAt,
        lastActive: Math.max(view?.lastActivity || 0, s?.lastAt || 0) || null,
        status,
        inOffice: !!view?.present,
        memBytes: p.rss,
        toolsMemBytes: tools.reduce((n, t) => n + t.rss, 0),
        tools: tools.length,
        cpuPct: cpuPct([p, ...tools]),
      };
    });
    const sharedRuntimes = rows.filter((r) => r.shared);
    const sessionRows = rows.filter((r) => !r.shared);
    if (sharedRuntimes.length) for (const s of known) {
      if (s.source !== 'codex' || claimed.has(s.id)) continue;
      const v = live(s.id);
      if (!v?.present) continue;
      sessionRows.push({ id: s.id, source: 'codex', title: v.title || s.title, project: v.project || s.project,
        status: v.needsYou ? 'needs' : ['working', 'thinking', 'replying'].includes(v.status) ? 'working' : 'idle',
        openedAt: s.firstAt, lastActive: v.lastActivity, memBytes: null, toolsMemBytes: null, cpuPct: null, runtimeShared: true });
    }
    const order = { needs: 0, working: 1, idle: 2, new: 3 };
    sessionRows.sort((a, b) => order[a.status] - order[b.status] || (b.lastActive || b.openedAt) - (a.lastActive || a.openedAt));
    lastCpu = new Map(procs.map((p) => [p.pid, p.cpu]));
    lastT = now;
    latest = { sampledAt: now, everyMs: SAMPLE_MS, sessions: sessionRows, sharedRuntimes };
  }

  return {
    /** Take a new sample if the last one is old enough; never blocks the caller. */
    tick() {
      // CPU needs two samples, so the second one comes quickly.
      const wait = samples === 1 ? 2000 : SAMPLE_MS;
      if (busy || (latest && Date.now() - latest.sampledAt < wait)) return;
      busy = true;
      sample().then(() => { samples++; }).catch(() => {}).finally(() => { busy = false; });
    },
    latest: () => latest,
  };
}
