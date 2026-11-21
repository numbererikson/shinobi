-- Plugin push notification buttons (registry.notify).
--
-- Each button on a plugin notification gets an unguessable one-time token.
-- The service worker only ever sends the token back; the server maps it to the
-- plugin's own tool and arguments. All buttons of one notification share a
-- notification_id: pressing one marks every sibling used, so e.g. "Done" and
-- "Snooze" on the same reminder can never both run.
CREATE TABLE IF NOT EXISTS plugin_push_actions (
  token           TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  plugin          TEXT NOT NULL,
  tool            TEXT NOT NULL,
  args            TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  used_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugin_push_actions_notification ON plugin_push_actions (notification_id);
CREATE INDEX IF NOT EXISTS idx_plugin_push_actions_expires ON plugin_push_actions (expires_at);
