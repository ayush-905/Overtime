// Prompts you keep typing: the same request (or nearly: the same words, in any
// order, give or take a few) sent on occasions an hour or more apart over the last 30 days,
// worth making into a slash command. Each group comes with a command to make of
// it: a name, a line about it, and the prompt, with the part that changes each
// time (a number, a link, the end of the sentence) as $ARGUMENTS.
//
// A resumed or forked session copies the conversation so far into a new
// transcript, so the same message at the same moment counts once.

import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DAY = 86_400_000;
const MIN_WORDS = 4;
const MIN_TOKENS = 3;
const SIMILAR = 0.6; // share of their words two prompts must have in common
// Closer together than this, it's one occasion: trying again, or sending the same thing to a few agents at once.
const APART_MS = 60 * 60_000;
const STOP = new Set(`a an the and or but to of in on at for with by from up out into over is are was were be been being am it its this that these those there here i me my mine you your yours we us our they them their he she his her can could would will shall should may might must do does did done doing have has had having not no yes ok okay oh so just also too very really some any all each more most other another such same than then now what which who whom whose how why when where if as let lets let's please kindly pls plz hi hey hello bro thanks thank sure like want need make get go one two`.split(' '));

const cache = new WeakMap(); // an index view → { version, day, made, value }
let made = 0; // commands written, so a new one's name shows as taken at once

/** A prompt's words, lowercased, with links, paths, numbers and ids made alike. */
export function promptWords(text) {
  return String(text || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' <link> ')
    .replace(/(?:^|\s)(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g, ' <path> ')
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\b/g, ' <id> ')
    .replace(/\d+/g, ' <n> ')
    .replace(/[^\p{L}\p{N}<>\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** The words that say what a prompt is about: no little words, no placeholders. */
const contentOf = (words) => [...new Set(words.filter((w) => w.length > 1 && !STOP.has(w) && !w.startsWith('<')))];

function jaccard(a, b) {
  let shared = 0;
  const small = a.size <= b.size ? a : b;
  const big = small === a ? b : a;
  for (const w of small) if (big.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const VERBS = new Set('add analyse analyze audit build check clean compare create debug deploy document draft explain find fix improve list migrate plan pull push refactor remove rename review run split summarize summarise test update validate verify write'.split(' '));
const AGENTS = new Set(['claude', 'codex', 'agent', 'ai', 'gpt']);

/** A command name from what the prompt asks: its first verb and the two words after it ("pull-github-pr"), else its first words that say something. */
function nameFor(words) {
  const content = contentOf(words).filter((w) => /^[a-z][a-z0-9]*$/.test(w) && !AGENTS.has(w));
  const verb = content.findIndex((w) => VERBS.has(w));
  const picked = verb !== -1 ? content.slice(verb, verb + 3) : content.slice(0, 2);
  return (picked.join('-') || 'my-prompt').slice(0, 32);
}

// "Hi claude," and the like in front of a prompt don't belong in a command.
const GREETING = /^(?:(?:hi+|hey+|hello|yo)\b[\s,!.]*(?:(?:bro|claude|codex|team|buddy|there(?=[,!.]))\b[\s,!.]*)*)+/i;
// Nor does asking nicely: "can you please", "kindly".
const ASKING = /^(?:(?:can|could|would|will) you\s+(?:please\s+|kindly\s+|pls\s+)?|(?:please|kindly|pls)\s+)/i;
const tidy = (text) => text.trim().replace(GREETING, '').replace(ASKING, '').replace(/^\w/, (c) => c.toUpperCase()) || text.trim();

/**
 * The prompt as a command: what every example starts and ends with, and
 * $ARGUMENTS for the part between that changes. With nothing changing, it's
 * the latest example as it was, with its link (if it has one) as $ARGUMENTS.
 */
/** With nothing else changing, a link is what will: it becomes $ARGUMENTS. */
function withLink(text) {
  const link = text.match(/https?:\/\/\S+[^\s.,;:!?)]/)?.[0];
  return link ? { body: text.replace(link, '$ARGUMENTS'), argument: true } : { body: text, argument: false };
}

export function commandBody(examples) {
  const split = examples.map((t) => t.trim().split(/\s+/));
  if (split.length < 2) return withLink(examples[0].trim());
  // Words match whatever their case and the punctuation around them.
  const key = (w) => (w || '').toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, '');
  const keys = split.map((w) => w.map(key));
  const first = keys[0];
  let head = 0;
  while (head < first.length && keys.every((w) => w[head] !== undefined && w[head] === first[head])) head++;
  let tail = 0;
  while (keys.every((w) => w.length - tail - 1 >= head && first.length - tail - 1 >= head && w[w.length - tail - 1] === first[first.length - tail - 1])) tail++;
  const same = keys.every((w) => w.length === head + tail);
  // One command with an argument only when most of it stays the same, from the start.
  if (same || !head || head + tail < MIN_WORDS || head + tail < first.length * 0.5) return withLink(examples[0].trim());
  const words = split[0];
  return { body: [...words.slice(0, head), '$ARGUMENTS', ...words.slice(words.length - tail)].join(' '), argument: true };
}

const COMMAND_DIRS = {
  claude: () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'commands'),
  codex: () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'prompts'),
};

/** Where a command of that name would go, for Claude Code (~/.claude/commands) or Codex (~/.codex/prompts). */
export const commandFile = (target, name) => path.join(COMMAND_DIRS[target](), `${name}.md`);

/**
 * Groups of prompts you sent on at least two occasions in the last 30 days,
 * the most worth a command first (how often, times how long). `index` is a
 * usage index view; `textOf(rec, t)` finds a message's full text when search
 * keeps it, since the index itself keeps only its start.
 */
export function repeatedPrompts(index, now = Date.now(), textOf = () => null) {
  const day = Math.floor(now / (10 * 60_000));
  const hit = cache.get(index);
  if (hit && hit.version === index.version() && hit.day === day && hit.made === made) return hit.value;
  const since = now - 30 * DAY;
  const seen = new Set();
  const items = [];
  for (const [t, rec, kind, short] of index.prompts()) {
    if (kind !== 'human' || rec.sub || t < since || t > now || !short) continue;
    const text = textOf(rec, t) || short;
    const key = `${t}:${text.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (text.startsWith('/')) continue;
    const words = promptWords(text);
    const content = contentOf(words);
    if (words.length < MIN_WORDS || content.length < MIN_TOKENS || content.length > 80) continue;
    items.push({ t, rec, text, words, set: new Set(content), exact: words.join(' ') });
  }
  // Group: the same words, or most of them. Pairs come from shared words that
  // aren't in most prompts, so this stays quick with thousands of them.
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byWord = new Map();
  items.forEach((it, i) => { for (const w of it.set) (byWord.get(w) || byWord.set(w, []).get(w)).push(i); });
  const common = Math.max(15, items.length * 0.05);
  const tried = new Set();
  for (const list of byWord.values()) {
    if (list.length < 2 || list.length > common) continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a];
        const j = list[b];
        const pair = i * items.length + j;
        if (tried.has(pair)) continue;
        tried.add(pair);
        if (items[i].exact === items[j].exact || jaccard(items[i].set, items[j].set) >= SIMILAR) parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map();
  items.forEach((it, i) => (groups.get(find(i)) || groups.set(find(i), []).get(find(i))).push(it));
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.t - a.t);
    // Occasions an hour or more apart. Retrying, or asking a few agents the same thing at once, isn't repeating.
    const occasions = [];
    for (const it of [...list].reverse()) {
      const last = occasions[occasions.length - 1];
      if (last && it.t - last.t < APART_MS) continue;
      occasions.push(it);
    }
    if (occasions.length < 2) continue;
    const examples = [...new Set(list.map((it) => tidy(it.text)))].slice(0, 3);
    const { body, argument } = commandBody(examples);
    const sources = {};
    for (const it of occasions) sources[it.rec.source] = (sources[it.rec.source] || 0) + 1;
    const source = (sources.codex || 0) > (sources.claude || 0) ? 'codex' : 'claude';
    const sessions = new Set(occasions.map((it) => it.rec.session));
    const words = Math.round(list.reduce((n, it) => n + it.words.length, 0) / list.length);
    out.push({
      key: [...list[list.length - 1].set].sort().slice(0, 12).join(' '),
      count: occasions.length,
      sessions: sessions.size,
      days: new Set(occasions.map((it) => new Date(it.t).toDateString())).size,
      lastAt: list[0].t,
      firstAt: list[list.length - 1].t,
      words,
      exact: new Set(list.map((it) => it.exact)).size === 1,
      sources,
      source,
      projects: [...new Set(occasions.map((it) => index.projectOf(it.rec)).filter((p) => p && p !== 'Unknown'))].slice(0, 3),
      examples: examples.map((e) => e.slice(0, 600)),
      body: body.slice(0, 4000),
      argument,
      name: nameFor(list[0].words),
      description: examples[0].replace(/\s+/g, ' ').slice(0, 90),
    });
  }
  out.sort((a, b) => b.count * Math.min(b.words, 40) - a.count * Math.min(a.words, 40) || b.lastAt - a.lastAt);
  const top = out.slice(0, 12);
  // Names are unique among them, and say whether a command of that name exists already.
  const taken = new Set();
  for (const g of top) {
    let name = g.name;
    for (let n = 2; taken.has(name); n++) name = `${g.name}-${n}`;
    taken.add(name);
    g.name = name;
    g.exists = { claude: existsSync(commandFile('claude', name)), codex: existsSync(commandFile('codex', name)) };
  }
  const value = { prompts: items.length, groups: top };
  cache.set(index, { version: index.version(), day, made, value });
  return value;
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Write a command file: Claude Code's in ~/.claude/commands, or a Codex prompt
 * in ~/.codex/prompts. Only a new file, never over one that's there, and only
 * when you ask from the dashboard. Returns where it went, or why it didn't.
 */
export async function writeCommand({ target, name, description = '', body }, { fs } = {}) {
  const fsp = fs || (await import('node:fs')).promises;
  if (!COMMAND_DIRS[target]) return { ok: false, status: 400, message: 'Pick Claude Code or Codex' };
  if (!NAME.test(String(name || ''))) return { ok: false, status: 400, message: 'A name is lowercase letters, numbers and dashes, up to 40' };
  const text = String(body || '').trim();
  if (!text || text.length > 20_000) return { ok: false, status: 400, message: 'The prompt is empty, or too long' };
  const about = String(description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const file = commandFile(target, name);
  const front = [
    '---',
    about ? `description: ${JSON.stringify(about)}` : null,
    text.includes('$ARGUMENTS') ? 'argument-hint: "[what changes each time]"' : null,
    '---',
  ].filter(Boolean);
  const content = `${front.length > 2 ? `${front.join('\n')}\n\n` : ''}${text}\n`;
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    // "wx" fails if the file is there already, so nothing is ever overwritten.
    await fsp.writeFile(file, content, { flag: 'wx', mode: 0o644 });
  } catch (error) {
    if (error.code === 'EEXIST') return { ok: false, status: 409, message: `There's already a ${target === 'codex' ? 'Codex prompt' : 'command'} called ${name}`, file };
    return { ok: false, status: 500, message: `Couldn't write ${file}: ${error.message}` };
  }
  made++;
  return { ok: true, file, content, use: target === 'codex' ? `/prompts:${name}` : `/${name}` };
}
