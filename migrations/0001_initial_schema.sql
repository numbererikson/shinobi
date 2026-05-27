-- Shinobi initial schema.
-- SQLite with FTS5 virtual tables for fulltext, BLOB for embeddings,
-- TEXT CHECK for enums. No table prefixes — each connection scopes a
-- single Shinobi store.

-- =====================================================================
-- projects
-- =====================================================================
CREATE TABLE projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  description     TEXT,
  status          TEXT    NOT NULL DEFAULT 'todo'    CHECK (status   IN ('todo','in_progress','done')),
  priority        TEXT    NOT NULL DEFAULT 'medium'  CHECK (priority IN ('low','medium','high','urgent')),
  project_type    TEXT,
  target_path     TEXT,
  archived_at     TEXT,
  due_date        TEXT,
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_projects_status       ON projects(status);
CREATE INDEX idx_projects_priority     ON projects(priority);
CREATE INDEX idx_projects_due_date     ON projects(due_date);
CREATE INDEX idx_projects_created_at   ON projects(created_at);
CREATE INDEX idx_projects_project_type ON projects(project_type);

CREATE TRIGGER trg_projects_updated_at
AFTER UPDATE OF title, description, status, priority, project_type, target_path, archived_at, due_date
ON projects FOR EACH ROW
BEGIN
  UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- =====================================================================
-- subtasks
-- =====================================================================
CREATE TABLE subtasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title               TEXT    NOT NULL,
  description         TEXT,
  depends_on          TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  status              TEXT    NOT NULL DEFAULT 'todo'   CHECK (status   IN ('todo','in_progress','done')),
  priority            TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_date            TEXT,
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claude_session_id   TEXT,
  last_claimed_at     TEXT,
  files_touched       TEXT,
  scope_warning_at    TEXT
);

CREATE INDEX idx_subtasks_project_id ON subtasks(project_id);
CREATE INDEX idx_subtasks_status     ON subtasks(status);
CREATE INDEX idx_subtasks_priority   ON subtasks(priority);
CREATE INDEX idx_subtasks_due_date   ON subtasks(due_date);
CREATE INDEX idx_subtasks_session    ON subtasks(claude_session_id);

CREATE TRIGGER trg_subtasks_updated_at
AFTER UPDATE OF project_id, title, description, depends_on, sort_order, status, priority, due_date, claude_session_id, last_claimed_at, files_touched, scope_warning_at
ON subtasks FOR EACH ROW
BEGIN
  UPDATE subtasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE VIRTUAL TABLE subtasks_fts USING fts5(
  title,
  description,
  content='subtasks',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_subtasks_fts_ai AFTER INSERT ON subtasks BEGIN
  INSERT INTO subtasks_fts(rowid, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;
CREATE TRIGGER trg_subtasks_fts_ad AFTER DELETE ON subtasks BEGIN
  INSERT INTO subtasks_fts(subtasks_fts, rowid, title, description)
    VALUES ('delete', OLD.id, OLD.title, COALESCE(OLD.description, ''));
END;
CREATE TRIGGER trg_subtasks_fts_au AFTER UPDATE ON subtasks BEGIN
  INSERT INTO subtasks_fts(subtasks_fts, rowid, title, description)
    VALUES ('delete', OLD.id, OLD.title, COALESCE(OLD.description, ''));
  INSERT INTO subtasks_fts(rowid, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

-- =====================================================================
-- decisions
-- =====================================================================
CREATE TABLE decisions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id               INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subtask_id               INTEGER          REFERENCES subtasks(id) ON DELETE SET NULL,
  kind                     TEXT    NOT NULL DEFAULT 'other' CHECK (kind   IN ('architecture','library','pattern','tradeoff','workaround','other')),
  summary                  TEXT    NOT NULL,
  rationale                TEXT    NOT NULL,
  alternatives_considered  TEXT,
  files_touched            TEXT,
  tags                     TEXT,
  status                   TEXT    NOT NULL DEFAULT 'open'  CHECK (status IN ('open','fix_now','fix_later','wontfix','fixed','false_positive')),
  decided_at               TEXT,
  decided_by_session_id    TEXT,
  fixed_in_commit_sha      TEXT,
  claude_session_id        TEXT,
  created_at               TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  embedding                BLOB,
  embedding_provider       TEXT,
  embedding_dims           INTEGER
);

CREATE INDEX idx_decisions_project            ON decisions(project_id);
CREATE INDEX idx_decisions_subtask            ON decisions(subtask_id);
CREATE INDEX idx_decisions_session            ON decisions(claude_session_id);
CREATE INDEX idx_decisions_status_project    ON decisions(project_id, status);
CREATE INDEX idx_decisions_embedding_provider ON decisions(embedding_provider);

CREATE VIRTUAL TABLE decisions_fts USING fts5(
  summary,
  rationale,
  alternatives_considered,
  content='decisions',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_decisions_fts_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, summary, rationale, alternatives_considered)
    VALUES (NEW.id, NEW.summary, NEW.rationale, COALESCE(NEW.alternatives_considered, ''));
END;
CREATE TRIGGER trg_decisions_fts_ad AFTER DELETE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, summary, rationale, alternatives_considered)
    VALUES ('delete', OLD.id, OLD.summary, OLD.rationale, COALESCE(OLD.alternatives_considered, ''));
END;
CREATE TRIGGER trg_decisions_fts_au AFTER UPDATE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, summary, rationale, alternatives_considered)
    VALUES ('delete', OLD.id, OLD.summary, OLD.rationale, COALESCE(OLD.alternatives_considered, ''));
  INSERT INTO decisions_fts(rowid, summary, rationale, alternatives_considered)
    VALUES (NEW.id, NEW.summary, NEW.rationale, COALESCE(NEW.alternatives_considered, ''));
END;

-- =====================================================================
-- dead_ends
-- =====================================================================
CREATE TABLE dead_ends (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  attempted_approach  TEXT    NOT NULL,
  failure_reason      TEXT    NOT NULL,
  files_involved      TEXT,
  never_retry         INTEGER NOT NULL DEFAULT 0 CHECK (never_retry IN (0,1)),
  claude_session_id   TEXT,
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  embedding           BLOB,
  embedding_provider  TEXT,
  embedding_dims      INTEGER
);

CREATE INDEX idx_dead_ends_project            ON dead_ends(project_id);
CREATE INDEX idx_dead_ends_session            ON dead_ends(claude_session_id);
CREATE INDEX idx_dead_ends_embedding_provider ON dead_ends(embedding_provider);

CREATE VIRTUAL TABLE dead_ends_fts USING fts5(
  attempted_approach,
  failure_reason,
  content='dead_ends',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_dead_ends_fts_ai AFTER INSERT ON dead_ends BEGIN
  INSERT INTO dead_ends_fts(rowid, attempted_approach, failure_reason)
    VALUES (NEW.id, NEW.attempted_approach, NEW.failure_reason);
END;
CREATE TRIGGER trg_dead_ends_fts_ad AFTER DELETE ON dead_ends BEGIN
  INSERT INTO dead_ends_fts(dead_ends_fts, rowid, attempted_approach, failure_reason)
    VALUES ('delete', OLD.id, OLD.attempted_approach, OLD.failure_reason);
END;
CREATE TRIGGER trg_dead_ends_fts_au AFTER UPDATE ON dead_ends BEGIN
  INSERT INTO dead_ends_fts(dead_ends_fts, rowid, attempted_approach, failure_reason)
    VALUES ('delete', OLD.id, OLD.attempted_approach, OLD.failure_reason);
  INSERT INTO dead_ends_fts(rowid, attempted_approach, failure_reason)
    VALUES (NEW.id, NEW.attempted_approach, NEW.failure_reason);
END;

-- =====================================================================
-- notes
-- =====================================================================
CREATE TABLE notes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  body                TEXT    NOT NULL,
  tags                TEXT,
  files_touched       TEXT,
  audio_path          TEXT,
  claude_session_id   TEXT,
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  embedding           BLOB,
  embedding_provider  TEXT,
  embedding_dims      INTEGER
);

CREATE INDEX idx_notes_project            ON notes(project_id);
CREATE INDEX idx_notes_session            ON notes(claude_session_id);
CREATE INDEX idx_notes_created            ON notes(created_at);
CREATE INDEX idx_notes_embedding_provider ON notes(embedding_provider);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  body,
  content='notes',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, body) VALUES (NEW.id, NEW.body);
END;
CREATE TRIGGER trg_notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', OLD.id, OLD.body);
END;
CREATE TRIGGER trg_notes_fts_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', OLD.id, OLD.body);
  INSERT INTO notes_fts(rowid, body) VALUES (NEW.id, NEW.body);
END;

-- =====================================================================
-- plans (versioned)
-- =====================================================================
CREATE TABLE plans (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version             INTEGER NOT NULL DEFAULT 1,
  plan_md             TEXT    NOT NULL,
  claude_session_id   TEXT,
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, version)
);

CREATE INDEX idx_plans_project_latest ON plans(project_id, created_at);

-- =====================================================================
-- context (one row per project)
-- =====================================================================
CREATE TABLE context (
  project_id               INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  conventions              TEXT,
  dont_touch               TEXT,
  test_patterns            TEXT,
  deploy_notes             TEXT,
  file_annotations         TEXT,
  last_validated_commit    TEXT,
  updated_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_context_updated_at
AFTER UPDATE OF conventions, dont_touch, test_patterns, deploy_notes, file_annotations, last_validated_commit
ON context FOR EACH ROW
BEGIN
  UPDATE context SET updated_at = CURRENT_TIMESTAMP WHERE project_id = NEW.project_id;
END;

-- =====================================================================
-- sessions
-- =====================================================================
CREATE TABLE sessions (
  session_id           TEXT    PRIMARY KEY,
  project_id           INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  subtask_id           INTEGER REFERENCES subtasks(id) ON DELETE SET NULL,
  started_at           TEXT    NOT NULL,
  ended_at             TEXT,
  duration_seconds     INTEGER,
  tool_calls_count     INTEGER NOT NULL DEFAULT 0,
  files_touched_count  INTEGER NOT NULL DEFAULT 0,
  notes                TEXT
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_subtask ON sessions(subtask_id);
CREATE INDEX idx_sessions_started ON sessions(started_at);
