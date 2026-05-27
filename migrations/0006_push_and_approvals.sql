-- Web push subscriptions + approval queue.
-- Approvals: agent fires request_approval(project_id, prompt, options) → row
-- created, push sent to all subscriptions → user taps response on phone →
-- row.status flips → blocking MCP tool returns answer.

CREATE TABLE push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  device_label TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TEXT,
  last_error   TEXT
);

CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

CREATE TABLE approvals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  session_id      TEXT,
  prompt          TEXT NOT NULL,
  options_json    TEXT NOT NULL DEFAULT '["yes","no"]',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','responded','expired','cancelled')),
  response_value  TEXT,
  response_note   TEXT,
  responded_at    TEXT,
  responded_by    TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_approvals_status     ON approvals(status);
CREATE INDEX idx_approvals_project    ON approvals(project_id);
CREATE INDEX idx_approvals_created_at ON approvals(created_at);
