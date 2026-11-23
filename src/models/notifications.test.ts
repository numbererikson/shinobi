import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { listNotifications, markAllNotificationsRead, recordNotification, unreadNotificationCount } from './notifications.js';
import { inboxUrl } from '../services/push/web-push.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-inbox-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('inbox', () => {
  it('records notifications newest first, counts unread and marks them read', () => {
    const a = recordNotification({ title: 'Morning brief', body: '✅ All good\n🔔 Today: no reminders', tag: 'morning-brief', url: '/' });
    const b = recordNotification({ title: 'Backup disk', body: 'USB disk is not connected' });
    expect(b).toBeGreaterThan(a);
    expect(listNotifications().map((n) => n.title)).toEqual(['Backup disk', 'Morning brief']);
    expect(listNotifications()[1]!.body).toContain('\n');
    expect(unreadNotificationCount()).toBe(2);
    expect(markAllNotificationsRead()).toBe(2);
    expect(unreadNotificationCount()).toBe(0);
    expect(inboxUrl(b)).toBe(`/inbox#n${b}`);
  });

  it('keeps only the last 500', () => {
    for (let i = 0; i < 520; i++) recordNotification({ title: `t${i}`, body: 'x' });
    expect(listNotifications(1000)).toHaveLength(500);
    expect(listNotifications(1)[0]!.title).toBe('t519');
  });
});
