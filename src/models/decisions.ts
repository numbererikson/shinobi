import { getDb } from '../lib/db.js';
import { escapeFtsQuery } from '../lib/fts.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';
import { filePathsMatch, normalizeFilePath, normalizeFilesTouched } from '../lib/paths.js';

export type DecisionKind =
  | 'architecture'
  | 'library'
  | 'pattern'
  | 'tradeoff'
  | 'workaround'
  | 'other';

export type DecisionStatus =
  | 'open'
  | 'fix_now'
  | 'fix_later'
  | 'wontfix'
  | 'fixed'
  | 'false_positive';

export interface DecisionRow {
  id: number;
  project_id: number;
  subtask_id: number | null;
  kind: DecisionKind;
  summary: string;
  rationale: string;
  alternatives_considered: string | null;
  files_touched: string | null;
  tags: string | null;
  status: DecisionStatus;
  decided_at: string | null;
  decided_by_session_id: string | null;
  fixed_in_commit_sha: string | null;
  claude_session_id: string | null;
  created_at: string;
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_dims: number | null;
}

export interface Decision extends Omit<DecisionRow, 'files_touched' | 'tags'> {
  files_touched: string[] | null;
  tags: string[] | null;
}

function hydrate(row: DecisionRow): Decision {
  return {
    ...row,
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
    tags: parseJsonOrNull<string[]>(row.tags),
  };
}

export interface LogDecisionInput {
  project_id: number;
  subtask_id?: number | null;
  summary: string;
  rationale: string;
  alternatives_considered?: string | null;
  files_touched?: string[] | null;
  tags?: string[] | null;
  kind?: DecisionKind;
  claude_session_id?: string | null;
}

export function logDecision(input: LogDecisionInput): Decision {
  const result = getDb()
    .prepare(
      `INSERT INTO decisions
        (project_id, subtask_id, kind, summary, rationale, alternatives_considered,
         files_touched, tags, claude_session_id)
       VALUES (?, ?, COALESCE(?, 'other'), ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.project_id,
      input.subtask_id ?? null,
      input.kind ?? null,
      input.summary,
      input.rationale,
      input.alternatives_considered ?? null,
      stringifyOrNull(normalizeFilesTouched(input.files_touched)),
      stringifyOrNull(input.tags),
      input.claude_session_id ?? null,
    );
  const created = getDecision(Number(result.lastInsertRowid));
  if (!created) throw new Error('logDecision: lookup after insert returned null');
  return created;
}

export function getDecision(id: number): Decision | null {
  const row = getDb()
    .prepare<[number], DecisionRow>('SELECT * FROM decisions WHERE id = ?')
    .get(id);
  return row ? hydrate(row) : null;
}

export interface ListDecisionsOptions {
  projectId?: number;
  subtaskId?: number;
  sessionId?: string;
  status?: DecisionStatus;
  limit?: number;
}

export function listDecisions(options: ListDecisionsOptions = {}): Decision[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.projectId !== undefined) {
    where.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.subtaskId !== undefined) {
    where.push('subtask_id = ?');
    params.push(options.subtaskId);
  }
  if (options.sessionId) {
    where.push('claude_session_id = ?');
    params.push(options.sessionId);
  }
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(options.limit ?? 100);
  const rows = getDb()
    .prepare<unknown[], DecisionRow>(
      `SELECT * FROM decisions ${whereSql} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}

export function searchDecisions(query: string, projectId?: number, limit = 20): Decision[] {
  const ftsQ = escapeFtsQuery(query);
  if (!ftsQ) return [];
  const params: unknown[] = [ftsQ];
  let projectFilter = '';
  if (projectId !== undefined) {
    projectFilter = 'AND d.project_id = ?';
    params.push(projectId);
  }
  params.push(limit);
  const rows = getDb()
    .prepare<unknown[], DecisionRow>(
      `SELECT d.* FROM decisions d
       JOIN decisions_fts f ON d.id = f.rowid
       WHERE decisions_fts MATCH ? ${projectFilter}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}

export function decisionsForFile(filePath: string, limit = 50): Decision[] {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) return [];
  // Narrow with the basename so the LIKE matches rows stored either
  // repo-relative or with a legacy absolute root (backslashes included,
  // since basenames contain no separators); filePathsMatch is authoritative.
  const basename = normalized.split('/').pop() ?? normalized;
  const rows = getDb()
    .prepare<[string, number], DecisionRow>(
      `SELECT * FROM decisions
       WHERE files_touched IS NOT NULL
         AND files_touched LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(`%${basename}%`, Math.max(limit * 5, 200));
  return rows
    .map(hydrate)
    .filter((decision) => decision.files_touched?.some((p) => filePathsMatch(p, normalized)) ?? false)
    .slice(0, limit);
}

export function updateDecisionStatus(
  id: number,
  status: DecisionStatus,
  fixedInCommit?: string | null,
): Decision | null {
  getDb()
    .prepare(
      `UPDATE decisions
       SET status = ?,
           decided_at = CASE WHEN ? IN ('fixed','wontfix','false_positive') THEN CURRENT_TIMESTAMP ELSE decided_at END,
           fixed_in_commit_sha = COALESCE(?, fixed_in_commit_sha)
       WHERE id = ?`,
    )
    .run(status, status, fixedInCommit ?? null, id);
  return getDecision(id);
}
