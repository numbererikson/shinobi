import { Link, useOutletContext } from 'react-router-dom';
import { timeSince } from '../../lib/format';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function ProjectSessions() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const { sessions } = snapshot;

  if (sessions.length === 0) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No sessions yet for this project. Sessions appear when agent_bootstrap or claim_task is called with a session_id.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
            <th className="font-medium pb-2 pr-3">Session ID</th>
            <th className="font-medium pb-2 pr-3 w-32">Started</th>
            <th className="font-medium pb-2 pr-3 w-32">Ended</th>
            <th className="font-medium pb-2 pr-3 w-24">Duration</th>
            <th className="font-medium pb-2 pr-3 w-20">Tool calls</th>
            <th className="font-medium pb-2 pr-3 w-20">Files</th>
            <th className="font-medium pb-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.session_id} className="border-b border-border/40 hover:bg-panel/40 align-top">
              <td className="py-2 pr-3 text-text font-mono text-xs">
                <Link to={`/sessions/${encodeURIComponent(s.session_id)}`} className="text-accent hover:underline">
                  {s.session_id}
                </Link>
              </td>
              <td className="py-2 pr-3 text-text-muted text-xs">{timeSince(s.started_at)}</td>
              <td className="py-2 pr-3 text-text-muted text-xs">{s.ended_at ? timeSince(s.ended_at) : 'active'}</td>
              <td className="py-2 pr-3 text-text-muted text-xs">{s.duration_seconds ? `${Math.floor(s.duration_seconds / 60)}m` : ''}</td>
              <td className="py-2 pr-3 text-text-muted text-xs">{s.tool_calls_count}</td>
              <td className="py-2 pr-3 text-text-muted text-xs">{s.files_touched_count}</td>
              <td className="py-2 text-text-muted text-xs">{s.notes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
