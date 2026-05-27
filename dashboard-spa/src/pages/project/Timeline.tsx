import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { timeSince } from '../../lib/format';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function Timeline() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const { activity } = snapshot;

  if (activity.length === 0) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No activity yet. Write paths (claim_task, log_decision, etc.) populate this timeline.
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {activity.map((a) => (
        <div key={a.id} className="grid grid-cols-[110px_160px_1fr_140px] gap-3 py-2 border-b border-border/40 items-baseline text-xs">
          <div className="text-text-muted font-mono" title={a.created_at}>{timeSince(a.created_at)}</div>
          <div className="text-accent">{a.action_type}</div>
          <div className="text-text flex flex-wrap items-center gap-2">
            {a.action_details && <span>{a.action_details}</span>}
            {a.entity_type && <Badge>{a.entity_type}#{a.entity_id ?? '?'}</Badge>}
            {a.ref_url && <span className="text-text-dim font-mono">{a.ref_url.slice(0, 16)}…</span>}
          </div>
          <div className="text-text-muted font-mono text-[11px]">{a.session_id ?? ''}</div>
        </div>
      ))}
    </div>
  );
}
