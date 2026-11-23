import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb } from '../../lib/db.js';
import { patchConfig } from '../../lib/config.js';
import { createProject } from '../../models/projects.js';
import { readDiskBackupStatus, systemStatus } from './system.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-system-'));
  process.env.SHINOBI_CONFIG_DIR = tmp;
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.SHINOBI_CONFIG_DIR;
});

type Status = {
  ok: boolean;
  problems: string[];
  server: { version: string; data_disk: unknown };
  backups: { github: Record<string, unknown>; disk: Record<string, unknown> };
  push: { devices: number };
  projects: { title: string; progress: string }[] | null;
};

describe('system_status', () => {
  it('reports server facts and flags missing push devices', () => {
    const s = systemStatus() as Status;
    expect(s.server.version).toMatch(/\d+\.\d+\.\d+|unknown/);
    expect(s.backups.github).toEqual({ configured: false });
    expect(s.backups.disk).toEqual({ configured: false });
    expect(s.push.devices).toBe(0);
    expect(s.problems).toContain('No device is subscribed to push notifications.');
  });

  it('reads the disk backup status file and flags failures and stale runs', () => {
    const now = new Date('2026-11-24T08:00:00Z');
    mkdirSync(join(tmp, 'status'), { recursive: true });
    const file = join(tmp, 'status', 'disk-backup.json');

    writeFileSync(file, JSON.stringify({ at: '2026-11-24T04:00:05Z', ok: true, message: 'OK: 49M' }));
    let s = systemStatus(now) as Status;
    expect(s.backups.disk).toMatchObject({ configured: true, ok: true, hours_ago: 4, message: 'OK: 49M' });
    expect(s.problems.some((p) => p.startsWith('Disk backup'))).toBe(false);

    writeFileSync(file, JSON.stringify({ at: '2026-11-24T04:00:05Z', ok: false, message: 'USB disk is not connected' }));
    s = systemStatus(now) as Status;
    expect(s.problems).toContain('Disk backup failed: USB disk is not connected');

    writeFileSync(file, JSON.stringify({ at: '2026-11-21T04:00:05Z', ok: true }));
    s = systemStatus(now) as Status;
    expect(s.problems).toContain('Disk backup has not run for 76 hours.');

    writeFileSync(file, 'not json');
    expect(readDiskBackupStatus(tmp)).toEqual({ ok: false, message: 'status file is not valid JSON' });
  });

  it('includes GitHub backup health and open projects', () => {
    patchConfig({ sync: { repo_path: '/r', branch: 'main', last_push_at: null, last_pull_at: null } });
    createProject({ title: 'Brief agent' });
    const s = systemStatus() as Status;
    expect(s.backups.github).toMatchObject({ configured: true, ok: false });
    expect(s.problems.some((p) => p.startsWith('GitHub backup'))).toBe(true);
    expect(s.projects?.map((p) => p.title)).toContain('Brief agent');
  });
});
