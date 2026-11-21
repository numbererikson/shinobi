-- Modules: Development (projects, tasks, decisions, dead ends, …) and every
-- plugin are modules the owner can switch off. A disabled module's MCP tools
-- disappear from tools/list and refuse calls, and its dashboard pages are
-- hidden. No row = enabled, so a fresh install has everything on.
CREATE TABLE IF NOT EXISTS modules (
  id         TEXT PRIMARY KEY,           -- 'development' or a plugin name, e.g. 'user/shinobi-plugin-music'
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
