import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Database as DatabaseT } from 'better-sqlite3';
import { getDb } from './db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..', '..');
const MIGRATION_FILE_PATTERN = /^\d{4}_[A-Za-z0-9_\-]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  mismatched: string[];
}

export function migrationsDir(): string {
  const override = process.env['SHINOBI_MIGRATIONS_DIR'];
  if (override && override.length > 0) {
    return override;
  }
  return resolve(PKG_ROOT, 'migrations');
}

function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => MIGRATION_FILE_PATTERN.test(name))
    .sort();
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function applyPendingMigrations(
  db: DatabaseT = getDb(),
  dir: string = migrationsDir(),
): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const files = listMigrationFiles(dir);
  const applied: string[] = [];
  const skipped: string[] = [];
  const mismatched: string[] = [];

  const lookup = db.prepare<[string], { checksum: string }>(
    'SELECT checksum FROM schema_migrations WHERE filename = ?',
  );
  const record = db.prepare(
    'INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)',
  );

  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf-8');
    const checksum = sha256(content);
    const existing = lookup.get(file);

    if (existing) {
      if (existing.checksum === checksum) {
        skipped.push(file);
      } else {
        mismatched.push(file);
      }
      continue;
    }

    const tx = db.transaction(() => {
      db.exec(content);
      record.run(file, checksum);
    });

    try {
      tx();
      applied.push(file);
    } catch (err) {
      throw new Error(
        `Migration failed: ${file}\n${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { applied, skipped, mismatched };
}

function isMainModule(): boolean {
  try {
    const entryPath = argv[1];
    if (!entryPath) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const result = applyPendingMigrations();
    stdout.write(
      `applied=${result.applied.length} skipped=${result.skipped.length} mismatched=${result.mismatched.length}\n`,
    );
    if (result.applied.length > 0) {
      stdout.write(`  applied: ${result.applied.join(', ')}\n`);
    }
    if (result.mismatched.length > 0) {
      stderr.write(`CHECKSUM MISMATCH: ${result.mismatched.join(', ')}\n`);
      exit(2);
    }
  } catch (err) {
    stderr.write(`migration error: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  }
}
