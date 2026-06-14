# Shinobi

[![Website](https://img.shields.io/badge/Website-shinobi--apps.com-c96442)](https://shinobi-apps.com/shinobi)
[![test](https://github.com/numbererikson/shinobi/actions/workflows/test.yml/badge.svg)](https://github.com/numbererikson/shinobi/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

The task spine for AI coding agents. Shinobi holds the decisions that survive across sessions, **actively searches your past dead ends — semantically — before the agent writes code**, and routes approvals to your phone. One brain, every device: laptop, cloud session, and mobile all wired to the same store.

Works with Claude Code, Cursor, Cline, Continue.dev, Zed — any MCP-compatible client.

> **Status:** v0.2 — remote MCP foundation. Run it as a hosted HTTP `/mcp` brain (the default deploy) or self-host a local instance. 38 MCP tools, web dashboard, mobile approvals, plugin system, optional semantic recall.

## What it does

Most tools try to be a memory bolt-on. Shinobi is the **task spine** your agent
works *along* — the durable backbone of work, decisions, and known-bad paths
that outlives any single session and follows you across every device.

- **Task spine** — projects + subtasks the agent claims, completes, or pivots; the persistent skeleton of multi-session work
- **Decisions that survive** — record architectural choices with rationale so the next session (on any device) doesn't re-litigate them
- **Dead ends, searched before you build** — every failed approach is logged and **semantically matched the moment an agent plans a similar one**, so it never burns a second session on the same wall. No other tool does this.
- **Approvals on your phone** — `request_approval` pushes the decision to your pocket; the agent blocks until you tap yes/no, wherever you are
- **One brain, every device** — laptop editor, Claude Code cloud session, and mobile chat all hit the same store over remote MCP; no sync step, no per-device drift
- **Plans** — versioned plan snapshots, retrievable mid-task
- **Context** — per-project conventions, "don't touch" rules, test patterns, deploy notes, file annotations
- **Recall** — fulltext (FTS5) by default, semantic (embedding-backed) when an embedding provider is configured
- **Notes** — free-form annotations and voice notes (audio_path field)
- **Activity timeline** — every write path lands in the timeline so you can replay what happened
- **Git linking** — `link_commit` ties commits to subtasks via `[SHI-N]` tags or via `target_path` attribution
- **Web dashboard** — Hono-served Kanban + decisions + dead ends + notes + plans + context + timeline + analytics
- **Plugin system** — drop a `.js` file in `~/.shinobi/plugins/` or install a `@shinobi/plugin-*` npm package and register custom `plugin_*` tools

**Hosted or self-hosted, your call.** The default deploy is one remote brain
behind an HTTP `/mcp` endpoint (we run ours at `shinobi.shinobi-apps.com`); the
same binary still runs as a fully local single-machine instance when you'd
rather keep everything on your own box. BYO embedding provider only if you want
semantic recall.

> 🚀 New here? Follow [Getting started](docs/getting-started.md) — zero to a
> working brain in ten minutes. Going multi-device? [Remote mode](docs/remote-mcp.md)
> + [$0/month cloud deploy](docs/deploy-gcp-free.md).

## Install

Requirements:

- Node.js 18+ on `PATH`
- C++ build toolchain for `better-sqlite3` native build (most systems have prebuilt binaries; Windows may need [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) as fallback)

### From npm (recommended)

```bash
npm install -g @shinobiapps/shinobi
```

The binary is `shinobi` (e.g. `shinobi serve`, `shinobi dashboard`).

### From GitHub (latest, unreleased)

```bash
npm install -g github:numbererikson/shinobi
```

Pulls from `main`. Useful for trying unreleased fixes. On Windows you may need
to add your Node directory to system `PATH` before this works, because the
`prepare` build script runs in a subshell that does not always inherit
per-session `PATH` (Laragon, portable installs). If install fails with `'node'
is not recognized`, prefer the npm install above.

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

`shinobi init` writes config for the two clients with a workspace-local
MCP convention out of the box:

- **Claude Code** — `<workspace>/.mcp.json`
- **Cursor** — `<workspace>/.cursor/mcp.json`

Restart the client and the `mcp__shinobi__*` tools become available.

For other MCP clients (Cline, Continue.dev, Zed), see the
[MCP client setup](#mcp-client-setup) section below.

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

## MCP client setup

Every snippet below uses the **same JSON shape** — `command` is the path
to the Node binary that's running Shinobi, `args` is `[<absolute path to
dist/cli.js>, "mcp"]`. Print the exact values for your machine:

```bash
shinobi init --print-config
```

(Or read `.mcp.json` from any project where you already ran
`shinobi init` — the values are identical.)

### Claude Code

Drops in automatically — `shinobi init` writes `<workspace>/.mcp.json`.
Restart Claude Code to pick up the server.

### Cursor

Drops in automatically — `shinobi init` writes `<workspace>/.cursor/mcp.json`.
Works on Cursor 0.43+. Restart Cursor or reload the workspace.

For a **global** Cursor config (every project sees Shinobi), paste the
same snippet into `~/.cursor/mcp.json` (or use Cursor Settings → MCP).

### Cline (VS Code extension)

Open Cline's settings file:

- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

Merge the contents of your project's `.mcp.json` into the file's
`mcpServers` object. Restart VS Code.

### Continue.dev

Edit `~/.continue/config.json`. Add Shinobi to the `mcpServers` array
(note: Continue uses an **array**, not an object like the others):

```json
{
  "mcpServers": [
    {
      "name": "shinobi",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/dist/cli.js", "mcp"]
    }
  ]
}
```

Use the values from your project's `.mcp.json` for `command` and `args`.

### Zed

Edit `~/.config/zed/settings.json`. Zed nests MCP servers under
`context_servers`:

```json
{
  "context_servers": {
    "shinobi": {
      "command": {
        "path": "/absolute/path/to/node",
        "args": ["/absolute/path/to/dist/cli.js", "mcp"]
      }
    }
  }
}
```

Restart Zed.

### Generic / other clients

Any MCP client that supports the standard `{ command, args }` server spec
should work. Use the same values your `.mcp.json` has:

- `command`: absolute path to the Node binary running Shinobi
- `args`: `[<absolute path to dist/cli.js>, "mcp"]`

Avoid the bare `shinobi` command in MCP config — many clients spawn
servers with `shell: false`, which skips the OS PATH resolution that
makes `shinobi` work in a terminal.

### Remote mode (the default deploy)

Host one Shinobi brain on a server and connect every device to it — your
desktop editor, Claude Code web/mobile sessions, any remote-MCP-capable
client. `shinobi serve` exposes the MCP endpoint at `/mcp` (streamable HTTP,
**stateless**, bearer-token auth) alongside the dashboard:

```bash
claude mcp add --transport http shinobi https://your-host/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

This is the recommended way to run Shinobi — one brain, reachable from every
device. The same binary still runs as a local single-machine instance if you'd
rather self-host everything on your own box. Full deployment guide (Docker,
Cloudflare Tunnel, GCP Always Free, client config):
[docs/remote-mcp.md](docs/remote-mcp.md).

## CLI

```
shinobi <command> [options]

Commands:
  init                            Bootstrap ~/.shinobi/ and drop .mcp.json in the current directory
  mcp                             Run the MCP server over stdio (invoked by the MCP client)
  migrate                         Apply pending SQL migrations
  dashboard                       Start the web dashboard on localhost (default port 8765)
  serve [--host H] [--port P]     Dashboard + MCP HTTP endpoint (/mcp) in one process — see docs/remote-mcp.md
  sync init <path> [branch]       Configure a local git repo as the cross-machine sync target
  sync push                       Snapshot the DB and commit it to the sync repo
  sync pull                       Restore the DB from the sync repo's snapshot
  sync status                     Show last push/pull timestamps and git status
  dispatch [--once] [--project N] Autonomous loop: pull next_task → run worker → complete/unblock → repeat
           [--interval S] [--max-failures N]    Worker via SHINOBI_WORKER_CMD (e.g. 'claude -p "$SHINOBI_TASK_PROMPT"'); unset → dry-run
```

## MCP tools (38)

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
| Extraction | extract_decisions, compress_session_summary |
| Approvals | request_approval |
| Notifications | notify |
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

- **v0.2 (current)** — remote MCP foundation: stateless HTTP `/mcp` endpoint,
  Docker + GCP Always Free deploy, Cloudflare Tunnel, env-driven `.mcp.json`
  for cloud sessions. One brain across laptop, cloud, and mobile.
- **v0.3** — push notifications (task-completed / agent-blocked) → dispatch loop
  (headless agent pulls `next_task` and works while you sleep) → Shinobi Swarm
  (N parallel agents, worktree isolation, shared dead ends).
- **v0.4** — audit→remediation templates (finding list → subtask graph → swarm),
  unit-test coverage pass on `tools/*`.
- **v1.0** — stability, security audit, performance pass; optional team mode /
  hosted SaaS only on demand signal.

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
