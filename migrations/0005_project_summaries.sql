-- Session summary compression: every session-close (or manual trigger) folds
-- recent activity + decisions + dead_ends into a terse 3-paragraph summary
-- stored on the project. agent_bootstrap surfaces it on next session start
-- so the next session opens with signal instead of raw 270-row noise.

ALTER TABLE projects ADD COLUMN recent_summary_md       TEXT;
ALTER TABLE projects ADD COLUMN recent_summary_at       TEXT;
ALTER TABLE projects ADD COLUMN recent_summary_provider TEXT;

CREATE INDEX idx_projects_recent_summary_at ON projects(recent_summary_at);
