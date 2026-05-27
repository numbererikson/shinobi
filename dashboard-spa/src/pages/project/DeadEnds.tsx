import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { timeSince } from '../../lib/format';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function DeadEnds() {
  const { snapshot } = useOutletContext<ProjectOutletCtx>();
  const { dead_ends } = snapshot;

  if (dead_ends.length === 0) {
    return (
      <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
        No dead ends logged. Use <code>log_dead_end</code> when an approach fails.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
            <th className="font-medium pb-2 pr-3 w-12">ID</th>
            <th className="font-medium pb-2 pr-3">Attempted</th>
            <th className="font-medium pb-2 pr-3">Why failed</th>
            <th className="font-medium pb-2 pr-3 w-32">Files</th>
            <th className="font-medium pb-2 pr-3 w-24">Flag</th>
            <th className="font-medium pb-2 w-24">Logged</th>
          </tr>
        </thead>
        <tbody>
          {dead_ends.map((d) => (
            <tr key={d.id} className="border-b border-border/40 hover:bg-panel/40 align-top">
              <td className="py-3 pr-3 text-text-muted font-mono">{d.id}</td>
              <td className="py-3 pr-3 text-text font-medium">{d.attempted_approach}</td>
              <td className="py-3 pr-3 text-text-muted">{d.failure_reason}</td>
              <td className="py-3 pr-3 text-text-muted text-xs">
                {(d.files_involved ?? []).map((f) => <div key={f}>{f}</div>)}
              </td>
              <td className="py-3 pr-3">
                {d.never_retry && <Badge className="bg-danger text-white">never retry</Badge>}
              </td>
              <td className="py-3 text-text-muted text-xs" title={d.created_at}>{timeSince(d.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
