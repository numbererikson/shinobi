import { getDb } from '../lib/db.js';
import { escapeFtsQuery } from '../lib/fts.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';

export interface DeadEndRow {
  id: number;
  project_id: number;
  attempted_approach: string;
  failure_reason: string;
  files_involved: string | null;
  never_retry: number;
  claude_session_id: string | null;
  created_at: string;
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_dims: number | null;
}

export interface DeadEnd extends Omit<DeadEndRow, 'files_involved' | 'never_retry'> {
  files_involved: string[] | null;
  never_retry: boolean;
}

function hydrate(row: DeadEndRow): DeadEnd {
  return {
    ...row,
    files_involved: parseJsonOrNull<string[]>(row.files_involved),
    never_retry: row.never_retry === 1,
  };
}

export interface LogDeadEndInput {
  project_id: number;
  attempted_approach: string;
  failure_reason: string;
  files_involved?: string[] | null;
  never_retry?: boolean;
  claude_session_id?: string | null;
}

export function logDeadEnd(input: LogDeadEndInput): DeadEnd {
  const result = getDb()
    .prepare(
      `INSERT INTO dead_ends
        (project_id, attempted_approach, failure_reason, files_involved, never_retry, claude_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.project_id,
      input.attempted_approach,
      input.failure_reason,
      stringifyOrNull(input.files_involved),
      input.never_retry ? 1 : 0,
      input.claude_session_id ?? null,
    );
  const created = getDeadEnd(Number(result.lastInsertRowid));
  if (!created) throw new Error('logDeadEnd: lookup after insert returned null');
  return created;
}

export function getDeadEnd(id: number): DeadEnd | null {
  const row = getDb()
    .prepare<[number], DeadEndRow>('SELECT * FROM dead_ends WHERE id = ?')
    .get(id);
  return row ? hydrate(row) : null;
}

export interface ListDeadEndsOptions {
  projectId?: number;
  sessionId?: string;
  limit?: number;
}

export function listDeadEnds(options: ListDeadEndsOptions = {}): DeadEnd[] {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (options.projectId !== undefined) {
    filters.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.sessionId) {
    filters.push('claude_session_id = ?');
    params.push(options.sessionId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(options.limit ?? 50);
  const rows = getDb()
    .prepare<unknown[], DeadEndRow>(
      `SELECT * FROM dead_ends ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}

export interface CheckDeadEndsInput {
  approach: string;
  files?: string[];
  projectId?: number;
  limit?: number;
}

export function checkDeadEnds(input: CheckDeadEndsInput): DeadEnd[] {
  const limit = input.limit ?? 10;
  const ftsQ = escapeFtsQuery(input.approach);
  const matches = new Map<number, DeadEnd>();

  if (ftsQ) {
    const params: unknown[] = [ftsQ];
    let projectFilter = '';
    if (input.projectId !== undefined) {
      projectFilter = 'AND de.project_id = ?';
      params.push(input.projectId);
    }
    params.push(limit);
    const rows = getDb()
      .prepare<unknown[], DeadEndRow>(
        `SELECT de.* FROM dead_ends de
         JOIN dead_ends_fts f ON de.id = f.rowid
         WHERE dead_ends_fts MATCH ? ${projectFilter}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params);
    for (const row of rows) matches.set(row.id, hydrate(row));
  }

  if (input.files && input.files.length > 0) {
    const placeholders = input.files.map(() => 'files_involved LIKE ?').join(' OR ');
    const params: unknown[] = input.files.map((f) => `%${f}%`);
    let projectFilter = '';
    if (input.projectId !== undefined) {
      projectFilter = 'AND project_id = ?';
      params.push(input.projectId);
    }
    params.push(limit);
    const rows = getDb()
      .prepare<unknown[], DeadEndRow>(
        `SELECT * FROM dead_ends
         WHERE files_involved IS NOT NULL
           AND (${placeholders})
           ${projectFilter}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params);
    for (const row of rows) {
      if (matches.has(row.id)) continue;
      const hydrated = hydrate(row);
      const overlap = hydrated.files_involved?.some((f) => input.files?.includes(f) ?? false);
      if (overlap) matches.set(row.id, hydrated);
    }
  }

  return [...matches.values()].slice(0, limit);
}
