# Embedding providers

Shinobi computes vector embeddings for decisions, dead-ends, notes, and
subtasks so `recall` (and a few other tools) can do semantic search.
Embedding is **optional** — when no provider is available, recall falls
back to SQLite FTS5 full-text search.

## Provider chain

`SHINOBI_EMBED_PROVIDER` controls which provider is used:

| Value | Behaviour |
|---|---|
| `auto` *(default)* | Detect in order: ollama → voyage → openai → none |
| `ollama` | Use local Ollama only |
| `voyage` | Use Voyage AI (free tier) — requires `VOYAGE_API_KEY` |
| `openai` | Use OpenAI — requires `OPENAI_API_KEY` |
| `none` | Skip embedding entirely; force fulltext mode |

The detection chain is intentionally biased toward free/local:

1. **Ollama** — probes `http://localhost:11434/api/tags`. If reachable AND
   has a `nomic-embed-text` model installed → use it. Zero cost, zero
   network. Best for solo / offline workflows.
2. **Voyage** — if `VOYAGE_API_KEY` set in `~/.shinobi/.env` (or env var).
   Free tier covers ~50M tokens/month.
3. **OpenAI** — if `OPENAI_API_KEY` set. Paid only; selected last.
4. **none** — semantic recall disabled, fulltext FTS5 still works for keyword
   queries.

## Quickstart: free local embeddings

```sh
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh   # macOS/Linux
# Windows: download from https://ollama.com/download

# 2. Pull the embedding model (~250 MB, runs entirely on CPU)
ollama pull nomic-embed-text

# 3. Restart the dashboard — auto-detection picks ollama
shinobi dashboard
```

The startup log will print the detection result the first time embedding
runs (next time you call `recall` or write a decision):

```
embedding auto-detect:
  ollama: reachable=true has_nomic=true (http://localhost:11434)
  voyage api key: absent
  openai api key: absent
  → selected: ollama
```

## Inspecting detection

Dashboard endpoint:

```sh
curl http://127.0.0.1:8765/api/embedding/detect
```

Returns the full detection result without instantiating the provider.
Useful for verifying that the agent will pick what you expect before
running a write that would generate embeddings.

## Pinning to a specific provider

When you want to force a choice instead of detection, set
`SHINOBI_EMBED_PROVIDER` explicitly:

```ini
# ~/.shinobi/.env
SHINOBI_EMBED_PROVIDER=voyage
VOYAGE_API_KEY=pa-...
```

The change requires a dashboard restart (`requiresRestart=true` on the
setting). Embedding provider instances are cached for the process lifetime
to avoid re-detecting on every call.

## Embed failures are non-fatal

If embedding fails (network down, Ollama process died, API rate-limited),
the write to the underlying row still succeeds — `embedding`, `embedding_provider`,
and `embedding_dims` are left NULL on that row and a warning is logged to
stderr. The semantic search ignores rows without a current-provider
embedding, so a partial-coverage DB still produces correct (if narrower)
results. You can re-run a backfill later when the provider is back.

## Custom model / dimensions

Override the default model per provider:

```ini
SHINOBI_EMBED_MODEL=nomic-embed-text:v1.5    # ollama
SHINOBI_EMBED_MODEL=voyage-3                  # voyage
SHINOBI_EMBED_MODEL=text-embedding-3-large    # openai
SHINOBI_EMBED_DIMS=1536                       # only honored by openai (matryoshka)
SHINOBI_OLLAMA_URL=http://other-host:11434    # remote Ollama
```

## Why the cache

Detection probes Ollama on each call by hitting `/api/tags`. To keep
hot-path embed calls fast, we cache the resolved provider instance for
the lifetime of the process. Settings changes require a dashboard restart
anyway (`requiresRestart=true`), so the cache is never stale during a
normal session.
