-- Multi-workspace support: tag each project with the codebase it belongs to
-- (shinobi / shinobiapps / sitesnap / ...). Free-form text so the user can
-- introduce new workspaces later without a migration.

ALTER TABLE projects ADD COLUMN workspace TEXT;

CREATE INDEX idx_projects_workspace ON projects(workspace);
