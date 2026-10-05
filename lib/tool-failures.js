// Why a tool call failed, in a few words that group well: the shell command's
// program and exit code, read the way Claude Code and pi report them.

// Commands that are better told apart by their first argument, like `npm test` or `git push`.
const SUBCOMMANDS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'bun',
  'git',
  'node',
  'python',
  'python3',
  'go',
  'cargo',
  'docker',
  'make',
  'gh',
  'kubectl',
]);

/**
 * The program whose exit code a shell command reports, without its arguments:
 * the last command (the last part of a pipeline), since that's where the exit
 * code comes from. `cd app && npm test` → `npm test`. `simple` is false for
 * multi-step commands, where the failing step can't be known.
 */
export function shellInfo(command) {
  const lines = String(command || '')
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const line = (lines.some((l) => l.includes('<<')) ? lines[0] : lines[lines.length - 1]) || '';
  const statements = line
    .split(/&&|\|\||;/)
    .map((x) => x.trim())
    .filter(Boolean);
  const parts = (statements[statements.length - 1] || '').split(/\s\|\s/);
  const words = parts[parts.length - 1]
    .split(/\s+/)
    .filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && w !== 'sudo');
  const name = words[0]?.split('/').pop() || null;
  return {
    program: name && SUBCOMMANDS.has(name) && words[1] && !words[1].startsWith('-') ? `${name} ${words[1]}` : name,
    simple: lines.length === 1 && statements.length === 1 && parts.length === 1,
  };
}

// Exit code 1 from these means "no match" or "they differ", not that something broke.
const NO_MATCH = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'diff', 'cmp', 'test', '[', 'pgrep', 'which']);
const EXIT_REASONS = {
  124: 'Timed out',
  126: 'Not allowed to run',
  127: 'Command not found',
  130: 'Interrupted',
  137: 'Killed (memory or time limit)',
  143: 'Stopped',
};
const OUTPUT_REASONS = [
  [/no such file or directory|cannot access|does not exist/i, 'File or folder not found'],
  [/no matches found/i, 'A file pattern matched nothing'],
  [/command not found/i, 'Command not found'],
  [/permission denied|operation not permitted/i, 'Blocked by file permissions'],
  [/illegal option|invalid option|unrecognized (option|argument)|unknown option|usage:/i, 'Wrong command options'],
  [/Traceback \(most recent call last\)/, 'Python error'],
  [/\d+ (failing|failed)\b|Tests?:\s+\d+ failed|^FAIL\s/im, 'Tests failed'],
  [/error TS\d+|\d+ problems? \(\d+ errors?/i, 'Type or lint errors'],
];

/** A short, groupable reason for a failed tool call; null when it didn't really fail, '' when unknown. */
export function failReason(call, text) {
  const tag = text.match(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/);
  if (tag)
    return tag[1]
      .split(/(?<=\.)\s/)[0]
      .trim()
      .slice(0, 80);
  const exit = text.match(/^Exit code (\d+)/);
  if (!exit) return '';
  const code = Number(exit[1]);
  if (code === 1 && NO_MATCH.has(call.program)) return null;
  if (EXIT_REASONS[code]) return EXIT_REASONS[code];
  for (const [pattern, reason] of OUTPUT_REASONS) if (pattern.test(text)) return reason;
  return call.simple && call.program
    ? `${call.program} exited with code ${code}`
    : `Multi-step shell command exited with code ${code}`;
}
