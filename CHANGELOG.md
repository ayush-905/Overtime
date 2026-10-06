# Changelog

What changed in each release of Overtime. The newest is first, and each one has its download on
[GitHub Releases](https://github.com/ayush-905/Overtime/releases).

## 0.6.3 (6 October 2026)

- **The forecast reads like the figure above it.** Under each plan limit, on the Overview and the
  Usage page alike, it says what's left: "At this pace, ~34% left at the reset" ("~34% left at
  reset" on the Overview).

## 0.6.2 (6 October 2026)

- **Links to sessions.** The open session is in the address (`#sessions?range=7&session=…`),
  so a refresh keeps it open and Back closes it. **Copy link** in its panel gives a link to
  it, and ⌘-click or a middle click on any session opens it in a new tab.
- **The same forecast everywhere.** The Usage page said "On pace for ~55% by the reset"
  where the Overview said "On pace to keep ~45%"; both now say what you'll keep. The chart
  under a window and the forecast above it now agree too, and a session that finished
  hours ago shows as idle on the Agents page, as it does in the inbox, rather than needing
  you.
- **The Mac app says when something stops.** A page whose process dies (the window's, the
  mini view's or the office's) loads again where it was; before, the hidden window's alerts
  just stopped. If one keeps stopping, or the server does, the menu bar says so ("Stopped"
  beside the icon, for the server) and sends a notification, and its menu offers to start
  it again. A server that failed to start again after stopping is now retried too.
- **Sections open at once.** They load in a quiet moment after the dashboard starts, and
  one that's still on its way shows its title and the outline of its cards, not an empty
  page.
- **For the keyboard and screen readers:**
  - The floating session panel keeps the focus while it's open and gives it back to what
    you opened it from.
  - Every chart has a name, and each bar, day or cell reads out its tooltip.
  - The Usage page no longer reads its limits out every minute.
  - The colour pickers move with the arrow keys, and every card's ⓘ can be reached with
    Tab, its note read out.
  - Lint now fails on accessibility mistakes rather than warning about them.

## 0.6.1 (5 October 2026)

- **Signed updates.** Releases are signed with Overtime's own key, and the Mac app installs an update only
  when its signature checks out. A release from anyone else, even someone with access to the GitHub account,
  is refused. Copies on 0.6.0 or earlier don't check, so they update to the first signed release as before.
- **A tighter Mac app.** The app can no longer be started as a plain Node.js process, and it ignores
  `NODE_OPTIONS` and debugging switches. The popover's "open in the window" message is only taken from
  Overtime's own pages.
- **One streak.** The You page showed two different "Streak" figures; both cards now count the same days.
- **Codex failures count.** A failed command now counts as a tool failure, including one inside a script the
  Codex app ran (before, most went uncounted). A patch you turned down no longer counts as applied, and live
  sessions count their compactions.
- **Lines changed count only edits that went through**, for Claude Code too: an edit you turned down, one
  that failed, or one still waiting isn't counted.
- **Fewer false "thinking"s.** A manual `/compact` no longer leaves the agent thinking, and a subagent that
  hands back its work shows as done.
- **Smaller fixes.** The Sessions list appears as soon as the history is read, not up to 11 seconds later.
  The session panel shows a command still running as running, not succeeded. Projects remembers its sort.
  **Reset** and putting back a saved copy no longer lose the settings they restore.
- For contributors: CI runs the tests, the type checks, Biome's lint and formatting, and checks that the
  built dashboard is up to date. `npm run verify` runs the same checks locally, and `app:release` runs them
  first. The server and the dashboard are split into smaller modules, and duplicated logic is merged.

## 0.6.0 (4 October 2026)

- **It keeps running.** A transcript line Overtime can't read is skipped and noted once in the log, rather
  than stopping the server (and stopping it again on every restart). A malformed request gets an error, not a
  crash. The Mac app keeps the previous run's log as `overtime.old.log`.
- **Each session is counted once.** A big transcript could be counted twice in the live view while it was
  first read. A transcript that gets shorter is now read afresh.
- **Your history is safe.** If `~/.overtime/history.json` is ever damaged, it's set aside rather than
  written over. Days whose transcripts Claude Code has cleared keep what was recorded for them, and settings
  changed just before quitting are saved.
- **Lighter.** The dashboard redraws only what changed (about 25 times fewer redraws on the Overview, over
  200 times fewer on Sessions). Its first screen needs 30% less code, the live feed sends an agent only when
  it changed, and the server learns of new transcripts from the Mac's file events. With agents working, it
  uses about half the CPU.

## 0.5.0 (4 October 2026)

- **Pi sessions.** Overtime follows [Pi](https://pi.dev) beside Claude Code and Codex: each session's cost,
  tokens, messages, tool calls, files and commands, with the cost Pi works out for each request. **Resume in
  Terminal** runs `pi --session`, and a prompt you repeat can become a Pi prompt template.
- **The provider switch** lists the tools on this Mac (**All**, **Claude**, **Codex**, **Pi**), and every
  chart follows it.
- **Context windows** for Pi come from the window Pi itself uses for each provider and model.
- **One model catalog** for names and prices. Claude models reached through Bedrock, Vertex, OpenRouter or
  Copilot are priced and named, and unknown models keep their full names.
- **Tidier session lists.** Sessions that never got a reply are left out, an agent's headless test runs are
  one project (**Agent test runs**), and a session isn't named "." or "exit" when you said more after.

## 0.4.0 (2 October 2026)

The first release: a dashboard for your Claude Code and Codex agents. It shows what's left of each plan and
when it resets, what your usage would cost at API prices, every session and project, your and your agents'
working hours, and an inbox of what needs you. A pixel-art office lets you watch your agents work. It reads
the transcripts both tools already keep on your Mac, so there's nothing to set up, and the Mac app updates
itself from GitHub Releases.
