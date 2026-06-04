import { useOutletContext } from 'react-router-dom';
import { PriorityBadge, StatusBadge } from '../../components/ui/Badge';
import { timeSince } from '../../lib/format';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function Subtasks() {
  const { snapshot, openSubtask } = useOutletContext<ProjectOutletCtx>();
  const { subtasks } = snapshot;

  if (subtasks.length === 0) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No subtasks. Use <code>create_task</code> or <code>bulk_create_tasks</code> to seed.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
            <th className="font-medium pb-2 pr-3 w-12">ID</th>
            <th className="font-medium pb-2 pr-3">Title</th>
            <th className="font-medium pb-2 pr-3 w-28">Status</th>
            <th className="font-medium pb-2 pr-3 w-24">Priority</th>
            <th className="font-medium pb-2 pr-3 w-24">Deps</th>
            <th className="font-medium pb-2 pr-3 w-24">Due</th>
            <th className="font-medium pb-2 w-28">Claimed</th>
          </tr>
        </thead>
        <tbody>
          {subtasks.map((s) => (
            <tr
              key={s.id}
              className="border-b border-border/40 hover:bg-panel/40 align-top cursor-pointer"
              onClick={() => openSubtask(s.id)}
            >
              <td className="py-2 pr-3 text-text-muted font-mono">{s.id}</td>
              <td className="py-2 pr-3">
                <div className="text-text font-medium">{s.title}</div>
                {s.description && (
                  <div className="text-text-muted text-xs mt-1">
                    {s.description.length > 200 ? s.description.slice(0, 200) + '…' : s.description}
                  </div>
                )}
              </td>
              <td className="py-2 pr-3"><StatusBadge status={s.status} /></td>
              <td className="py-2 pr-3"><PriorityBadge priority={s.priority} /></td>
              <td className="py-2 pr-3 text-text-muted text-xs">{s.depends_on && s.depends_on.length > 0 ? s.depends_on.join(', ') : ''}</td>
              <td className="py-2 pr-3 text-text-muted">{s.due_date ?? ''}</td>
              <td className="py-2 text-text-muted text-xs" title={s.last_claimed_at ?? ''}>{timeSince(s.last_claimed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
