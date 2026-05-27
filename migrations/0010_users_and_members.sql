-- Multi-user mode. Single-user installs remain transparent: when zero
-- users exist, the auth middleware impersonates the default master without
-- requiring login. Once any user is created, login is mandatory.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member',  -- master | member | viewer
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT,
  disabled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Per-project membership grants. Role here OVERRIDES the user's global role
-- when interacting with this project. The master role at the user level is
-- a superset that bypasses per-project checks.
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',  -- member | viewer
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

-- One-use, time-limited magic links. Issued via /api/auth/magic-link,
-- consumed via /api/auth/verify. The token itself is the random part;
-- nothing is sent over the wire except the URL.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_consumed ON auth_tokens(consumed_at);
