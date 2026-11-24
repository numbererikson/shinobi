import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { ArrowRight, Inbox as InboxIcon, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { clearNotifications, deleteNotification, listNotifications, markNotificationsRead, type InboxNotification } from '../lib/api';
import { timeSince } from '../lib/format';

function localTime(sqlUtc: string): string {
  const d = new Date(sqlUtc.includes('T') ? sqlUtc : `${sqlUtc.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? sqlUtc : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Every push the server sent (morning brief, backup alerts, reminders, …), so
 * a notification that vanished from the phone can still be read. Tapping a
 * push opens /inbox#n<id>, which highlights that entry.
 */
export function Inbox() {
  const location = useLocation();
  const [items, setItems] = useState<InboxNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusId = /^#n(\d+)$/.exec(location.hash)?.[1];

  useEffect(() => {
    let cancelled = false;
    listNotifications()
      .then((r) => {
        if (cancelled) return;
        setItems(r.notifications);
        if (r.unread > 0) {
          void markNotificationsRead().then(() => window.dispatchEvent(new Event('shinobi:inbox-read')));
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [location.key]);

  async function remove(id: number) {
    await deleteNotification(id).catch(() => undefined);
    setItems((cur) => (cur ?? []).filter((n) => n.id !== id));
  }

  async function clearAll() {
    if (!window.confirm('Delete every message in the inbox?')) return;
    await clearNotifications().catch(() => undefined);
    setItems([]);
    window.dispatchEvent(new Event('shinobi:inbox-read'));
  }

  useEffect(() => {
    if (focusId && items) document.getElementById(`n${focusId}`)?.scrollIntoView({ block: 'center' });
  }, [focusId, items]);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl flex items-center gap-2 flex-1">
          <InboxIcon className="w-6 h-6" /> Inbox
        </h1>
        {items && items.length > 0 && (
          <Button size="sm" variant="danger" onClick={() => void clearAll()}>
            Clear all
          </Button>
        )}
      </div>
      <p className="text-sm text-text-muted mb-6">Every notification Shinobi sent to your devices, newest first.</p>

      {error && <div className="text-danger text-sm">{error}</div>}
      {items && items.length === 0 && <div className="text-text-muted text-sm italic">Nothing yet.</div>}

      <ul className="space-y-3">
        {(items ?? []).map((n) => (
          <li
            key={n.id}
            id={`n${n.id}`}
            className={clsx(
              'bg-panel border rounded-md p-4',
              String(n.id) === focusId ? 'border-accent' : 'border-border',
            )}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <div className="text-sm text-text font-medium flex-1 min-w-0 break-words">
                {n.read_at === null && <span className="inline-block w-2 h-2 rounded-full bg-accent mr-2 align-middle" />}
                {n.title}
              </div>
              <div className="text-xs text-text-muted flex-shrink-0" title={localTime(n.created_at)}>
                {timeSince(n.created_at)}
              </div>
              <button
                type="button"
                aria-label="Delete this message"
                title="Delete"
                onClick={() => void remove(n.id)}
                className="text-text-muted hover:text-danger flex-shrink-0 p-1 -m-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-sm text-text whitespace-pre-wrap break-words">{n.body}</div>
            <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
              <span>{localTime(n.created_at)}</span>
              {n.url && n.url !== '/' && n.url.startsWith('/') && (
                <Link to={n.url} className="text-accent inline-flex items-center gap-1 hover:underline">
                  Open <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
