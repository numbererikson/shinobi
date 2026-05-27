-- Activity timeline + manual git commit linking + subtask embeddings.

ALTER TABLE subtasks ADD COLUMN embedding          BLOB;
ALTER TABLE subtasks ADD COLUMN embedding_provider TEXT;
ALTER TABLE subtasks ADD COLUMN embedding_dims     INTEGER;

CREATE INDEX idx_subtasks_embedding_provider ON subtasks(embedding_provider);

CREATE TABLE activity (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  session_id      TEXT,
  action_type     TEXT NOT NULL,
  action_details  TEXT,
  entity_type     TEXT,
  entity_id       INTEGER,
  ref_url         TEXT,
  ref_status      TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_project    ON activity(project_id);
CREATE INDEX idx_activity_created_at ON activity(created_at);
CREATE INDEX idx_activity_entity     ON activity(entity_type, entity_id);
CREATE INDEX idx_activity_session    ON activity(session_id);
CREATE INDEX idx_activity_action     ON activity(action_type);
