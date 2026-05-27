-- Decision drafts: LLM-extracted candidates pending human review.
-- Pipeline: extract_decisions(text) → rows in decision_drafts (status=pending)
-- → user reviews in dashboard → approve creates real decision via logDecision +
-- sets status=approved + records approved_decision_id, reject sets status=rejected.

CREATE TABLE decision_drafts (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id             INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id             TEXT,
  kind                   TEXT NOT NULL DEFAULT 'other'  CHECK (kind   IN ('architecture','library','pattern','tradeoff','workaround','other')),
  summary                TEXT NOT NULL,
  rationale              TEXT NOT NULL,
  alternatives_considered TEXT,
  files_touched          TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_decision_id   INTEGER REFERENCES decisions(id) ON DELETE SET NULL,
  source                 TEXT NOT NULL DEFAULT 'extraction',
  extractor_model        TEXT,
  source_text_hash       TEXT,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at           TEXT
);

CREATE INDEX idx_decision_drafts_project        ON decision_drafts(project_id);
CREATE INDEX idx_decision_drafts_status         ON decision_drafts(status);
CREATE INDEX idx_decision_drafts_project_status ON decision_drafts(project_id, status);
CREATE INDEX idx_decision_drafts_session        ON decision_drafts(session_id);
CREATE INDEX idx_decision_drafts_source_hash    ON decision_drafts(source_text_hash);
