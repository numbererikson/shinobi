import { getDb } from '../lib/db.js';

export interface NotificationRow {
  id: number;
  title: string;
  body: string;
  tag: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
}

const KEEP = 500;

/** Store a sent notification and prune the oldest beyond the last 500. */
export function recordNotification(input: { title: string; body: string; tag?: string | null; url?: string | null }): number {
  const db = getDb();
  const id = Number(
    db
      .prepare('INSERT INTO notifications (title, body, tag, url) VALUES (?, ?, ?, ?)')
      .run(input.title, input.body, input.tag ?? null, input.url ?? null).lastInsertRowid,
  );
  db.prepare('DELETE FROM notifications WHERE id <= ?').run(id - KEEP);
  return id;
}

export function listNotifications(limit = 100): NotificationRow[] {
  const n = Math.min(Math.max(Math.trunc(limit) || 100, 1), KEEP);
  return getDb().prepare<[number], NotificationRow>('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(n);
}

export function unreadNotificationCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number }).n;
}

export function deleteNotification(id: number): boolean {
  return getDb().prepare('DELETE FROM notifications WHERE id = ?').run(id).changes > 0;
}

export function deleteAllNotifications(): number {
  return getDb().prepare('DELETE FROM notifications').run().changes;
}

export function markAllNotificationsRead(): number {
  return getDb().prepare("UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL").run().changes;
}
