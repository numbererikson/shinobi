import { closeDb, getDb } from '../src/lib/db.js';

const db = getDb();

const objects = db
  .prepare(
    `SELECT type, name FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts_%' AND name NOT LIKE '%_fts_config'
     ORDER BY type, name`,
  )
  .all() as { type: string; name: string }[];

const grouped: Record<string, string[]> = {};
for (const obj of objects) {
  (grouped[obj.type] ??= []).push(obj.name);
}
for (const [type, names] of Object.entries(grouped)) {
  console.log(`${type} (${names.length}): ${names.join(', ')}`);
}

const project = db
  .prepare('INSERT INTO projects (title, description) VALUES (?, ?)')
  .run('Smoke project', 'Verifies CRUD + FTS5 sync');
const projectId = Number(project.lastInsertRowid);

const subtask = db
  .prepare('INSERT INTO subtasks (project_id, title, description) VALUES (?, ?, ?)')
  .run(projectId, 'Smoke subtask', 'Testing FTS5 trigger sync end to end');
const subtaskId = Number(subtask.lastInsertRowid);

db.prepare(
  'INSERT INTO decisions (project_id, summary, rationale) VALUES (?, ?, ?)',
).run(projectId, 'Smoke decision', 'Verifying decisions_fts mirror');

db.prepare(
  'INSERT INTO dead_ends (project_id, attempted_approach, failure_reason) VALUES (?, ?, ?)',
).run(projectId, 'Smoke approach', 'Pretend it failed');

db.prepare('INSERT INTO notes (project_id, body) VALUES (?, ?)').run(
  projectId,
  'Smoke note containing the word kangaroo',
);

const checks: { label: string; sql: string; param: string }[] = [
  { label: 'subtasks_fts', sql: 'SELECT s.id, s.title FROM subtasks s JOIN subtasks_fts f ON s.id = f.rowid WHERE subtasks_fts MATCH ?', param: 'FTS5' },
  { label: 'decisions_fts', sql: 'SELECT d.id, d.summary FROM decisions d JOIN decisions_fts f ON d.id = f.rowid WHERE decisions_fts MATCH ?', param: 'mirror' },
  { label: 'dead_ends_fts', sql: 'SELECT de.id, de.attempted_approach FROM dead_ends de JOIN dead_ends_fts f ON de.id = f.rowid WHERE dead_ends_fts MATCH ?', param: 'failed' },
  { label: 'notes_fts', sql: 'SELECT n.id, n.body FROM notes n JOIN notes_fts f ON n.id = f.rowid WHERE notes_fts MATCH ?', param: 'kangaroo' },
];

for (const c of checks) {
  const rows = db.prepare(c.sql).all(c.param);
  console.log(`${c.label}: ${rows.length} match`);
}

const tx = db.prepare('UPDATE subtasks SET status = ? WHERE id = ?').run('in_progress', subtaskId);
console.log(`updated subtask rows: ${tx.changes}`);
const refreshed = db
  .prepare<[number], { status: string; updated_at: string; created_at: string }>(
    'SELECT status, created_at, updated_at FROM subtasks WHERE id = ?',
  )
  .get(subtaskId);
console.log('subtask after update:', refreshed);

db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
const orphans = db.prepare('SELECT COUNT(*) AS n FROM subtasks').get() as { n: number };
console.log(`subtasks after project delete (FK cascade): ${orphans.n}`);

closeDb();
