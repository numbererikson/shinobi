# Shinobi configuration

All configuration is via environment variables. `~/.shinobi/.env` is loaded automatically by the CLI; values in `process.env` take precedence.

## Storage

| Variable | Default | Purpose |
|---|---|---|
| `SHINOBI_DB_PATH` | `~/.shinobi/shinobi.db` | SQLite file. WAL mode is enforced; the directory is created if missing. |
| `SHINOBI_CONFIG_DIR` | `~/.shinobi` | Where `config.json` and `.env` live. The default plugins directory is also derived from this. |
| `SHINOBI_MIGRATIONS_DIR` | `<package>/migrations` | Override the migrations source. Useful only for dev / testing. |

## Dashboard

| Variable | Default | Purpose |
|---|---|---|
| `SHINOBI_DASHBOARD_PORT` | `8765` | Dashboard HTTP port. |
| `SHINOBI_DASHBOARD_HOST` | `127.0.0.1` | Bind host. Loopback (`127.0.0.1`, `localhost`, `::1`) skips auth; anything else (e.g. `0.0.0.0` for LAN access) auto-enables token auth. |
| `SHINOBI_DASHBOARD_TOKEN` | _(none)_ | Override the dashboard auth token. When unset and a non-loopback host is used, a token is auto-generated and persisted to `~/.shinobi/dashboard-token`. |

### Auth flow (non-loopback only)

When the dashboard binds to a non-loopback host, every route except `GET /health` requires a token. Accepted credential locations, checked in order:

1. `Authorization: Bearer <token>` header
2. `X-Shinobi-Token: <token>` header
3. `shinobi_token` cookie (set automatically after a successful `?token=` query)
4. `?token=<token>` query string — used once, the response sets the cookie

Loopback binds skip the middleware entirely so local development stays zero-friction. The token file is created with `0600` permissions on POSIX systems.

## Plugins

| Variable | Default | Purpose |
|---|---|---|
| `SHINOBI_PLUGINS_DIR` | `~/.shinobi/plugins` | Directory scanned for user-tier plugins (`.js` / `.mjs` files). |

Npm-tier plugins are discovered from `node_modules/@shinobi/plugin-*` in the current working directory at server start.

## Embeddings (optional)

Shinobi falls back to FTS5 fulltext search by default. Configure a provider to enable semantic recall.

| Variable | Values | Default |
|---|---|---|
| `SHINOBI_EMBED_PROVIDER` | `openai` / `voyage` / `ollama` / `none` | `none` |
| `SHINOBI_EMBED_API_KEY` | provider auth token | falls back to `OPENAI_API_KEY` / `VOYAGE_API_KEY` |
| `SHINOBI_EMBED_MODEL` | model identifier | `text-embedding-3-small` (OpenAI) / `voyage-3-lite` (Voyage) / `nomic-embed-text` (Ollama) |
| `SHINOBI_EMBED_DIMS` | integer | `1536` (OpenAI) / `512` (Voyage) / `768` (Ollama) |
| `SHINOBI_OLLAMA_URL` | URL | `http://localhost:11434` |

When a provider is configured, write paths (`log_decision`, `log_dead_end`, `add_note`, `create_task`, `bulk_create_tasks`) generate and store embeddings synchronously after the row insert. Read paths (`recall`, `check_dead_ends`) prefer semantic match and fall back to FTS5 when no embedding is available.

## Recall mode

`recall` accepts an optional `mode` argument: `auto` (default), `semantic`, or `fulltext`. The `auto` mode picks semantic when an embedding provider is configured, otherwise fulltext.

## Sync

Configured per machine via `shinobi sync init`. The resulting `~/.shinobi/config.json` shape:

```json
{
  "sync": {
    "repo_path": "/path/to/local/clone",
    "branch": "main",
    "last_push_at": "2026-05-23T16:30:00.000Z",
    "last_pull_at": null
  }
}
```

There is no env override for sync paths — use `shinobi sync init <path> [branch]` to reconfigure.
