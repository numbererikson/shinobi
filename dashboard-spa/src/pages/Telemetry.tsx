import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, RefreshCw, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { flushTelemetry, getTelemetrySummary, type TelemetrySummary } from '../lib/api';
import { timeSince } from '../lib/format';

export function Telemetry() {
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await getTelemetrySummary());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function flush() {
    setBusy(true);
    try {
      const r = await flushTelemetry();
      if (r.ok) {
        setToast({ kind: 'ok', text: `sent ${r.sent}/${r.attempted} events to ${r.endpoint}` });
      } else {
        setToast({ kind: 'err', text: r.error ?? 'flush failed' });
      }
      await refresh();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!summary) return <div className="text-text-muted">loading telemetry...</div>;

  return (
    <div className="max-w-3xl">
      <header className="border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text flex items-center gap-2">
          <Activity className="w-6 h-6 text-accent" /> Telemetry
        </h1>
        <p className="text-text-muted text-xs mt-1">
          Anonymous, opt-in usage stats. Everything below stays in your local SQLite buffer until you flush it to an endpoint.
          No project content, task titles, decision bodies, prompts, or usernames are ever recorded.
        </p>
      </header>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded text-sm flex items-center gap-2 ${toast.kind === 'ok' ? 'bg-success/20 text-success border border-success/40' : 'bg-danger/20 text-danger border border-danger/40'}`}>
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      <section className="bg-panel border border-border rounded-lg p-5 mb-6">
        <h2 className="text-sm text-text mb-3">Status</h2>
        <dl className="text-sm grid grid-cols-[12rem_1fr] gap-y-1.5">
          <dt className="text-text-muted">Recording</dt>
          <dd className={summary.enabled ? 'text-success' : 'text-text-dim'}>
            {summary.enabled ? 'ON (SHINOBI_TELEMETRY=on)' : 'OFF (default)'}
          </dd>
          <dt className="text-text-muted">Endpoint</dt>
          <dd className="text-text">{summary.endpoint_configured ? 'configured' : <span className="text-text-dim">local-only (no SHINOBI_TELEMETRY_ENDPOINT)</span>}</dd>
          <dt className="text-text-muted">Total events</dt>
          <dd className="text-text">{summary.total_events.toLocaleString()}</dd>
          <dt className="text-text-muted">Unsent</dt>
          <dd className="text-text">{summary.unsent_events.toLocaleString()}</dd>
          <dt className="text-text-muted">Events last 7d</dt>
          <dd className="text-text">{summary.last_7d_count.toLocaleString()}</dd>
          <dt className="text-text-muted">Last recorded</dt>
          <dd className="text-text-muted text-xs">{summary.last_recorded_at ? `${timeSince(summary.last_recorded_at)} ago` : 'never'}</dd>
          <dt className="text-text-muted">Last sent</dt>
          <dd className="text-text-muted text-xs">{summary.last_sent_at ? `${timeSince(summary.last_sent_at)} ago` : 'never'}</dd>
        </dl>
        <div className="mt-4 flex gap-2">
          <Button variant="default" onClick={() => void refresh()}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
          <Button variant="primary" onClick={() => void flush()} disabled={busy || !summary.endpoint_configured || summary.unsent_events === 0}>
            <Send className="w-3.5 h-3.5 mr-1" /> Flush unsent
          </Button>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm text-text mb-3">Counts by event type (top 30)</h2>
        {summary.by_event_type.length === 0 ? (
          <div className="text-text-muted text-sm">
            (no events recorded yet
            {!summary.enabled && (
              <> — enable in <Link to="/settings" className="text-accent hover:underline">Settings</Link> and restart the dashboard)</>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
                <th className="pb-2 pr-3">Event type</th>
                <th className="pb-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_event_type.map((r) => (
                <tr key={r.event_type} className="border-b border-border/40">
                  <td className="py-1.5 pr-3 text-text font-mono text-xs">{r.event_type}</td>
                  <td className="py-1.5 text-text text-right">{r.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="text-text-muted text-xs">
        <h2 className="text-text text-sm mb-2">What is recorded</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><code>tool_called</code> — MCP tool name + ok flag</li>
          <li><code>view_hit</code> — dashboard route bucket (e.g. <code>/projects/:tab</code>) + HTTP status. Project IDs are stripped.</li>
        </ul>
        <h2 className="text-text text-sm mt-4 mb-2">What is NEVER recorded</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Project titles, task titles, decision bodies, notes, plans, prompts, model output, code snippets, file paths.</li>
          <li>IP addresses, usernames, machine IDs.</li>
          <li>The contents of <code>~/.shinobi/.env</code>, API keys, or any setting value.</li>
        </ul>
      </section>
    </div>
  );
}
