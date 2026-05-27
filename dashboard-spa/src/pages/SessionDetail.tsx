import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { getSessionDetail } from '../lib/api';
import { timeSince } from '../lib/format';
import type { ActivityRow, Session } from '../lib/types';

export function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<{ session: Session; activity: ActivityRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    getSessionDetail(sessionId)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [sessionId]);

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!data) return <div className="text-text-muted">loading session...</div>;
  const { session, activity } = data;

  return (
    <div>
      <header className="border-b border-border pb-3 mb-4">
        <Link to="/sessions" className="text-accent text-xs hover:underline">← all sessions</Link>
        <h1 className="text-2xl text-text mt-1 font-mono">{session.session_id}</h1>
        <div className="text-text-muted text-xs mt-2 flex gap-3 flex-wrap">
          <span>started {session.started_at}</span>
          {session.ended_at && <span>ended {session.ended_at}</span>}
          {session.duration_seconds !== null && <span>duration {Math.floor(session.duration_seconds / 60)}m {session.duration_seconds % 60}s</span>}
          <span>{session.tool_calls_count} tool calls</span>
          <span>{session.files_touched_count} files touched</span>
        </div>
        {session.notes && <pre className="bg-panel border border-border rounded p-3 mt-3 text-xs font-mono text-text whitespace-pre-wrap">{session.notes}</pre>}
      </header>

      <h2 className="text-sm text-text mb-3">Activity</h2>
      {activity.length === 0 ? (
        <div className="text-text-muted text-sm">(no activity in this session)</div>
      ) : (
        <div className="space-y-px">
          {activity.map((a) => (
            <div key={a.id} className="grid grid-cols-[110px_160px_1fr] gap-3 py-2 border-b border-border/40 items-baseline text-xs">
              <div className="text-text-muted font-mono" title={a.created_at}>{timeSince(a.created_at)}</div>
              <div className="text-accent">{a.action_type}</div>
              <div className="text-text flex flex-wrap items-center gap-2">
                {a.action_details && <span>{a.action_details}</span>}
                {a.entity_type && <Badge>{a.entity_type}#{a.entity_id ?? '?'}</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
