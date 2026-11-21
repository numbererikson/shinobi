-- Plugin schedules (registry.schedule): one row per fired slot.
--
-- Plugins load in every Shinobi process, but schedules only tick in the
-- long-lived dashboard process. Before a schedule runs, the scheduler claims
-- its minute slot with INSERT OR IGNORE on the primary key, so a slot runs at
-- most once — even across a restart within the same minute or two processes
-- sharing one database. `slot` is the UTC minute, e.g. '2026-11-21T08:00'.
CREATE TABLE IF NOT EXISTS plugin_schedule_runs (
  plugin      TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  slot        TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  error       TEXT,
  PRIMARY KEY (plugin, schedule_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_plugin_schedule_runs_started ON plugin_schedule_runs (started_at);
