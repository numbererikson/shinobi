-- A dead end can stop applying (a dependency was upgraded, the bug was fixed
-- upstream). Marking it obsolete keeps the history but takes it out of
-- check_dead_ends and the Claude Code hooks, with the reason recorded.
ALTER TABLE dead_ends ADD COLUMN obsolete_at TEXT;
ALTER TABLE dead_ends ADD COLUMN obsolete_reason TEXT;
