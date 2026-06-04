# Changelog

All notable changes to Shinobi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
