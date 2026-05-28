# Shinobi

[![test](https://github.com/numbererikson/shinobi/actions/workflows/test.yml/badge.svg)](https://github.com/numbererikson/shinobi/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Local-first task spine + memory layer for AI coding agents.

Works with Claude Code, Cursor, Cline, Continue.dev, Zed — any MCP-compatible client.

> **Status:** v0.1 — feature-complete first release. MCP server with 34 tools, web dashboard, plugin system, cross-machine sync, optional semantic recall.

## What it does

Shinobi gives your AI coding agent persistent project memory across sessions:

- **Projects + subtasks** — track multi-session work as the agent claims, completes, or pivots
- **Decisions** — record architectural choices with rationale so future sessions don't re-litigate them
- **Dead ends** — log approaches that failed; the agent checks here before retrying
- **Notes** — free-form annotations and voice notes (audio_path field)
- **Plans** — versioned plan snapshots, retrievable mid-task
- **Context** — per-project conventions, "don't touch" rules, test patterns, deploy notes, file annotations
- **Recall** — fulltext (FTS5) by default, semantic (embedding-backed) when an embedding provider is configured
- **Activity timeline** — every write path lands in the timeline so you can replay what happened
- **Git linking** — `link_commit` ties commits to subtasks via `[SHI-N]` tags or via `target_path` attribution
- **Web dashboard** — Hono-served Kanban + decisions + dead ends + notes + plans + context + timeline + analytics on `localhost:8765`
- **Cross-machine sync** — git-based snapshot push/pull, zero cloud infrastructure
- **Plugin system** — drop a `.js` file in `~/.shinobi/plugins/` or install a `@shinobi/plugin-*` npm package and register custom `plugin_*` tools

All local. SQLite. No cloud account required (BYO embedding provider only if you want semantic recall).

## Install

Requirements:

- Node.js 18+ on `PATH`
- Git
- C++ build toolchain for `better-sqlite3` native build (most systems have prebuilt binaries; Windows may need [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) as fallback)

### From GitHub (recommended)

```bash
npm install -g github:numbererikson/shinobi
```

The `prepare` script auto-builds `dist/` during install, so this works out of the box.

### From a release tarball

```bash
npm install -g ./shinobi-0.1.0.tgz
```

### From a cloned source folder (for development / contributing)

```bash
git clone https://github.com/numbererikson/shinobi.git
cd shinobi
npm install            # triggers `prepare` → builds dist/
npm install -g .
```

### Then bootstrap

In any project root where you want Shinobi available to your MCP client:

```bash
shinobi init
shinobi dashboard
```

`init` will:
1. Create `~/.shinobi/` with `config.json`, `.env` template, and `shinobi.db` (migrations applied)
2. Drop a `.mcp.json` snippet for the current project
3. Print next steps

Restart your MCP client (Claude Code / Cursor / Cline) and the `mcp__shinobi__*` tools become available.

Then open:

```text
http://127.0.0.1:8765
```

On Windows PowerShell, if script execution blocks `shinobi`, use the `.cmd` shim:

```powershell
shinobi.cmd dashboard
```

If you upgraded Node or copied an old `node_modules`, rebuild native dependencies:

```bash
npm rebuild better-sqlite3
```

Important: the code lives in the Shinobi folder, but the local memory database lives in:

```text
~/.shinobi/shinobi.db
```

To move the tool only, copy/clone the Shinobi folder and run the install commands above. To move the existing projects, tasks, decisions, notes, and context too, either copy `~/.shinobi/` or use `shinobi sync`.

## CLI

```
shinobi <command> [options]

Commands:
  init                            Bootstrap ~/.shinobi/ and drop .mcp.json in the current directory
  mcp                             Run the MCP server over stdio (invoked by the MCP client)
  migrate                         Apply pending SQL migrations
  dashboard                       Start the web dashboard on localhost (default port 8765)
  sync init <path> [branch]       Configure a local git repo as the cross-machine sync target
  sync push                       Snapshot the DB and commit it to the sync repo
  sync pull                       Restore the DB from the sync repo's snapshot
  sync status                     Show last push/pull timestamps and git status
```

## MCP tools (34)

| Group | Tools |
|---|---|
| Projects | list_projects, get_project, create_project, update_project, archive_project, unarchive_project, delete_project |
| Subtasks | list_tasks, get_task, create_task, bulk_create_tasks, update_subtask, delete_subtask, claim_task, complete_task, next_task |
| Decisions | log_decision, decisions_for_file, update_decision_status |
| Dead ends | log_dead_end, check_dead_ends |
| Notes | add_note, list_notes |
| Plans | save_plan, get_plan |
| Context | get_context, update_context |
| Recall | recall (FTS5 or semantic) |
| Timeline | history, link_commit |
| Workflow | agent_bootstrap, session_closeout, file_context |
| Plugins | plugin_hello |

## Architecture

| Layer | Tech |
|---|---|
| Language | TypeScript (strict mode, ES2022, NodeNext) |
| Runtime | Node 18+ |
| MCP | `@modelcontextprotocol/sdk` 1.x |
| Storage | SQLite via `better-sqlite3` (WAL mode) |
| Dashboard | Hono + `@hono/node-server` (same process, localhost:8765) |
| Embeddings (optional) | OpenAI text-embedding-3-small / Voyage voyage-3-lite / Ollama nomic-embed-text |
| Migrations | Forward-only, sha256 checksum, `schema_migrations` table |

See [docs/architecture.md](docs/architecture.md) for the request lifecycle and module layout.

## Dashboard auth

The dashboard is open on loopback binds (`127.0.0.1`, `localhost`, `::1`) and token-protected on any non-loopback bind. The token is read from `SHINOBI_DASHBOARD_TOKEN`, otherwise loaded from `~/.shinobi/dashboard-token`, otherwise auto-generated and persisted there. `/health` is always open for probes.

Browser flow — open the dashboard with the token once and the cookie sticks:

```text
http://192.168.1.10:8765/?token=YOUR_TOKEN
```

Curl / scripts — any of these works:

```bash
curl -H "Authorization: Bearer $SHINOBI_DASHBOARD_TOKEN" http://192.168.1.10:8765/api/projects/1/snapshot
curl -H "X-Shinobi-Token: $SHINOBI_DASHBOARD_TOKEN"      http://192.168.1.10:8765/api/projects/1/snapshot
curl --cookie "shinobi_token=$SHINOBI_DASHBOARD_TOKEN"   http://192.168.1.10:8765/api/projects/1/snapshot
```

See [docs/configuration.md](docs/configuration.md#dashboard) for the full env-var reference.

## Cross-machine sync

Shinobi syncs your local SQLite database via a private git repo. Setup once per machine:

```bash
# Once: clone a private GitHub repo to act as the sync repo
git clone git@github.com:USER/shinobi-sync.git ~/shinobi-sync

# Once per machine: tell shinobi about it
shinobi sync init ~/shinobi-sync main

# Push from the writer machine:
shinobi sync push

# Pull on the reader machine:
shinobi sync pull
```

The DB file lands on the `main` branch as a binary; pre-existing local DB is backed up to `<path>.bak-<timestamp>` before restore.

## Configuration

Edit `~/.shinobi/.env` or set env vars before running `shinobi mcp`:

| Variable | Default | Purpose |
|---|---|---|
| `SHINOBI_DB_PATH` | `~/.shinobi/shinobi.db` | SQLite location |
| `SHINOBI_CONFIG_DIR` | `~/.shinobi` | Config + plugins directory |
| `SHINOBI_PLUGINS_DIR` | `${configdir}/plugins` | Plugin discovery directory |
| `SHINOBI_DASHBOARD_PORT` | `8765` | Dashboard port |
| `SHINOBI_DASHBOARD_HOST` | `127.0.0.1` | Dashboard bind host. Loopback skips auth; non-loopback auto-enables token auth. |
| `SHINOBI_DASHBOARD_TOKEN` | _(auto)_ | Override the dashboard token; auto-generated to `~/.shinobi/dashboard-token` when needed. |
| `SHINOBI_EMBED_PROVIDER` | `none` | `openai` / `voyage` / `ollama` / `none` |
| `SHINOBI_EMBED_API_KEY` | — | Auth for OpenAI / Voyage (else falls back to `OPENAI_API_KEY` / `VOYAGE_API_KEY`) |
| `SHINOBI_EMBED_MODEL` | provider default | Override model id |
| `SHINOBI_EMBED_DIMS` | provider default | Override dimensions |
| `SHINOBI_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `SHINOBI_MIGRATIONS_DIR` | `<package>/migrations` | Override migrations source |

Full reference: [docs/configuration.md](docs/configuration.md).

## Plugins

Write a single `.js` file in `~/.shinobi/plugins/`:

```js
// ~/.shinobi/plugins/my-plugin.js
export default function register(registry, api) {
  registry.registerTool({
    name: 'plugin_count_open',
    description: 'Count open decisions across all projects',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, api) => {
      const projects = api.listProjects();
      let total = 0;
      for (const p of projects) {
        total += api.listDecisions({ projectId: p.id, status: 'open' }).length;
      }
      return { open_decisions: total };
    },
  });
}
```

Restart the MCP client and `mcp__shinobi__plugin_count_open` is available. See [docs/plugin-development.md](docs/plugin-development.md).

## Roadmap

- **v0.1 (current)** — local MCP + dashboard + plugin system + git sync + relay
  + optional embeddings + voice + mobile push + VS Code/Cursor extensions.
- **v0.2** — multi-user team mode (auth + members + mentions UI), vite/dev-deps
  upgrade, plugin marketplace UI polish, deeper integrations (Linear /
  GitHub Issues sync candidates).
- **v0.3** — hosted SaaS GA + Stripe billing.
- **v1.0** — stability, audit, performance pass.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

For vulnerability reports, see [SECURITY.md](SECURITY.md) — please do
**not** open public issues for security matters.

## License

MIT — see [LICENSE](LICENSE).
