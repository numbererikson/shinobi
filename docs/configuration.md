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
3. `shinobi_token` cookie (HttpOnly, 30 days), set by the sign-in form (`POST /auth/signin`)

Tokens are never accepted in the URL (`?token=`): a URL ends up in browser
history and in proxy and tunnel logs.

Loopback binds skip the middleware entirely so local development stays zero-friction. The token file is created with `0600` permissions on POSIX systems.

Without a credential, a browser gets a sign-in page with a token field. It posts the token, never puts it in the URL, and returns you to the page you opened. The sign-in lasts 30 days per device, including a home-screen app, which keeps its own cookies. Startup logs print where the token file is, never the token itself.

## Push notifications

Phones and browsers subscribe under **System → Push notifications** in the dashboard. On iPhone (iOS 16.4+) that only works from the app added to the home screen.

| Variable | Default | Purpose |
|---|---|---|
| `SHINOBI_VAPID_PUBLIC_KEY` / `SHINOBI_VAPID_PRIVATE_KEY` | _(generated)_ | Push signing keys. Generated on first use and written to `<config dir>/.env` (`/data/.env` in Docker). Changing them breaks every existing subscription, so devices must subscribe again. |
| `SHINOBI_VAPID_SUBJECT` | `SHINOBI_PUBLIC_URL` if https, else the project URL | Contact the push service sees: a `mailto:` address or an `https://` URL. Apple's push service rejects some values with `403 BadJwtToken`. The old default `mailto:operator@shinobi.local` (before 0.7.2) was one of them and is now ignored. |
| `SHINOBI_PUBLIC_URL` | _(none)_ | Public https origin of this Shinobi, e.g. `https://shinobi.example.com`. Used for OAuth metadata and as the default push subject. |

A failed send records the push service's status and reason (e.g. `403 BadJwtToken`, `410` = subscription gone, removed automatically). It shows on the Push page under each device, and in the log: `docker logs shinobi 2>&1 | grep web-push`.

## Plugins

| Variable | Default | Purpose |
|---|---|---|
| `SHINOBI_PLUGINS_DIR` | `~/.shinobi/plugins` | Directory scanned for user-tier plugins (`.js` / `.mjs` files). |

Npm-tier plugins are discovered from `node_modules/@shinobi/plugin-*` in the current working directory at server start.

## Rate limits

Public-facing routes are rate limited per client IP (`CF-Connecting-IP` /
`X-Forwarded-For`, falling back to a shared local bucket). Both windows are
one minute.

| Variable | Default | Applies to |
|---|---|---|
| `SHINOBI_MCP_RATE_LIMIT` | `240` | `POST /mcp` tool calls |
| `SHINOBI_AUTH_RATE_LIMIT` | `10` | `/api/auth/magic-link`, `/api/auth/verify` |

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

## Session summaries (LLM optional)

`session_closeout` always refreshes the project's `recent_summary_md`. With
`SHINOBI_LLM_PROVIDER` configured (e.g. `groq` + `GROQ_API_KEY`, or `openai`),
the server compresses recent activity, decisions and dead ends into a terse
digest. Without a provider it persists the agent-authored closeout summary
instead (`recent_summary_provider = agent:closeout`) — the calling agent is an
LLM too, so no external key is required for the brain to stay fresh.
`agent_bootstrap` flags a stale summary via `summary_stale` either way.

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
