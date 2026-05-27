-- Per-session AI token usage + computed cost, ingested from Claude Code
-- (or compatible) JSONL transcripts. One row per session_id. Refreshed
-- by `shinobi cost ingest`; idempotent upsert.
CREATE TABLE IF NOT EXISTS session_costs (
  session_id TEXT PRIMARY KEY,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  assistant_turns INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  source_path TEXT,
  parsed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_costs_model ON session_costs(model);
