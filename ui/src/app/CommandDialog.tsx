// Making a prompt you repeat into a slash command: name it, say what it's for and
// edit the prompt, with $ARGUMENTS for the part that changes. Create writes it
// where the agent reads commands (~/.claude/commands for Claude Code,
// ~/.codex/prompts for Codex, ~/.pi/agent/prompts for Pi). Nothing is written
// until you press Create, and never over a file that's there.

import { useEffect, useState } from 'react';
import { Copy, Folder, TriangleAlert } from 'lucide-react';
import { demo } from '@/data/api';
import { copyText } from '@/lib/copy';
import { Dialog } from '@/components/Dialog';
import { Button } from '@/components/Button';
import { Seg } from '@/components/Seg';
import { cx } from '@/components/cx';
import { readJson, writeJson } from '@/lib/storage';
import { SOURCE, commandUse, isSource, type Source } from '@/lib/sources';
import { useSources } from '@/data/scope';
import { note } from './toasts';
import { MADE_KEY, useCommand, type MadeCommands } from './dialogs';

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export function CommandDialog() {
  const g = useCommand((s) => s.group);
  const close = useCommand((s) => s.close);
  const sources = useSources();
  // It opens with the prompt's own (and again if another is opened).
  const [target, setTarget] = useState<Source>(() => (g && isSource(g.source) ? g.source : 'claude'));
  const [name, setName] = useState(() => g?.name || '');
  const [description, setDescription] = useState(() => g?.description || '');
  const [body, setBody] = useState(() => g?.body || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!g) return;
    setTarget(isSource(g.source) ? g.source : 'claude');
    setName(g.name);
    setDescription(g.description);
    setBody(g.body);
    setError('');
    setBusy(false);
  }, [g]);
  const agent = SOURCE[target].name;
  const { dir, prefix, reads, ready } = SOURCE[target].commands;
  const valid = NAME.test(name);
  const exists = !!g?.exists?.[target] && name === g?.name;
  const hasArg = body.includes('$ARGUMENTS');
  const shown = commandUse(target, valid ? name : 'its-name');
  const make = async () => {
    if (!g || !valid || exists || demo || !body.trim()) return;
    setBusy(true);
    let res: { ok?: boolean; message?: string; use?: string } | null = null;
    // The server says why it refused (a file already there, a name it won't take) in the body, whatever the status.
    try {
      const r = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'X-Overtime': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, name, description, body }),
      });
      res = await r.json().catch(() => null);
    } catch {}
    setBusy(false);
    if (!res?.ok) {
      setError(res?.message || "Couldn't reach Overtime's server, so nothing was written");
      return;
    }
    writeJson(
      MADE_KEY,
      { ...readJson<MadeCommands>(MADE_KEY, {}), [g.key]: { name, target, at: Date.now() } },
      'labels',
    );
    close();
    note(`Made ${res.use || commandUse(target, name)}. ${ready}`);
  };
  const field = 'rounded-control border border-line bg-card px-3 text-body outline-none focus:border-accent';
  return (
    <Dialog
      open={!!g}
      onOpenChange={(o) => !o && close()}
      title="Make it a command"
      description={
        <>
          Keep this prompt in a file, and type <code className="rounded-sm bg-sunken px-1">{shown}</code> instead
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          make();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-detail font-semibold">For</span>
          <Seg
            label="Which agent"
            value={target}
            onChange={setTarget}
            options={[...new Set([...sources, target])].map((s) => [s, SOURCE[s].name])}
            className="self-start"
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-detail font-semibold">Name</span>
          <span className={cx('flex h-9 items-center', field, 'px-0')}>
            <b className="pl-3 text-muted">{prefix}</b>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.trim().toLowerCase())}
              onBlur={(e) => setName(slug(e.target.value) || e.target.value)}
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="cmd-name-hint"
              className="h-full min-w-0 grow bg-transparent pr-3 outline-none"
            />
          </span>
          <small id="cmd-name-hint" className={cx('text-label', !valid || exists ? 'text-bad' : 'text-muted')}>
            {!valid
              ? 'Lowercase letters, numbers and dashes, up to 40'
              : exists
                ? `There's already one called ${name} there. Pick another name`
                : 'Lowercase letters, numbers and dashes'}
          </small>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-detail font-semibold">What it's for</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            placeholder="A line about it, shown when you pick it"
            className={cx('h-9', field)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-detail font-semibold">The prompt</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={20000}
            className={cx('py-2 font-mono text-detail', field)}
          />
          <small className="text-label text-muted">
            {hasArg ? (
              <>
                <code>$ARGUMENTS</code> becomes what you type after the command: <code>{shown} 1234</code>
              </>
            ) : (
              <>
                Put <code>$ARGUMENTS</code> where something changes each time, and type it after the command.
              </>
            )}
          </small>
        </label>
        <p className="flex items-start gap-2 rounded-row bg-sunken px-3 py-2.5 text-detail text-muted">
          <Folder size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Saved as{' '}
            <code>
              {dir}/{valid ? name : 'its-name'}.md
            </code>
            , which {agent} reads{reads}. Overtime writes it only when you press Create, and never over a file that's
            there.
          </span>
        </p>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-detail text-bad">
            <TriangleAlert size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {demo && <p className="text-detail text-warn">The demo can’t write files. Copy the prompt instead.</p>}
        <footer className="flex items-center justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button
            icon={<Copy size={13} strokeWidth={2} aria-hidden />}
            onClick={async () => {
              const ok = await copyText(body);
              note(ok ? 'Copied the prompt' : "Couldn't copy to the clipboard", ok ? {} : { level: 'warn' });
            }}
          >
            Copy the prompt
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || exists || demo || !body.trim() || busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
