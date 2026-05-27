-- Local opt-in telemetry buffer. Only populated when SHINOBI_TELEMETRY=on.
-- Each row is a single anonymous event (e.g. "tool_called: log_decision").
-- payload_json is a small object with non-PII fields only — never task
-- titles, usernames, project content, or file paths. Optionally sent in
-- batches to SHINOBI_TELEMETRY_ENDPOINT; sent_at NULL means not yet
-- forwarded. Rows are kept locally so the user can inspect /telemetry
-- and see exactly what is/was reported.
CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_sent ON telemetry_events(sent_at);
