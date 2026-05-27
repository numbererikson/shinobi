import { Link, useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { patchDecisionStatus } from '../../lib/api';
import { timeSince } from '../../lib/format';
import type { DecisionStatus } from '../../lib/types';
import type { ProjectOutletCtx } from '../ProjectLayout';

const TRANSITION_TARGETS: DecisionStatus[] = ['open', 'fix_now', 'fix_later', 'wontfix', 'fixed', 'false_positive'];

function statusVariant(status: DecisionStatus): string {
  switch (status) {
    case 'open': return 'bg-accent-2 text-white';
    case 'fix_now': return 'bg-danger text-white';
    case 'fix_later': return 'bg-orange text-bg';
    case 'wontfix': return 'bg-text-dim text-text';
    case 'fixed': return 'bg-success text-bg';
    case 'false_positive': return 'bg-text-dim text-text';
    default: return 'bg-border-2 text-text';
  }
}

export function Decisions() {
  const { snapshot, refresh } = useOutletContext<ProjectOutletCtx>();
  const { decisions, draft_counts, project } = snapshot;

  async function transition(id: number, status: DecisionStatus) {
    try {
      await patchDecisionStatus(id, status);
      await refresh();
    } catch (e) {
      alert('Transition failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  const draftsBanner = draft_counts.pending > 0 ? (
    <div className="bg-panel border-l-4 border-l-warning rounded-md p-3 mb-4 flex items-center justify-between">
      <span className="text-sm">
        <strong>{draft_counts.pending} pending decision draft{draft_counts.pending > 1 ? 's' : ''}</strong>{' '}
        <span className="text-text-muted">extracted via LLM</span>
      </span>
      <Link to={`/projects/${project.id}/decision-drafts`} className="text-accent text-sm hover:underline">
        Review →
      </Link>
    </div>
  ) : null;

  if (decisions.length === 0) {
    return (
      <div>
        {draftsBanner}
        <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
          No decisions logged. Use <code>log_decision</code> via MCP.
        </div>
      </div>
    );
  }

  return (
    <div>
      {draftsBanner}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
              <th className="font-medium pb-2 pr-3 w-12">ID</th>
              <th className="font-medium pb-2 pr-3 w-24">Kind</th>
              <th className="font-medium pb-2 pr-3">Summary + Rationale</th>
              <th className="font-medium pb-2 pr-3 w-44">Status</th>
              <th className="font-medium pb-2 pr-3 w-40">Files</th>
              <th className="font-medium pb-2 pr-3 w-32">Tags</th>
              <th className="font-medium pb-2 w-24">Logged</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.id} className="border-b border-border/40 hover:bg-panel/40 align-top">
                <td className="py-3 pr-3 text-text-muted font-mono">{d.id}</td>
                <td className="py-3 pr-3"><Badge>{d.kind}</Badge></td>
                <td className="py-3 pr-3">
                  <div className="text-text font-medium">{d.summary}</div>
                  <div className="text-text-muted text-xs mt-1">
                    {d.rationale.length > 300 ? d.rationale.slice(0, 300) + '…' : d.rationale}
                  </div>
                  {d.alternatives_considered && (
                    <div className="text-text-dim text-xs mt-1">alt: {d.alternatives_considered.slice(0, 150)}</div>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <span className={`inline-block rounded text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 ${statusVariant(d.status)}`}>{d.status}</span>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {TRANSITION_TARGETS.filter((s) => s !== d.status).map((s) => (
                      <Button key={s} size="sm" variant="ghost" onClick={() => void transition(d.id, s)} className="text-[10px] px-1.5 py-0.5">
                        {s}
                      </Button>
                    ))}
                  </div>
                </td>
                <td className="py-3 pr-3 text-text-muted text-xs">
                  {(d.files_touched ?? []).map((f) => <div key={f}>{f}</div>)}
                </td>
                <td className="py-3 pr-3">
                  {(d.tags ?? []).map((t) => <Badge key={t} className="mr-1 mb-1">{t}</Badge>)}
                </td>
                <td className="py-3 text-text-muted text-xs" title={d.created_at}>{timeSince(d.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
