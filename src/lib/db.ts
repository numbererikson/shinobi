import Database, { type Database as DatabaseT } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { configDir } from './config.js';

let cached: DatabaseT | null = null;

export function getDbPath(): string {
  const override = process.env['SHINOBI_DB_PATH'];
  if (override && override.length > 0) {
    return override;
  }
  // Lives under configDir() so SHINOBI_CONFIG_DIR relocates the database
  // together with config.json / dashboard-token (critical for Docker, where
  // /data is the persistent volume). Default resolves to ~/.shinobi/shinobi.db,
  // identical to the previous hardcoded path.
  return resolve(configDir(), 'shinobi.db');
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
