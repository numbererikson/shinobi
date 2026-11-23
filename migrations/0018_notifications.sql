-- Inbox: every push the server sends is also kept here, so a notification
-- that vanished from the phone can still be read in the dashboard. Tapping a
-- push opens its entry (/inbox#n<id>); `url` is where the sender wanted it to
-- lead (shown as a link). Old rows are pruned on insert.
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tag         TEXT,
  url         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);
