import { getDb } from '../lib/db.js';
import { escapeFtsQuery, ftsAnyQuery, significantTokens } from '../lib/fts.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';
import { filePathsMatch, normalizeFilePath, normalizeFilesTouched } from '../lib/paths.js';

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
  obsolete_at: string | null;
  obsolete_reason: string | null;
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
      stringifyOrNull(normalizeFilesTouched(input.files_involved)),
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
  /** Include dead ends marked obsolete (default false). */
  includeObsolete?: boolean;
}

/** Mark a dead end as no longer applying (with the reason), or make it active again. */
export function setDeadEndObsolete(id: number, obsolete: boolean, reason?: string | null): DeadEnd | null {
  getDb()
    .prepare(
      obsolete
        ? "UPDATE dead_ends SET obsolete_at = COALESCE(obsolete_at, datetime('now')), obsolete_reason = ? WHERE id = ?"
        : 'UPDATE dead_ends SET obsolete_at = NULL, obsolete_reason = ? WHERE id = ?',
    )
    .run(obsolete ? (reason ?? null) : null, id);
  return getDeadEnd(id);
}

export function checkDeadEnds(input: CheckDeadEndsInput): DeadEnd[] {
  const limit = input.limit ?? 10;
  const ftsQ = escapeFtsQuery(input.approach);
  const activeOnly = input.includeObsolete ? '' : 'AND de.obsolete_at IS NULL';
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
         WHERE dead_ends_fts MATCH ? ${projectFilter} ${activeOnly}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params);
    for (const row of rows) matches.set(row.id, hydrate(row));
  }

  const normalizedQuery = (input.files ?? []).map(normalizeFilePath).filter((f) => f.length > 0);
  if (normalizedQuery.length > 0) {
    // Narrow with basenames so rows stored either repo-relative or with a
    // legacy absolute root still surface; filePathsMatch is authoritative
    // (mirrors decisionsForFile, so dead-end file matching works cross-device).
    const basenames = normalizedQuery.map((f) => f.split('/').pop() ?? f);
    const placeholders = basenames.map(() => 'files_involved LIKE ?').join(' OR ');
    const params: unknown[] = basenames.map((b) => `%${b}%`);
    let projectFilter = '';
    if (input.projectId !== undefined) {
      projectFilter = 'AND project_id = ?';
      params.push(input.projectId);
    }
    params.push(Math.max(limit * 5, 200));
    const rows = getDb()
      .prepare<unknown[], DeadEndRow>(
        `SELECT * FROM dead_ends
         WHERE files_involved IS NOT NULL
           ${input.includeObsolete ? '' : 'AND obsolete_at IS NULL'}
           AND (${placeholders})
           ${projectFilter}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...params);
    for (const row of rows) {
      if (matches.has(row.id)) continue;
      const hydrated = hydrate(row);
      const overlap = hydrated.files_involved?.some((stored) =>
        normalizedQuery.some((q) => filePathsMatch(stored, q)),
      );
      if (overlap) matches.set(row.id, hydrated);
    }
  }

  return [...matches.values()].slice(0, limit);
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Active dead ends relevant to a free-text task description (e.g. the user's
 * prompt). Full-text ranks ANY significant word, then keeps only rows sharing
 * at least `minShared` distinct words with the text, so one common word does
 * not drag in unrelated failures.
 */
export function deadEndsForText(text: string, options: { limit?: number; minShared?: number; projectId?: number } = {}): DeadEnd[] {
  const tokens = significantTokens(text);
  if (tokens.length === 0) return [];
  const minShared = Math.min(options.minShared ?? 2, tokens.length);
  const params: unknown[] = [ftsAnyQuery(tokens)];
  let projectFilter = '';
  if (options.projectId !== undefined) {
    projectFilter = 'AND de.project_id = ?';
    params.push(options.projectId);
  }
  params.push(50);
  const rows = getDb()
    .prepare<unknown[], DeadEndRow>(
      `SELECT de.* FROM dead_ends de
       JOIN dead_ends_fts f ON de.id = f.rowid
       WHERE dead_ends_fts MATCH ? ${projectFilter} AND de.obsolete_at IS NULL
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...params);
  const folded = tokens.map(fold);
  return rows
    .filter((row) => {
      const hay = fold(`${row.attempted_approach} ${row.failure_reason}`);
      return folded.filter((t) => hay.includes(t)).length >= minShared;
    })
    .slice(0, options.limit ?? 3)
    .map(hydrate);
}
