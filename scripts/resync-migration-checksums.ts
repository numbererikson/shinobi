// Re-sync schema_migrations.checksum to match the current on-disk migration files.
// Safe to run when the DB schema is correct but file content was edited
// (e.g. line-ending normalization from git clone, whitespace cleanup).

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, getDb } from '../src/lib/db.js';
import { migrationsDir } from '../src/lib/migrations.js';

const dir = migrationsDir();
const files = readdirSync(dir)
  .filter((f) => /^\d{4}_[A-Za-z0-9_\-]+\.sql$/.test(f))
  .sort();

const db = getDb();
const updateChecksum = db.prepare('UPDATE schema_migrations SET checksum = ? WHERE filename = ?');
const lookup = db.prepare<[string], { checksum: string } | undefined>(
  'SELECT checksum FROM schema_migrations WHERE filename = ?',
);

let resynced = 0;
let untracked = 0;
for (const file of files) {
  const content = readFileSync(join(dir, file), 'utf-8');
  const newChecksum = createHash('sha256').update(content).digest('hex');
  const existing = lookup.get(file);
  if (!existing) {
    console.log(`SKIP ${file} — not in schema_migrations (not yet applied)`);
    untracked++;
    continue;
  }
  if (existing.checksum === newChecksum) {
    console.log(`OK   ${file} — checksum matches`);
    continue;
  }
  updateChecksum.run(newChecksum, file);
  console.log(`SYNC ${file} — checksum updated to ${newChecksum.slice(0, 16)}...`);
  resynced++;
}

console.log(`\nresynced: ${resynced}, untracked: ${untracked}, total files: ${files.length}`);
closeDb();
