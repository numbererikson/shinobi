import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Play, Undo2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PriorityBadge, StatusBadge } from '../components/ui/Badge';
import { WorkspaceBadge } from '../components/WorkspaceBadge';
import { getProjectSnapshot, patchSubtask, type ProjectSnapshot } from '../lib/api';
import { timeSince } from '../lib/format';
import type { Status, Subtask } from '../lib/types';

const COLS: Array<{ key: Status; label: string }> = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export function Project() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    setSnapshot(null);
    setErr(null);
    getProjectSnapshot(id)
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!snapshot) return <div className="text-text-muted">loading...</div>;

  const { project, subtasks } = snapshot;
  const byCol: Record<Status, Subtask[]> = { todo: [], in_progress: [], done: [] };
  for (const s of subtasks) byCol[s.status].push(s);

  async function transition(subtaskId: number, status: Status) {
    try {
      await patchSubtask(subtaskId, { status });
      const fresh = await getProjectSnapshot(id);
      setSnapshot(fresh);
    } catch (e) {
      alert('Transition failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

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
          {project.due_date && (<><span>·</span><span>due {project.due_date}</span></>)}
          {project.target_path && (<><span>·</span><span className="font-mono">target {project.target_path}</span></>)}
        </div>
      </header>

      {project.description && (
        <pre className="bg-panel border border-border rounded p-3 mb-6 whitespace-pre-wrap text-xs font-mono text-text">
          {project.description}
        </pre>
      )}

      {project.recent_summary_md && (
        <div className="bg-panel border border-border border-l-4 border-l-accent rounded-md p-4 mb-6">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
            Recent session summary
            {project.recent_summary_at && (
              <span className="text-text-dim normal-case ml-2 tracking-normal">
                · {timeSince(project.recent_summary_at)}
                {project.recent_summary_provider && ` via ${project.recent_summary_provider}`}
              </span>
            )}
          </div>
          <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">
            {project.recent_summary_md}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLS.map((col) => (
          <div key={col.key} className="bg-panel border border-border rounded-md p-3 min-h-[200px]">
            <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-3">
              {col.label} ({byCol[col.key].length})
            </h3>
            <div className="space-y-2">
              {byCol[col.key].length === 0 ? (
                <div className="text-text-dim text-xs">(empty)</div>
              ) : (
                byCol[col.key].map((s) => (
                  <div key={s.id} className="bg-panel-2 border border-border rounded p-2.5 text-xs">
                    <div className="text-text font-medium mb-1">{s.title}</div>
                    <div className="text-text-muted flex flex-wrap gap-2 items-center text-[11px]">
                      <PriorityBadge priority={s.priority} />
                      {s.due_date && <span>due {s.due_date}</span>}
                      {s.depends_on && s.depends_on.length > 0 && <span>deps: {s.depends_on.join(',')}</span>}
                      {s.claude_session_id && <span title={s.claude_session_id}>session</span>}
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      {s.status !== 'todo' && (
                        <Button size="sm" variant="ghost" onClick={() => void transition(s.id, 'todo')} className="flex items-center gap-1">
                          <Undo2 className="w-3 h-3" /> todo
                        </Button>
                      )}
                      {s.status !== 'in_progress' && (
                        <Button size="sm" variant="ghost" onClick={() => void transition(s.id, 'in_progress')} className="flex items-center gap-1">
                          <Play className="w-3 h-3" /> in progress
                        </Button>
                      )}
                      {s.status !== 'done' && (
                        <Button size="sm" variant="ghost" onClick={() => void transition(s.id, 'done')} className="flex items-center gap-1">
                          <Check className="w-3 h-3" /> done
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
