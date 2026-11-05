import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb, getDb } from '../lib/db.js';
import { createProject } from '../models/projects.js';
import { syncInit, syncPull } from './sync.js';

let tmp: string;
let livePath: string;
let repoPath: string;

function titles(db: Database.Database): string[] {
  return (db.prepare('SELECT title FROM projects ORDER BY id').all() as { title: string }[]).map((r) => r.title);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-sync-'));
  process.env.SHINOBI_CONFIG_DIR = tmp;
  livePath = join(tmp, 'live.db');
  process.env.SHINOBI_DB_PATH = livePath;
  repoPath = join(tmp, 'sync-repo');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('syncPull', () => {
  it('restore survives another process holding the live DB open in WAL mode', async () => {
    createProject({ title: 'in snapshot' });
    syncInit(repoPath);
    await getDb().backup(join(repoPath, 'shinobi.db'));

    // Written after the snapshot and kept in the WAL (no autocheckpoint), the
    // way a long-running server holds recent writes.
    getDb().pragma('wal_autocheckpoint = 0');
    createProject({ title: 'after snapshot' });

    // Stand-in for the running server: a second connection that stays open
    // across the restore and checkpoints when it closes.
    const server = new Database(livePath);
    server.pragma('journal_mode = WAL');
    expect(titles(server)).toEqual(['in snapshot', 'after snapshot']);

    await syncPull();

    expect(titles(server)).toEqual(['in snapshot']);
    server.close();

    closeDb();
    const reopened = new Database(livePath, { readonly: true });
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(titles(reopened)).toEqual(['in snapshot']);
    reopened.close();
  });
});
