# Changelog

All notable changes to Shinobi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Docker Hub image.** A `docker-publish` workflow builds and pushes a
  multi-arch (amd64/arm64) image to `shinobiapps/shinobi` on every `v*` tag.
  Self-hosters can now `docker pull shinobiapps/shinobi:latest` instead of
  building from source — notably faster on tiny VMs. Deploy guide updated with
  the prebuilt-pull path. Requires `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`
  repo secrets.

## [0.2.1] — 2026-06-12

Hardening + cross-device fixes found by dogfooding the remote brain from a
cloud session, plus pre-launch safety nets.

### Added

- **Rate limiting** on the public surface: `/mcp` (default 240 req/min per
  client, `SHINOBI_MCP_RATE_LIMIT`) and `/api/auth/magic-link` + `/api/auth/verify`
  (default 10 req/min, `SHINOBI_AUTH_RATE_LIMIT`). Keyed by
  `CF-Connecting-IP` / `X-Forwarded-For`, applied before auth so token
  guessing is cut early. (#12)
- **Pre-migration database backup.** Pending migrations now snapshot the DB
  file to `<db>.pre-migrate-<timestamp>` first (3 kept), so a failed
  forward-only migration is recoverable. Failure messages include the backup
  path. (#12)
- **`list_projects brief=true`** — token-light listing (truncated
  descriptions, no summary blobs) for agents scanning many projects. (#12)
- **Host-side auto-deploy** for the VM: `scripts/vm-autodeploy.sh`, a cron
  check-and-deploy with env carry-over, health check, and automatic rollback
  to the previous image. (#11)
- **Recovery runbook** (`docs/recovery-runbook.md`): tested restore paths for
  container/VM/database/Cloudflare failures, phone-only preflight checklist,
  and a drill. (#9)
- First **vitest unit suites** (`paths`, `rate-limit`), wired into `npm test`. (#9, #12)

### Fixed

- **Cross-device `files_touched` lookups.** Paths are normalized to
  repo-relative at write time and matched with a suffix fallback, so
  decisions logged on one machine (e.g. `c:\laragon\www\...`) are found from
  any other (`/home/user/...`). Legacy absolute rows keep working without a
  backfill. (#9)
- **Stale project summaries.** `session_closeout` now persists the
  agent-authored summary as `recent_summary_md` (`agent:closeout`) when no
  server-side LLM is configured — an external LLM key is no longer required
  to keep the brain fresh. `agent_bootstrap` flags stale summaries
  (`summary_stale`) and closeout reports `summary_skip_reason`. (#10)
- **Magic-link token accumulation** — consumed/expired tokens are purged on
  each issuance. (#12)

## [0.2.0] — 2026-06-12

Remote MCP foundation — Shinobi becomes a cloud brain reachable from every
device, and repositions from "memory server" to **task spine + actively-searched
dead ends + approvals + one brain across laptop, cloud, and mobile**.

### Added

- **Remote HTTP `/mcp` endpoint.** Streamable HTTP transport, **stateless**
  (every POST is self-contained, so it runs behind a load balancer / tunnel
  with no sticky sessions), mounted on the existing Hono dashboard server
  behind the same bearer-token auth. `shinobi serve` now exposes dashboard +
  MCP in one process. (#1)
- **Docker container + GCP Always Free deploy guide.** `docs/deploy-gcp-free.md`
  walks an e2-micro (us-central1) from zero to a running container, including
  the 2 GB swapfile the build needs on 1 GB RAM. DB persistence fixed for
  containers via config-dir override so the SQLite store survives
  `docker rm` / rebuild. (#2)
- **Env-driven `.mcp.json` pattern for cloud sessions.** Repo `.mcp.json` now
  uses `${SHINOBI_MCP_URL}` / `${SHINOBI_MCP_TOKEN}` placeholders expanded from
  the environment, so claude.ai/code cloud sessions get zero-config remote MCP
  and **tokens never live in the repo**. (#6)
- **Cloudflare Tunnel setup.** Documented outbound-only exposure (zero open
  ports, free TLS, no static IP) publishing `shinobi.shinobi-apps.com` →
  local `/mcp` + dashboard.
- **`git` in the Docker image** so `shinobi sync push` (nightly backup to the
  private `shinobi-sync` repo) works inside the container. (#4)
- **Troubleshooting docs.** curl exit-55 on `sync push` (set
  `http.version HTTP/1.1` + `http.postBuffer`), and a getting-started guide
  with both local and remote onboarding paths. (#5, #8)

### Fixed

- **Dashboard re-login after token rotation.** A stale `shinobi_token` cookie
  shadowed a fresh `?token=` query param, so rotating the token locked you out
  until you cleared cookies. The query param now takes precedence. (#3)

### Changed

- **Repositioning.** Shinobi is no longer pitched as a local-first "memory
  layer." The wedge is the task spine, decisions that survive across devices,
  and dead ends that are **semantically searched before an agent implements a
  similar approach** — a differentiator no competitor ships. README,
  `package.json`, and roadmap updated to match.
- **Cloudflare zone min TLS pinned to 1.2.** The Anthropic egress gateway does
  not negotiate TLS 1.3; raising the zone minimum to 1.3 breaks **all** MCP
  calls from cloud sessions (`TLSV1_ALERT_PROTOCOL_VERSION` + 503). Documented
  as a hard runbook rule. (#7)

[0.2.1]: https://github.com/numbererikson/shinobi/releases/tag/v0.2.1
[0.2.0]: https://github.com/numbererikson/shinobi/releases/tag/v0.2.0

## [0.1.6] — 2026-06-04

Dashboard UX: kanban/list naming + clickable subtask cards.

### Changed

- **Renamed project tabs to match standard board/list nomenclature.**
  "Kanban" → "Board", "Subtasks" → "List". The two tabs were already
  showing the same project subtasks in different layouts (board grouped
  by status vs. flat sortable table); the old labels falsely implied a
  parent-child hierarchy ("Subtasks of what?"). URLs are unchanged so
  bookmarks and external links keep working.

### Added

- **Subtask detail drawer.** Clicking a card on the board or a row in
  the list opens a slide-in drawer on the right with the full title,
  description, status transitions, dependencies, files touched, and
  timestamps. ESC and backdrop click close. Inline status buttons on
  board cards still work (clicks inside them no longer open the drawer).

## [0.1.5] — 2026-06-04

Bugfix release: the `prepare` lifecycle script no longer recurses on Windows.

### Fixed

- **`prepare` script no longer loops on Windows when nested `npm`
  invocations can't find `node` on `cmd.exe`'s PATH.** The previous
  inline form was `node -e "...exists..." || (npm install --prefix
  dashboard-spa && npm run build)`; on Windows, each nested `npm` call
  spawned its own `cmd.exe`, and somewhere ~25 levels deep `node` fell
  off PATH and the whole tree retried in a loop. Replaced with
  `node scripts/prepare.mjs`, which does the dist-exists check directly
  via `fs.existsSync` and short-circuits via `SHINOBI_PREPARE_RUNNING`
  to break any future recursion. Only ever bit contributors cloning the
  repo on Windows when node wasn't on the system `cmd.exe` PATH — npm
  registry users were never affected (registry installs ship a prebuilt
  `dist/` and don't run `prepare`).

## [0.1.4] — 2026-06-04

Dashboard quality-of-life: project list now shows subtask completion at a glance.

### Added

- **Project progress bar in the dashboard table.** New "Progress" column
  renders a slim bar plus `done/total · %` text next to every project.
  Color tier: emerald when 100% done, accent when ≥ 50%, amber under 50%,
  em dash when the project has no subtasks. `role="progressbar"` with
  `aria-valuenow` for screen readers.
- **Backend exposes `subtasks_total` + `subtasks_done` on every project
  read path.** `listProjects`, `getProject`, and `projectsMatchingTargetPath`
  now LEFT JOIN a subtask aggregate subquery and surface both counts on
  the `Project` type. The `/api/projects` endpoint returns them without
  any extra round-trips.

### Why

The project list used to show only `project.status` (`todo` / `in_progress`
/ `done`), which is operator-set and frequently lags behind the real subtask
state — projects sat at "todo" while every subtask was already done. Users
had to drill into each project just to see whether work was actually
finished. The progress column closes that loop without changing the
operator-controlled status semantics.

## [0.1.3] — 2026-05-29

Pre-launch polish: multi-client MCP bootstrap.

### Added

- **`shinobi init` now configures Cursor in addition to Claude Code.**
  Writes `<workspace>/.cursor/mcp.json` alongside `<workspace>/.mcp.json`,
  both using the absolute-path form (`command: <node>`, `args: [<cli.js>,
  "mcp"]`) so they survive shell-less spawns on Windows.
- **`shinobi init --print-config`** emits the MCP server JSON snippet to
  stdout for clients that do not respect workspace MCP files (Cline,
  Continue.dev, Zed). Pipe / paste into the relevant config.
- **README "MCP client setup" section** with paste-ready file paths and
  config snippets for all five clients (Claude Code, Cursor, Cline,
  Continue.dev, Zed), plus the explicit warning that bare `shinobi`
  command does not work in MCP configs because clients spawn with
  `shell: false`.

### Why

The 0.1.2 init silently only helped Claude Code users. Cursor / Cline /
Continue / Zed users would install Shinobi, run `shinobi init`, restart
their client, see no `mcp__shinobi__*` tools, and conclude it was
broken. Caught during pre-launch audit.

## [0.1.2] — 2026-05-28

First publicly installable release.

(Note: `0.1.1` was published earlier the same day but shipped a stale
`dist/` that left an older hardcoded `/health` route alongside the
corrected one. Hono matched the hardcode first, so the endpoint always
returned `version: "0.1.0"`. `0.1.2` is the immediate hotfix and the
de-facto launch artifact. The launch announcement on Product Hunt /
Hacker News is scheduled for **2026-06-03**.)

### Added

- **MCP server** with 37 tools covering projects, subtasks, decisions,
  dead-ends, notes, plans, context, recall, history, git linking, workflow
  helpers (`agent_bootstrap`, `session_closeout`, `file_context`), extraction
  (LLM-powered decision drafts, session summaries), and approvals.
- **Local SQLite store** at `~/.shinobi/shinobi.db` with WAL mode, foreign
  keys, FTS5 virtual tables for fulltext search, optional embedding BLOBs
  for semantic recall.
- **Hono-served web dashboard** on `localhost:8765` with Kanban, decisions,
  dead-ends, notes, plans, context, timeline, analytics, drafts, sessions,
  voice capture, mobile push approvals, plugin marketplace, multi-agent
  relay status.
- **Command palette** in the dashboard — open with `Ctrl+K` / `Cmd+K` or
  the "Search..." button at the top of the sidebar. Searches across
  projects, tasks, decisions, dead ends, and notes; backed by
  `GET /api/recall` fanning out to the FTS5 search functions.
- **Workspace filter** on the Home page projects table. Appears whenever
  the loaded set spans more than one workspace; persisted to `localStorage`.
- **`shinobi --version` / `-v`** flag, reading the installed version
  from `package.json`. Help text lists all top-level options.
- **React + Vite + Tailwind SPA** for the dashboard with mobile-responsive
  layout and PWA manifest (installable on iOS / Android home screen).
- **Plugin system** discovering custom MCP tools from
  `~/.shinobi/plugins/*.js` and `@shinobi/plugin-*` npm packages.
- **Embedding providers** — OpenAI (text-embedding-3-small), Voyage
  (voyage-3-lite), Ollama (nomic-embed-text), BYO key. Falls back to FTS5
  when no provider configured.
- **Cross-machine sync** — git-based snapshot push/pull
  (`shinobi sync push` / `shinobi sync pull`).
- **Multi-agent realtime relay** — Cloudflare Worker + Durable Object
  broadcasting `sync-available` events across workspace members within
  ~1.5s.
- **Mobile push approvals** — `request_approval` MCP tool with Web Push
  notification + action buttons, agent unblocks on response.
- **Voice capture** — PWA records or accepts uploaded audio, transcribes
  via Whisper (default Groq `whisper-large-v3`, fallback OpenAI; BYO key),
  drafts decisions via LLM extractor for review.
- **GitHub integration** — `link_commit` MCP tool, webhook receiver for
  PR linking via `[SHI-N]` tags or `target_path` attribution.
- **Session cost tracking** — per-session input/output token tallies for
  Claude Code logs and Anthropic API call records.
- **Optional multi-user mode** — magic-link email auth, project members,
  mentions; dormant when zero users exist (single-user transparent loopback).
- **VS Code + Cursor extensions** — status bar widget, project picker,
  three sidebar views (tasks, recent decisions, dead-ends), six commands.
- **Forward-only SQL migrations** with checksum verification and adopt /
  dry-run / verify CLI flags.

### Fixed (relative to the broken 0.1.1 publish)

- `/health` endpoint returning hardcoded `"0.1.0"` instead of the
  installed version. Root cause: the 0.1.1 tarball shipped a stale
  `dist/` containing both an older hardcoded `/health` route and the
  corrected one — Hono matches the first match, so the hardcode won.
- Added `prepublishOnly` script that wipes `dist/` and runs a clean
  rebuild before every publish, so a stale-artifact publish cannot recur.

### Distribution

- `npm install -g @shinobiapps/shinobi` installs the CLI globally.
- `npm install -g github:numbererikson/shinobi` installs from `main`.
- MIT license.
- Node.js 18+ required; better-sqlite3 ships prebuilt binaries for
  Linux / macOS / Windows.

### Known limitations

- Hosted SaaS tier is on the roadmap (waitlist via Team / Pro CTAs on the
  marketing site) — not generally available at launch.
- Multi-user schema is wired (auth, members, mentions, subtask
  assignments) but UI affordances are minimal; team-mode polish is
  scheduled for v0.2.
- npm audit reports 5 moderate-severity advisories in the dev-dependency
  chain (esbuild via vite via vitest, dev server only — not in the
  shipped runtime). Tracked for v0.2 vite upgrade.

[0.1.2]: https://github.com/numbererikson/shinobi/releases/tag/v0.1.2
