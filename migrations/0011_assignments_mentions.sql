-- Subtask ownership + mention tracking. Mentions are detected when a
-- decision/note/subtask body contains @<email-local-part>; the resolver
-- looks up the user by email LIKE '<localpart>@%' and records a row per
-- (entity, mentioned_user_id) so we can show "things mentioning me".
ALTER TABLE subtasks ADD COLUMN assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_subtasks_assignee ON subtasks(assignee_user_id);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,           -- 'decision' | 'subtask' | 'note'
  entity_id INTEGER NOT NULL,
  mentioned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mentions_user_unread ON mentions(mentioned_user_id, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_type, entity_id);
