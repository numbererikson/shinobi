# Changelog

All notable changes to Shinobi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-03

First public release.

### Added

- **MCP server** with 34 tools covering projects, subtasks, decisions,
  dead-ends, notes, plans, context, recall, history, git linking, workflow
  helpers (`agent_bootstrap`, `session_closeout`), extraction (LLM-powered
  decision drafts, session summaries), and approvals.
- **Local SQLite store** at `~/.shinobi/shinobi.db` with WAL mode, foreign
  keys, FTS5 virtual tables for fulltext search, optional embedding BLOBs
  for semantic recall.
- **Hono-served web dashboard** on `localhost:8765` with Kanban, decisions,
  dead-ends, notes, plans, context, timeline, analytics, drafts, sessions,
  voice capture, mobile push approvals, plugin marketplace, multi-agent
  relay status.
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
  via Whisper (BYO key), drafts decisions via LLM extractor for review.
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

### Distribution

- `npm install -g github:numbererikson/shinobi` installs the CLI globally.
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

[0.1.0]: https://github.com/numbererikson/shinobi/releases/tag/v0.1.0
