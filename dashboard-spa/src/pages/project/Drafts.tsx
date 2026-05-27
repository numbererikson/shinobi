import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { approveDraft, getDecisionDrafts, rejectDraft } from '../../lib/api';
import { timeSince } from '../../lib/format';
import type { DecisionDraft, DraftCounts } from '../../lib/types';
import type { ProjectOutletCtx } from '../ProjectLayout';

export function Drafts() {
  const { snapshot, refresh } = useOutletContext<ProjectOutletCtx>();
  const projectId = snapshot.project.id;
  const [drafts, setDrafts] = useState<DecisionDraft[] | null>(null);
  const [counts, setCounts] = useState<DraftCounts>({ pending: 0, approved: 0, rejected: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await getDecisionDrafts(projectId);
      setDrafts(data.drafts);
      setCounts(data.counts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(id: number, kind: 'approve' | 'reject') {
    if (busy !== null) return;
    setBusy(id);
    try {
      if (kind === 'approve') await approveDraft(id);
      else await rejectDraft(id);
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      alert(`${kind} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!drafts) return <div className="text-text-muted">loading drafts...</div>;

  const stat = (label: string, value: number, colorClass: string) => (
    <div className="bg-panel border border-border rounded p-3">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-2xl mt-1 ${colorClass}`}>{value}</div>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {stat('Pending', counts.pending, 'text-warning')}
        {stat('Approved', counts.approved, 'text-success')}
        {stat('Rejected', counts.rejected, 'text-danger')}
      </div>

      {drafts.length === 0 ? (
        <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
          No drafts. Drafts appear when the agent calls <code>extract_decisions(text)</code> — LLM scans a transcript and proposes decisions for you to approve.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
                <th className="font-medium pb-2 pr-3 w-12">ID</th>
                <th className="font-medium pb-2 pr-3 w-24">Kind</th>
                <th className="font-medium pb-2 pr-3">Summary + Rationale</th>
                <th className="font-medium pb-2 pr-3 w-32">Files</th>
                <th className="font-medium pb-2 pr-3 w-44">Action</th>
                <th className="font-medium pb-2 pr-3 w-20">Created</th>
                <th className="font-medium pb-2">Extractor</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} className="border-b border-border/40 hover:bg-panel/40 align-top">
                  <td className="py-3 pr-3 text-text-muted font-mono">{d.id}</td>
                  <td className="py-3 pr-3"><Badge>{d.kind}</Badge></td>
                  <td className="py-3 pr-3">
                    <div className="text-text font-medium">{d.summary}</div>
                    <div className="text-text-muted text-xs mt-1">{d.rationale}</div>
                    {d.alternatives_considered && (
                      <div className="text-text-dim text-xs mt-1">alt: {d.alternatives_considered}</div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-text-muted text-xs">
                    {(d.files_touched ?? []).map((f) => <div key={f}>{f}</div>)}
                  </td>
                  <td className="py-3 pr-3">
                    {d.status === 'pending' ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="primary" disabled={busy === d.id} onClick={() => void act(d.id, 'approve')}>Approve</Button>
                        <Button size="sm" variant="default" disabled={busy === d.id} onClick={() => void act(d.id, 'reject')}>Reject</Button>
                      </div>
                    ) : d.status === 'approved' ? (
                      <Badge className="bg-success text-bg">approved {d.approved_decision_id ? `→ #${d.approved_decision_id}` : ''}</Badge>
                    ) : (
                      <Badge className="bg-danger text-white">rejected</Badge>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-text-muted text-xs">{timeSince(d.created_at)}</td>
                  <td className="py-3 text-text-dim text-[10px] font-mono">{d.extractor_model ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
