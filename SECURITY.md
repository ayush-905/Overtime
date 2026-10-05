# Security

Overtime reads your agents' transcripts and, if you let it, your Claude Code login, so it's worth knowing
what it touches and how to tell me about a problem.

## Reporting a problem

Please report anything you think is a security issue privately, through
[GitHub's private vulnerability reporting](https://github.com/ayush-905/Overtime/security/advisories/new),
rather than in a public issue. Say what you found, how to see it happen, and which version you're on (the
Mac app's **About Overtime**, or `version` in `package.json`). You'll get a reply within a week. Fixes go out
as a new release, which copies of the Mac app install by themselves.

Only the latest release gets fixes.

## What Overtime can reach

- **Your transcripts**, read-only: `~/.claude/projects`, `~/.codex/sessions` and Pi's sessions folder.
  It also reads the Claude app's list of its sessions, and Pi's model lists for their context windows.
- **Your Claude Code login**, from the macOS Keychain or `~/.claude/.credentials.json`, but only while
  *Exact limits from Anthropic* is on in Settings. It sends that login only to `api.anthropic.com`, to read
  your plan's limits, and never stores, refreshes or changes it.
- **Its own folder**, `~/.overtime`, which is the only place it writes. The one exception is **Make a
  command**, which writes a single new file when you press **Create**.
- **The server** listens on `127.0.0.1` only and refuses any other host name, which blocks DNS rebinding.
  Actions need a POST with a header other websites can't send. Pages carry a Content-Security-Policy, so
  they only run Overtime's own scripts.

The server has no login. Other user accounts on the same Mac can reach it at `127.0.0.1`. On a Mac you share
with other accounts, keep that in mind or run it only when you're using it.

## Updates

The Mac app checks GitHub Releases for updates. It installs one only when the release's `latest-mac.yml`
is signed with Overtime's release key; the public half is built into the app (`desktop/update-key.js`). The
download must also match the size and SHA-512 listed in that signed file, and its code signature must be
intact. The app isn't notarized by Apple: it's signed ad hoc, so macOS asks you to approve it the first time
you open it.
