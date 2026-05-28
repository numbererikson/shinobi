# Shinobi architecture

## Module layout

```
shinobi/
├── src/
│   ├── cli.ts                    — Top-level command dispatch
│   ├── commands/
│   │   ├── init.ts               — `shinobi init`
│   │   └── sync.ts               — `shinobi sync {init,push,pull,status}`
│   ├── lib/
│   │   ├── db.ts                 — better-sqlite3 singleton, WAL + FK + busy_timeout
│   │   ├── migrations.ts         — Scan migrations/, sha256 checksum, apply pending
│   │   ├── config.ts             — Read/write ~/.shinobi/config.json
│   │   ├── json.ts               — parseJsonOrNull / stringifyOrNull
│   │   ├── fts.ts                — escapeFtsQuery
│   │   └── priority.ts           — Shared CASE expression for ORDER BY priority
│   ├── models/                   — Functional, no classes. Each file exports interfaces + functions.
│   │   ├── projects.ts
│   │   ├── subtasks.ts           — Includes nextTask (priority + dep resolution)
│   │   ├── decisions.ts
│   │   ├── dead_ends.ts
│   │   ├── notes.ts
│   │   ├── plans.ts              — Auto-versioned saves
│   │   ├── context.ts            — Patch semantics (only present fields overwrite)
│   │   ├── sessions.ts
│   │   ├── activity.ts           — Includes linkCommit helper
│   │   └── *-helpers.ts          — Hydration helpers extracted to avoid import cycles
│   ├── services/
│   │   ├── embedding/
│   │   │   ├── types.ts          — EmbeddingProvider interface
│   │   │   ├── openai.ts         — text-embedding-3-small (1536d default)
│   │   │   ├── voyage.ts         — voyage-3-lite (512d default)
│   │   │   ├── ollama.ts         — nomic-embed-text (768d default)
│   │   │   ├── factory.ts        — Pick provider from env
│   │   │   ├── vector-math.ts    — pack / unpack / cosineSim
│   │   │   └── store.ts          — updateRowEmbedding / semanticSearch
│   │   └── plugins/
│   │       ├── state.ts          — Loaded plugins registry (avoids import cycle)
│   │       ├── api.ts            — Read-only ShinobiApi facade
│   │       ├── discovery.ts      — Tier 1 (user dir) + Tier 2 (npm) scan
│   │       └── registry.ts       — Validate + register plugin tools
│   ├── server/
│   │   ├── mcp.ts                — Server boot, ListTools + CallTool handlers
│   │   └── tools/                — 37 tool definitions
│   │       ├── types.ts          — ShinobiTool interface
│   │       ├── registry.ts       — Global tool list + appendTool
│   │       ├── args.ts           — Typed arg coercion
│   │       ├── index.ts          — registerBuiltins (called at startup)
│   │       └── *.ts              — One file per tool group
│   └── dashboard/
│       ├── server.ts             — Hono app + routes
│       ├── layout.ts             — Base HTML + embedded CSS / JS
│       └── views.ts              — Per-view HTML generators
├── migrations/
│   ├── 0001_initial_schema.sql   — 8 tables (projects, subtasks, decisions, dead_ends, notes, plans, context, sessions) + FTS5 mirrors
│   └── 0002_activity_and_links.sql — activity table + subtask embedding columns
├── scripts/                       — Smoke test harnesses (not shipped in tarball)
└── dist/                          — Compiled JS shipped via `npm pack`
```

## Request lifecycle (MCP)

```
MCP client (Claude Code) ─stdio─→ shinobi mcp
                                    │
                                    ├─ applyPendingMigrations()
                                    ├─ registerBuiltins()           ← 37 tool defs
                                    ├─ loadDiscoveredPlugins()     ← scan ~/.shinobi/plugins + node_modules/@shinobi/plugin-*
                                    │
                                    └─ Server.connect(StdioServerTransport)
                                         │
                                         ├─ ListToolsRequest → allTools() with schemas
                                         └─ CallToolRequest  → getTool(name).handler(args)
                                                                    │
                                                                    ├─ Model write (sync, transactional)
                                                                    ├─ updateRowEmbedding (async, optional)
                                                                    └─ recordActivity
```

## Request lifecycle (dashboard)

```
Browser → http://127.0.0.1:8765/<path>
            │
            └─ Hono router
                 ├─ GET routes  → model read → renderXxxView(...) → c.html(...)
                 └─ PATCH /api/* → model write → c.json(...)
```

The dashboard is the same Node process as the MCP server when launched together; today they are separate CLI subcommands (`shinobi mcp` vs `shinobi dashboard`) and each opens its own DB handle.

## Storage

SQLite via better-sqlite3. WAL mode + foreign_keys ON + busy_timeout 5000ms. Migrations are forward-only with sha256 checksum tracking — if an applied migration file changes content, the runner halts with a `mismatched` count.

FTS5 mirrors live alongside their base tables (`subtasks_fts`, `decisions_fts`, `dead_ends_fts`, `notes_fts`) with `ai`/`ad`/`au` triggers keeping them synchronized. Searches use `MATCH` against the FTS5 table and JOIN back to the base table by rowid.

Embeddings live in BLOB columns (`embedding`, `embedding_provider`, `embedding_dims`) on `decisions`, `dead_ends`, `notes`, and `subtasks`. The provider name is stored alongside so a switch in provider (different dimensions) doesn't produce silent comparison errors.

## Sync model

`shinobi sync push` does `wal_checkpoint(TRUNCATE)` + `db.backup()` + git add+commit+push. `shinobi sync pull` does git pull + file copy back. There is no merge; the writer is whichever machine pushed last. For multi-writer scenarios, consider holding off on `pull` while another machine is mid-edit.

## Plugin contract

A plugin is an ES module that exports `default` (or `register`) accepting `(registry, api)`. The `api` is a read-only facade — plugins can read projects/subtasks/decisions but cannot mutate state. Plugin tools must use the `plugin_*` prefix to avoid colliding with built-ins.
