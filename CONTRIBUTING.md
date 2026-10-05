# Contributing

Thanks for wanting to help. The README's [Development](README.md#development) section has the commands and
where everything lives; this is the short version of how a change gets in.

## Setting up

You need Node.js 22.12 or later (`.nvmrc` has the version CI uses) and a Mac to run the app. Then:

```bash
npm install
```

To skip downloading Electron when you're only working on the server or the dashboard, set
`ELECTRON_SKIP_BINARY_DOWNLOAD=1` before installing.

## Making a change

- **Let Biome format on save.** In VS Code or Cursor, install the Biome extension (the repo recommends it); the
  workspace settings in `.vscode/` make it the formatter here, so a save formats the way CI checks. In another
  editor, run `npm run format`.
- **Run `npm run verify` before you push.** It runs Biome's lint and formatting check, the server's and the
  dashboard's tests, and the type checks, the same as CI. `npm run format` fixes the formatting.
- **Changed anything in `ui/`?** Run `npm run build:ui` and commit `web/app/` with it. CI checks that it's up
  to date.
- **Changed a figure or a sentence the dashboard shows?** The golden tests hold every one of them. Record the
  new ones with `npx vitest run --config ui/vite.config.ts -u -t "<test name>"`, and check that only what you
  meant to change did.
- **A new transcript format, or a new tool?** Add a fixture under `test/fixtures/<harness>/`, and a test that
  runs it through the live view and the history. For a new tool, see "Adding a harness or a model" in the
  README.
- **Keep the server free of dependencies.** It runs with nothing installed. The dashboard's packages are dev
  dependencies, because it ships built.
- Write comments and test names in plain words, like the code around them.

## Pull requests

Keep a pull request to one change, say what it changes for someone using Overtime, and how you checked it.
CI has to pass. A user-facing change gets a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

Security problems go through private reporting, not issues: see [SECURITY.md](SECURITY.md).
