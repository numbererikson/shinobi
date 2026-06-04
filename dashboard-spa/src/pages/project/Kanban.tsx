import { Check, Play, Undo2 } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { PriorityBadge } from '../../components/ui/Badge';
import { patchSubtask } from '../../lib/api';
import type { Status, Subtask } from '../../lib/types';
import type { ProjectOutletCtx } from '../ProjectLayout';

const COLS: Array<{ key: Status; label: string }> = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export function Kanban() {
  const { snapshot, refresh, openSubtask } = useOutletContext<ProjectOutletCtx>();
  const { project, subtasks } = snapshot;

  const byCol: Record<Status, Subtask[]> = { todo: [], in_progress: [], done: [] };
  for (const s of subtasks) byCol[s.status].push(s);

  async function transition(id: number, status: Status) {
    try {
      await patchSubtask(id, { status });
      await refresh();
    } catch (e) {
      alert('Transition failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <>
      {project.description && (
        <pre className="bg-panel border border-border rounded p-3 mb-6 whitespace-pre-wrap text-xs font-mono text-text">
          {project.description}
        </pre>
      )}

      {project.recent_summary_md && (
        <div className="bg-panel border border-border border-l-4 border-l-accent rounded-md p-4 mb-6">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
            Recent session summary
            {project.recent_summary_provider && (
              <span className="text-text-dim normal-case ml-2 tracking-normal">
                via {project.recent_summary_provider}
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
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSubtask(s.id)}
                    className="w-full text-left bg-panel-2 border border-border rounded p-2.5 text-xs hover:border-accent/60 hover:bg-panel transition-colors cursor-pointer"
                  >
                    <div className="text-text font-medium mb-1">{s.title}</div>
                    <div className="text-text-muted flex flex-wrap gap-2 items-center text-[11px]">
                      <PriorityBadge priority={s.priority} />
                      {s.due_date && <span>due {s.due_date}</span>}
                      {s.depends_on && s.depends_on.length > 0 && (
                        <span>deps: {s.depends_on.join(',')}</span>
                      )}
                      {s.claude_session_id && <span title={s.claude_session_id}>session</span>}
                    </div>
                    <div
                      className="flex gap-1.5 mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
