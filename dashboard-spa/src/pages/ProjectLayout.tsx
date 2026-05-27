import { useCallback, useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { ProjectTabs } from '../components/ProjectTabs';
import { PriorityBadge, StatusBadge } from '../components/ui/Badge';
import { WorkspaceBadge } from '../components/WorkspaceBadge';
import { getProjectSnapshot, type ProjectSnapshot } from '../lib/api';
import { timeSince } from '../lib/format';

export interface ProjectOutletCtx {
  snapshot: ProjectSnapshot;
  refresh: () => Promise<void>;
}

export function ProjectLayout() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const fresh = await getProjectSnapshot(id);
      setSnapshot(fresh);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    setSnapshot(null);
    setErr(null);
    void refresh();
  }, [id, refresh]);

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!snapshot) return <div className="text-text-muted">loading...</div>;

  const { project } = snapshot;

  return (
    <div>
      <header className="border-b border-border pb-3 mb-4">
        <h1 className="text-2xl text-text">{project.title}</h1>
        <div className="mt-2 text-xs text-text-muted flex items-center gap-2 flex-wrap">
          <WorkspaceBadge workspace={project.workspace} />
          <span>·</span>
          <StatusBadge status={project.status} />
          <span>·</span>
          <PriorityBadge priority={project.priority} />
          {project.due_date && (
            <>
              <span>·</span>
              <span>due {project.due_date}</span>
            </>
          )}
          {project.target_path && (
            <>
              <span>·</span>
              <span className="font-mono">target {project.target_path}</span>
            </>
          )}
          {project.recent_summary_at && (
            <>
              <span>·</span>
              <span>summary {timeSince(project.recent_summary_at)}</span>
            </>
          )}
        </div>
      </header>

      <ProjectTabs projectId={id} draftPendingCount={snapshot.draft_counts.pending} />

      <Outlet context={{ snapshot, refresh } satisfies ProjectOutletCtx} />
    </div>
  );
}
