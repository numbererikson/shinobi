import { useCallback, useEffect, useState } from 'react';
import { Radio, Wifi, WifiOff, RefreshCw, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { getRelayStatus, relayBroadcastSync, type RelayStatus } from '../lib/api';
import { timeSince } from '../lib/format';

const POLL_MS = 3000;

export function Relay() {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getRelayStatus();
      setStatus(data);
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

  async function broadcast() {
    setBusy(true);
    try {
      const r = await relayBroadcastSync();
      setToast({ kind: r.ok ? 'ok' : 'err', text: r.ok ? 'sync-available broadcast sent to peers' : r.error ?? 'broadcast failed' });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!status) return <div className="text-text-muted">loading relay status...</div>;

  const configured = status.url !== null && status.workspace !== null;

  return (
    <div className="max-w-3xl">
      <header className="border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text flex items-center gap-2">
          <Radio className="w-6 h-6 text-accent" /> Multi-agent relay
        </h1>
        <p className="text-text-muted text-xs mt-1">
          Real-time fan-out across multiple machines / agents working on the same workspace. When one agent runs <code>shinobi sync push</code>,
          all other connected agents auto-pull within ~1.5s. Backed by a Cloudflare Worker + Durable Object — see <code>relay-worker/</code>.
        </p>
      </header>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded text-sm flex items-center gap-2 ${toast.kind === 'ok' ? 'bg-success/20 text-success border border-success/40' : 'bg-danger/20 text-danger border border-danger/40'}`}>
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      {!configured ? (
        <div className="bg-panel border border-dashed border-border rounded-lg p-6">
          <h2 className="text-text mb-2 flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-text-muted" /> Relay not configured
          </h2>
          <p className="text-text-muted text-sm mb-3">
            Set <code>SHINOBI_RELAY_URL</code>, <code>SHINOBI_RELAY_TOKEN</code>, and <code>SHINOBI_RELAY_WORKSPACE</code> in Settings to enable.
          </p>
          <ol className="text-text-muted text-sm list-decimal pl-5 space-y-1">
            <li>Deploy the Worker: <code>cd relay-worker &amp;&amp; npx wrangler deploy</code></li>
            <li>Set the secret: <code>npx wrangler secret put SHINOBI_RELAY_TOKEN</code></li>
            <li>Configure each agent's <code>~/.shinobi/.env</code> with matching URL/token/workspace and restart the dashboard.</li>
          </ol>
        </div>
      ) : (
        <>
          <section className="bg-panel border border-border rounded-lg p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm text-text flex items-center gap-2">
                {status.connected ? (
                  <>
                    <Wifi className="w-4 h-4 text-success" />
                    <span className="text-success">Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-warning" />
                    <span className="text-warning">Disconnected</span>
                    {status.reconnect_attempts > 0 && (
                      <span className="text-text-muted text-xs">— attempt #{status.reconnect_attempts}</span>
                    )}
                  </>
                )}
              </h2>
              <Button variant="default" onClick={() => void load()} disabled={busy}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
              </Button>
            </div>
            <dl className="text-sm grid grid-cols-[10rem_1fr] gap-y-1.5">
              <dt className="text-text-muted">Agent ID</dt>
              <dd className="text-text font-mono text-xs">{status.agent_id}</dd>
              <dt className="text-text-muted">Workspace</dt>
              <dd className="text-text font-mono text-xs">{status.workspace}</dd>
              <dt className="text-text-muted">Relay URL</dt>
              <dd className="text-text font-mono text-xs break-all">{status.url}</dd>
              <dt className="text-text-muted">Last event</dt>
              <dd className="text-text text-xs">
                {status.last_event_at ? (
                  <>
                    <Badge className="bg-accent/20 text-accent mr-2">{status.last_event_type}</Badge>
                    {timeSince(status.last_event_at)}
                  </>
                ) : (
                  <span className="text-text-dim">none</span>
                )}
              </dd>
              {status.last_error && (
                <>
                  <dt className="text-danger">Last error</dt>
                  <dd className="text-danger text-xs">{status.last_error}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="bg-panel border border-border rounded-lg p-5">
            <h2 className="text-sm text-text mb-2">Test broadcast</h2>
            <p className="text-text-muted text-xs mb-3">
              Sends a <code>sync-available</code> event to every other connected agent in this workspace. They will auto-pull the latest snapshot.
            </p>
            <Button variant="primary" onClick={() => void broadcast()} disabled={busy || !status.connected}>
              <Send className="w-4 h-4 mr-1" /> Broadcast sync-available
            </Button>
          </section>
        </>
      )}
    </div>
  );
}
