import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { cancelApprovalApi, listApprovalsApi, respondToApprovalApi, type Approval } from '../lib/api';
import { timeSince } from '../lib/format';

const POLL_MS = 4000;

export function Approvals() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listApprovalsApi();
      setApprovals(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function respond(id: number, value: string) {
    setBusy(id);
    try {
      await respondToApprovalApi(id, value);
      await load();
    } catch (e) {
      alert('respond failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: number) {
    setBusy(id);
    try {
      await cancelApprovalApi(id);
      await load();
    } catch (e) {
      alert('cancel failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!approvals) return <div className="text-text-muted">loading approvals...</div>;

  const pending = approvals.filter((a) => a.status === 'pending');
  const recent = approvals.filter((a) => a.status !== 'pending').slice(0, 50);

  return (
    <div className="max-w-3xl">
      <header className="border-b border-border pb-3 mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl text-text">Approvals</h1>
        <span className="text-text-muted text-xs flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          polling every {POLL_MS / 1000}s
        </span>
      </header>

      <section className="mb-8">
        <h2 className="text-sm text-text mb-3 uppercase tracking-wider text-text-muted">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
            No pending approvals. Approvals appear when the agent calls <code>request_approval</code> via MCP.
            They also fire web push to subscribed devices — see <Link to="/push" className="text-accent underline">Push settings</Link>.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((a) => (
              <div key={a.id} id={`approval-${a.id}`} className="bg-panel border border-warning/40 border-l-4 border-l-warning rounded-md p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="text-text-muted text-xs">
                    #{a.id}
                    {a.project_id && <> · project #{a.project_id}</>}
                    <> · {timeSince(a.created_at)}</>
                  </div>
                  <Badge className="bg-warning text-bg">pending</Badge>
                </div>
                <div className="text-text mb-3 whitespace-pre-wrap">{a.prompt}</div>
                <div className="flex flex-wrap gap-2">
                  {a.options.map((opt) => (
                    <Button key={opt} variant="primary" disabled={busy === a.id} onClick={() => void respond(a.id, opt)}>
                      {opt}
                    </Button>
                  ))}
                  <Button variant="default" disabled={busy === a.id} onClick={() => void cancel(a.id)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm text-text mb-3 uppercase tracking-wider text-text-muted">
          Recent ({recent.length})
        </h2>
        {recent.length === 0 ? (
          <div className="text-text-muted text-sm">(none)</div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((a) => (
              <div key={a.id} className="bg-panel border border-border rounded p-3 text-sm">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <div className="text-text-muted text-xs">
                    #{a.id}
                    {a.project_id && <> · project #{a.project_id}</>}
                    <> · {timeSince(a.created_at)}</>
                  </div>
                  {a.status === 'responded' ? (
                    <Badge className="bg-success text-bg">
                      <CheckCircle2 className="w-3 h-3 inline mr-0.5" />
                      {a.response_value}
                    </Badge>
                  ) : a.status === 'expired' ? (
                    <Badge className="bg-text-dim text-text">expired</Badge>
                  ) : (
                    <Badge className="bg-text-dim text-text">
                      <AlertCircle className="w-3 h-3 inline mr-0.5" />
                      {a.status}
                    </Badge>
                  )}
                </div>
                <div className="text-text text-xs">{a.prompt.slice(0, 200)}{a.prompt.length > 200 ? '…' : ''}</div>
                {a.response_note && <div className="text-text-muted text-xs mt-1">note: {a.response_note}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
