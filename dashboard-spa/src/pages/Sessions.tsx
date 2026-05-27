import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAllSessions } from '../lib/api';
import { timeSince } from '../lib/format';
import type { Session } from '../lib/types';

export function AllSessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listAllSessions(500)
      .then(setSessions)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!sessions) return <div className="text-text-muted">loading sessions...</div>;

  return (
    <div>
      <header className="border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text">All sessions</h1>
        <div className="text-text-muted text-xs mt-1">{sessions.length} session(s)</div>
      </header>

      {sessions.length === 0 ? (
        <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
          No sessions tracked yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
                <th className="font-medium pb-2 pr-3">Session ID</th>
                <th className="font-medium pb-2 pr-3 w-24">Project</th>
                <th className="font-medium pb-2 pr-3 w-32">Started</th>
                <th className="font-medium pb-2 pr-3 w-32">Ended</th>
                <th className="font-medium pb-2 pr-3 w-24">Duration</th>
                <th className="font-medium pb-2 w-20">Tool calls</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.session_id} className="border-b border-border/40 hover:bg-panel/40">
                  <td className="py-2 pr-3 text-text font-mono text-xs">
                    <Link to={`/sessions/${encodeURIComponent(s.session_id)}`} className="text-accent hover:underline">
                      {s.session_id}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-text-muted">{s.project_id ? `#${s.project_id}` : ''}</td>
                  <td className="py-2 pr-3 text-text-muted text-xs">{timeSince(s.started_at)}</td>
                  <td className="py-2 pr-3 text-text-muted text-xs">{s.ended_at ? timeSince(s.ended_at) : 'active'}</td>
                  <td className="py-2 pr-3 text-text-muted text-xs">{s.duration_seconds ? `${Math.floor(s.duration_seconds / 60)}m` : ''}</td>
                  <td className="py-2 text-text-muted text-xs">{s.tool_calls_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
