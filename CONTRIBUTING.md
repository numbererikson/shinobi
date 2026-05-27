# Contributing to Shinobi

Thanks for being here. Shinobi is a small, friendly project — pull
requests welcome from anyone, no CLA, no gatekeeping.

## Quick start for contributors

```sh
git clone https://github.com/numbererikson/shinobi
cd shinobi
npm install
npm run build      # tsc + Vite SPA
npm link           # makes the local checkout the active `shinobi` CLI
shinobi dashboard  # http://localhost:8765
```

The dashboard hot-reloads SPA changes when you run
`cd dashboard-spa && npm run dev` in a side terminal (Vite proxies to
the backend). For backend changes, `npm run build` + restart.

## Repo layout

```
src/                    TypeScript backend
  cli.ts                CLI entry (shinobi <command>)
  server/               MCP server + tool registry
  dashboard/            Hono dashboard + auth
  models/               SQLite models (one file per table)
  services/             Standalone services (push, relay, embedding, ...)
  commands/             CLI command handlers (init, migrate, sync, cost, digest)
  lib/                  Shared utilities (db, config, json, fts, migrations)

dashboard-spa/          Vite + React + Tailwind dashboard frontend
migrations/             SQL migrations (NNNN_<intent>.sql, forward-only)
relay-worker/           Cloudflare Worker for multi-agent sync
vscode-extension/       VS Code + Cursor extension (shared code)
marketing-site/         Static HTML landing page (deployed on Cloudflare Workers)
docs/                   Architecture + walkthrough docs
```

## What we love getting PRs for

- **MCP tool ideas** — new tools that fit the local-first task spine
  story. Open an issue first so we can discuss the schema.
- **New plugins** — under `@shinobi/plugin-*` or `shinobi-plugin-*`.
  Plugins live in their own packages, not in this repo.
- **Bug fixes** — always welcome. Add a regression test where it
  makes sense.
- **Docs improvements** — typos, clarifications, additional examples.
- **Frontend polish** — accessibility fixes, mobile improvements,
  empty-state messaging.
- **Performance** — query optimizations, FTS5 tuning, batch operations.
- **Cross-platform fixes** — Windows quirks, Linux distros that behave
  differently.

## What probably won't get merged

- **New external dependencies** — Shinobi tries hard to stay slim
  (better-sqlite3, hono, react, vite, tailwind, web-push, ws are the
  whole non-dev dep list). PRs that add a heavy lib for one feature
  will be asked "can this be done in <20 lines without the dep?"
- **Major schema changes without an upgrade path** — migrations are
  forward-only. New columns + populate, never DROP.
- **Behavior changes to existing MCP tools** — these are public APIs
  agents depend on. New tools welcome; breaking-renaming existing
  ones is a separate discussion.
- **Subjective UI redesigns** — the dashboard aesthetic is intentional.
  Tweaks welcome via small PRs; wholesale redesigns should be issues
  first.

## Code standards

- **TypeScript strict.** Type hints on all function signatures.
- **No `any`.** Use `unknown` and narrow.
- **Trust the framework boundaries.** Validate at request edges, then
  trust internal callers.
- **Don't add comments that explain WHAT the code does** — the
  identifiers should. Comments explain WHY when it's not obvious.
- **No emojis in source code** unless explicitly necessary for UI.
- **Migrations are forward-only.** One logical change per file. Filename
  format: `NNNN_<intent>.sql` (4-digit zero-padded prefix).

## How to claim a task

Look at issues labeled
[`good first issue`](https://github.com/numbererikson/shinobi/labels/good%20first%20issue)
or [`help wanted`](https://github.com/numbererikson/shinobi/labels/help%20wanted).

Drop a comment on the issue saying you'd like to take it. We'll assign
you (or just start — there's no formal claim required for unassigned
issues).

## PR process

1. Branch from `main`. Branch name: `<your-handle>/<short-description>`.
2. Make the change. Run `npm run build` to catch type errors.
3. If you touched migrations: `shinobi migrate` in a sandbox DB to
   verify they apply clean.
4. Push the branch. Open a PR.
5. PR title: imperative ("add X", "fix Y"), <70 chars.
6. PR description: one paragraph on what changed and *why*. If it's
   a fix, link the issue.
7. We'll review within 5 business days. Smaller PRs review faster.

## Tests

Manual smoke tests are the bar today. Automated tests are welcome but
not required. If you add them, use the standard `node --test` runner
under `tests/` (we don't pull in a test framework).

The CI doesn't run yet — checks land before launch.

## Questions

Open a discussion thread or an issue. We respond fast.

## Conduct

Be kind. Disagreements about technical direction are fine; personal
attacks are not. This is a small project — let's keep it pleasant
for everyone.
