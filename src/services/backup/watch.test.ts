import { describe, expect, it } from 'vitest';
import { backupCron, backupHealth, DEFAULT_BACKUP_CRON } from './watch.js';

const now = new Date('2026-11-22T12:00:00Z');
const base = { repo_path: '/r', branch: 'main', last_pull_at: null };

describe('backupHealth', () => {
  it('is quiet when sync is not set up', () => {
    expect(backupHealth(undefined, now)).toEqual({ ok: true, problem: null });
  });

  it('is ok after a recent good push', () => {
    expect(backupHealth({ ...base, last_push_at: '2026-11-22T03:17:00Z' }, now).ok).toBe(true);
  });

  it('flags a stale backup and a never-pushed one', () => {
    expect(backupHealth({ ...base, last_push_at: '2026-11-20T03:17:00Z' }, now).problem).toBe('No backup for 56 hours.');
    expect(backupHealth({ ...base, last_push_at: null }, now).problem).toMatch(/No backup has been pushed/);
  });

  it('flags a failure newer than the last good push, not an older one', () => {
    const failed = { ...base, last_push_at: '2026-11-21T03:17:00Z', last_error: 'push to remote failed', last_error_at: '2026-11-22T03:17:00Z' };
    expect(backupHealth(failed, now).problem).toBe('Backup failed: push to remote failed');
    const recovered = { ...failed, last_push_at: '2026-11-22T04:00:00Z' };
    expect(backupHealth(recovered, now).ok).toBe(true);
  });
});

describe('backupCron', () => {
  it('defaults to nightly, can be switched off, ignores garbage', () => {
    expect(backupCron(undefined)?.expression).toBe(DEFAULT_BACKUP_CRON);
    expect(backupCron('off')).toBeNull();
    expect(backupCron('not a cron')).toBeNull();
    expect(backupCron('0 2 * * *')?.matches(new Date('2026-11-22T02:00:00Z'), 'UTC')).toBe(true);
  });
});
