import { getDb } from '../lib/db.js';

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  user_agent: string | null;
  created_at: string;
  last_sent_at: string | null;
  last_error: string | null;
}

export interface UpsertSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label?: string | null;
  user_agent?: string | null;
}

export function upsertSubscription(input: UpsertSubscriptionInput): PushSubscriptionRow {
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, device_label, user_agent)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         device_label = excluded.device_label,
         user_agent = excluded.user_agent`,
    )
    .run(
      input.endpoint,
      input.p256dh,
      input.auth,
      input.device_label ?? null,
      input.user_agent ?? null,
    );
  const row = getDb()
    .prepare<[string], PushSubscriptionRow>('SELECT * FROM push_subscriptions WHERE endpoint = ?')
    .get(input.endpoint);
  if (!row) throw new Error('upsertSubscription: lookup after insert returned null');
  return row;
}

export function listSubscriptions(): PushSubscriptionRow[] {
  return getDb()
    .prepare<unknown[], PushSubscriptionRow>('SELECT * FROM push_subscriptions ORDER BY created_at DESC')
    .all();
}

export function deleteSubscription(id: number): boolean {
  const r = getDb().prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
  return r.changes > 0;
}

export function deleteSubscriptionByEndpoint(endpoint: string): boolean {
  const r = getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  return r.changes > 0;
}

export function recordSendResult(id: number, error: string | null): void {
  getDb()
    .prepare(
      `UPDATE push_subscriptions
       SET last_sent_at = CURRENT_TIMESTAMP, last_error = ?
       WHERE id = ?`,
    )
    .run(error, id);
}
