import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { listConnectedApps, revokeConnectedApp, type ConnectedApp } from '../lib/api';

/** Apps connected through the OAuth "Connect" flow (e.g. the Claude app), with revoke. */
export function ConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApps((await listConnectedApps()).clients);
    } catch {
      setUnavailable(true); // OAuth off (no /mcp, auth off, or SHINOBI_OAUTH=off)
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(app: ConnectedApp) {
    if (!window.confirm(`Disconnect ${app.client_name ?? 'this app'}? It will have to be connected again.`)) return;
    setBusy(app.client_id);
    try {
      await revokeConnectedApp(app.client_id);
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (unavailable) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm uppercase tracking-wider text-text-muted mb-3 flex items-center gap-2">
        <KeyRound className="w-3.5 h-3.5" /> Connected apps
      </h2>
      {apps === null ? (
        <div className="text-sm text-text-muted">Loading…</div>
      ) : apps.length === 0 ? (
        <div className="text-sm text-text-muted">
          None yet. In the Claude app add a custom connector with the URL <code>https://&lt;your-host&gt;/mcp</code> and press Connect.
        </div>
      ) : (
        <ul className="border border-border rounded divide-y divide-border">
          {apps.map((a) => (
            <li key={a.client_id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{a.client_name ?? 'Unnamed app'}</div>
                <div className="text-xs text-text-muted">
                  {a.redirect_hosts.join(', ')} · connected {a.approved_at ?? '—'} · last used {a.last_used_at ?? 'never'}
                </div>
              </div>
              <Button size="sm" variant="danger" disabled={busy === a.client_id} onClick={() => void revoke(a)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
