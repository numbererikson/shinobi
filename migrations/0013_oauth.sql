-- OAuth 2.1 for the remote /mcp endpoint.
--
-- Lets claude.ai (and any MCP client that speaks the MCP authorization spec)
-- connect with a "Connect" button instead of a pasted token: the client
-- registers itself (RFC 7591), the owner approves once in the browser with
-- the dashboard token, and the client gets short-lived access tokens plus a
-- rotating refresh token. Only SHA-256 hashes of codes and tokens are stored.

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT NOT NULL,              -- JSON array of exact redirect URIs
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at   TEXT,                       -- first time the owner approved it
  last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,             -- PKCE S256
  expires_at     INTEGER NOT NULL           -- unix ms
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id  TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,              -- unix ms
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_tokens(client_id);
