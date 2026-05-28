import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, AlertCircle, Send, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import {
  deletePushSubscription,
  getVapidPublicKey,
  listPushSubscriptions,
  postPushSubscription,
  sendTestPush,
  type PushSubscriptionRow,
} from '../lib/api';
import { timeSince } from '../lib/format';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; subscriptions: PushSubscriptionRow[]; selfEndpoint: string | null; permission: NotificationPermission; supported: boolean }
  | { kind: 'error'; message: string };

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function Push() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const subs = await listPushSubscriptions();
      let selfEndpoint: string | null = null;
      let permission: NotificationPermission = 'default';
      const supported = 'serviceWorker' in navigator && 'PushManager' in window;
      if (supported) {
        permission = Notification.permission;
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        selfEndpoint = existing?.endpoint ?? null;
      }
      setState({ kind: 'ready', subscriptions: subs, selfEndpoint, permission, supported });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function subscribe() {
    if (state.kind !== 'ready') return;
    setBusy(true);
    try {
      const { public_key } = await getVapidPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      const json = sub.toJSON();
      await postPushSubscription({
        endpoint: json.endpoint!,
        keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
        device_label: navigator.userAgent.slice(0, 60),
      });
      setToast({ kind: 'ok', text: 'subscribed — try Test push below' });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      // Server side cleanup: find this endpoint in the list and DELETE.
      if (state.kind === 'ready' && existing) {
        const match = state.subscriptions.find((s) => s.endpoint === existing.endpoint);
        if (match) await deletePushSubscription(match.id);
      }
      setToast({ kind: 'ok', text: 'unsubscribed' });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const result = await sendTestPush();
      setToast({ kind: 'ok', text: `pushed to ${result.succeeded}/${result.total} (failed ${result.failed}, pruned ${result.pruned_endpoints.length})` });
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function removeSubscription(id: number) {
    setBusy(true);
    try {
      await deletePushSubscription(id);
      await load();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') return <div className="text-text-muted">loading push state...</div>;
  if (state.kind === 'error') return <div className="text-danger">Error: {state.message}</div>;

  const { subscriptions, selfEndpoint, permission, supported } = state;
  const selfSubscribed = selfEndpoint !== null;

  return (
    <div className="max-w-3xl">
      <header className="border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text flex items-center gap-2"><Bell className="w-6 h-6 text-accent" /> Push notifications</h1>
        <p className="text-text-muted text-xs mt-1">
          Subscribe this device to receive push alerts when the agent fires <code>request_approval</code> from MCP.
          Tap action buttons in the notification to respond from anywhere.
        </p>
      </header>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded text-sm flex items-center gap-2 ${toast.kind === 'ok' ? 'bg-success/20 text-success border border-success/40' : 'bg-danger/20 text-danger border border-danger/40'}`}>
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      <section className="bg-panel border border-border rounded-lg p-5 mb-6">
        <h2 className="text-sm text-text mb-3">This device</h2>
        {!supported ? (
          <div className="text-warning text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Push API not supported in this browser (try Chrome / Firefox / Edge on desktop, or Safari 16+ as PWA on iOS).</div>
        ) : permission === 'denied' ? (
          <div className="text-danger text-sm flex items-center gap-2"><BellOff className="w-4 h-4" /> Notifications blocked at browser level. Enable in browser settings and refresh.</div>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-text-muted text-sm mr-2">
              Status: {selfSubscribed ? <span className="text-success">subscribed</span> : <span className="text-text-dim">not subscribed</span>}
            </span>
            {selfSubscribed ? (
              <Button variant="default" onClick={() => void unsubscribe()} disabled={busy}>
                <BellOff className="w-4 h-4 mr-1" /> Unsubscribe
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void subscribe()} disabled={busy}>
                <Bell className="w-4 h-4 mr-1" /> Subscribe this device
              </Button>
            )}
            <Button variant="default" onClick={() => void test()} disabled={busy || subscriptions.length === 0} title={subscriptions.length === 0 ? 'no subscriptions to push to' : 'send test push to all subscribed devices'}>
              <Send className="w-4 h-4 mr-1" /> Test push
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm text-text mb-3">All subscribed devices ({subscriptions.length})</h2>
        {subscriptions.length === 0 ? (
          <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
            No devices subscribed yet.
          </div>
        ) : (
          <div className="space-y-2">
            {subscriptions.map((s) => (
              <div key={s.id} className="bg-panel border border-border rounded p-3 flex items-start justify-between gap-3">
                <div className="text-xs flex-1 min-w-0">
                  <div className="text-text font-medium">{s.device_label ?? '(unknown device)'}</div>
                  <div className="text-text-muted mt-1 font-mono break-all">{s.endpoint.slice(0, 100)}…</div>
                  <div className="text-text-dim text-[10px] mt-1">added {timeSince(s.created_at)}{s.last_sent_at ? ` · last push ${timeSince(s.last_sent_at)}` : ''}{s.last_error ? ` · last error: ${s.last_error.slice(0, 80)}` : ''}</div>
                </div>
                <Button variant="ghost" onClick={() => void removeSubscription(s.id)} disabled={busy} title="remove subscription">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
