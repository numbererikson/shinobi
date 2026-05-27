import Database, { type Database as DatabaseT } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

let cached: DatabaseT | null = null;

export function getDbPath(): string {
  const override = process.env['SHINOBI_DB_PATH'];
  if (override && override.length > 0) {
    return override;
  }
  return resolve(homedir(), '.shinobi', 'shinobi.db');
}

export function getDb(): DatabaseT {
  if (cached) {
    return cached;
  }
  const path = getDbPath();
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  cached = db;
  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}
