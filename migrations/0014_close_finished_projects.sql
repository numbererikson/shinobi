-- Projects now close themselves when their last task is done (models/subtasks
-- syncProjectStatus). Bring existing data in line once: every project whose
-- tasks are all done, and that has at least one task, becomes 'done'.
UPDATE projects
SET status = 'done'
WHERE status <> 'done'
  AND id IN (
    SELECT project_id FROM subtasks
    WHERE project_id IS NOT NULL
    GROUP BY project_id
    HAVING COUNT(*) = SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)
  );
