-- Links a GitHub pull request to a Shinobi subtask. Populated by the
-- /api/github/webhook handler when a PR is opened with [SHI-N] in its
-- title or body. Updated when the same PR closes/merges so the
-- subtask can auto-complete and the activity log can backfill the
-- merge timestamp + final URL.
CREATE TABLE IF NOT EXISTS pr_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subtask_id INTEGER NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  repo TEXT NOT NULL,             -- "owner/name"
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  title TEXT,
  state TEXT NOT NULL DEFAULT 'open',   -- open | closed | merged
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  merged_at TEXT,
  UNIQUE(repo, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_pr_links_subtask ON pr_links(subtask_id);
CREATE INDEX IF NOT EXISTS idx_pr_links_state ON pr_links(state);
