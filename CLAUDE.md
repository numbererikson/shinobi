# CLAUDE.md

Guidance for AI coding agents (Claude Code, Cursor, Cline, Zed, …) working in
this repository.

## What this is

Shinobi is an MCP server that gives AI coding agents a persistent, shared
brain: a task spine, decisions log, **actively-searched dead ends**, approvals,
and project context — reachable over stdio or remote streamable HTTP so one
brain serves every device (laptop, cloud session, mobile). Node + TypeScript,
SQLite (better-sqlite3), Hono dashboard, plugin system.

## Dogfooding — use Shinobi to build Shinobi

This project is developed *through* Shinobi. If the Shinobi MCP tools
(`mcp__shinobi__*`) are connected in your session:

- **Start** by calling `agent_bootstrap` for the relevant project to pull
  context, the latest plan, the next task, open decisions, and relevant dead
  ends. Engineering work lives in the **"Shinobi engine"** project; the next
  feature wave in **"Shinobi autonomous agents"**; launch work in **"Shinobi
  Launch v2"**.
- **Before implementing** a non-trivial approach, call `check_dead_ends` — we
  log failures so they aren't repeated. This is the product's core idea; honor
  it while building the product.
- **Record** durable decisions with `log_decision` and failures with
  `log_dead_end` as you go.
- **End** with `session_closeout` (summary, changed files, completed tasks).
  It refreshes the project summary even without a server-side LLM key.

## Dev commands

```bash
npm run dev            # run the CLI from source (tsx)
npm run dashboard      # dashboard + (if SHINOBI_MCP_HTTP=on) the /mcp endpoint
npm run build          # tsc + vite build of the dashboard SPA
npm test               # build + vitest + the smoke suite (run before pushing)
npm run test:vitest    # unit tests only
npm run smoke:tools    # exercise the tool registry directly
```

## Layout

- `src/cli.ts` — command dispatch (`init`, `serve`, `dashboard`, `mcp`,
  `migrate`, `sync`, `cost`, `digest`)
- `src/server/` — MCP server: tool definitions (`server/tools/`) + stdio and
  HTTP (`server/http.ts`) transports
- `src/models/` — data layer, one module per entity; direct better-sqlite3,
  **parameterized queries only**, row/entity hydration split
- `src/services/` — embeddings, plugins, push, relay, extraction/summarizer
- `src/dashboard/` — Hono app + auth
- `src/lib/` — db, migrations, config, fts, paths, rate-limit
- `migrations/` — forward-only `NNNN_name.sql`, checksum-validated at startup
- `scripts/` — smoke harnesses + `vm-autodeploy.sh`

## Conventions

- **TypeScript strict** (`noUnusedLocals`, `noImplicitReturns`, …). No `any`
  abuse. Functional modules, not classes.
- **SQL**: always parameterized (`?` placeholders). String interpolation only
  for static query structure (column lists), never for values.
- **Paths in `files_touched`** are normalized to repo-relative via
  `src/lib/paths.ts` so cross-device lookups match — reuse it, don't hand-roll.
- **Migrations** are forward-only and applied at startup; a pre-migration DB
  backup is taken automatically. Add a new numbered file, never edit an
  applied one (checksum mismatch will be flagged).
- **Tests alongside code**: add/adjust vitest unit tests and the relevant smoke
  harness for any behavior change. Run `npm test` before pushing.

## Release & deploy

- Push a `v*` tag (e.g. via a GitHub Release) → `.github/workflows/publish.yml`
  verifies tag == `package.json` version, runs the full suite, and `npm publish`.
  Bump the version and add a `CHANGELOG.md` entry in the same change.
- `main` auto-deploys to the production VM via `scripts/vm-autodeploy.sh`
  (cron, build-then-swap with health check + rollback). Keep `main` green;
  it is branch-protected (PR + passing `test`).
- See `docs/deploy-gcp-free.md` for the $0/mo deploy and
  `docs/recovery-runbook.md` for failure recovery.

## Constraints (learned the hard way)

- **Cloudflare minimum TLS must stay at 1.2.** Anthropic's egress gateway
  negotiates 1.2; a 1.3 minimum kills every MCP call from cloud sessions.
- **Two independent brain copies** (Docker volume + `shinobi sync` git repo) —
  never reduce below two.
- The remote `/mcp` endpoint is **stateless** — keep it that way so it runs
  behind a tunnel / load balancer without sticky sessions.
