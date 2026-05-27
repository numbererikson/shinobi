import { getDb } from '../lib/db.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';
import { logDecision, type DecisionKind } from './decisions.js';

export type DraftStatus = 'pending' | 'approved' | 'rejected';

export interface DecisionDraftRow {
  id: number;
  project_id: number;
  session_id: string | null;
  kind: DecisionKind;
  summary: string;
  rationale: string;
  alternatives_considered: string | null;
  files_touched: string | null;
  status: DraftStatus;
  approved_decision_id: number | null;
  source: string;
  extractor_model: string | null;
  source_text_hash: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface DecisionDraft extends Omit<DecisionDraftRow, 'files_touched'> {
  files_touched: string[] | null;
}

function hydrate(row: DecisionDraftRow): DecisionDraft {
  return {
    ...row,
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
  };
}

export interface CreateDraftInput {
  project_id: number;
  session_id?: string | null;
  kind?: DecisionKind;
  summary: string;
  rationale: string;
  alternatives_considered?: string | null;
  files_touched?: string[] | null;
  source?: string;
  extractor_model?: string | null;
  source_text_hash?: string | null;
}

export function createDraft(input: CreateDraftInput): DecisionDraft {
  const result = getDb()
    .prepare(
      `INSERT INTO decision_drafts
        (project_id, session_id, kind, summary, rationale, alternatives_considered,
         files_touched, source, extractor_model, source_text_hash)
       VALUES (?, ?, COALESCE(?, 'other'), ?, ?, ?, ?, COALESCE(?, 'extraction'), ?, ?)`,
    )
    .run(
      input.project_id,
      input.session_id ?? null,
      input.kind ?? null,
      input.summary,
      input.rationale,
      input.alternatives_considered ?? null,
      stringifyOrNull(input.files_touched),
      input.source ?? null,
      input.extractor_model ?? null,
      input.source_text_hash ?? null,
    );
  const draft = getDraft(Number(result.lastInsertRowid));
  if (!draft) throw new Error('createDraft: lookup after insert returned null');
  return draft;
}

export function getDraft(id: number): DecisionDraft | null {
  const row = getDb()
    .prepare<[number], DecisionDraftRow>('SELECT * FROM decision_drafts WHERE id = ?')
    .get(id);
  return row ? hydrate(row) : null;
}

export interface ListDraftsOptions {
  projectId?: number;
  status?: DraftStatus;
  limit?: number;
}

export function listDrafts(options: ListDraftsOptions = {}): DecisionDraft[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.projectId !== undefined) {
    where.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(options.limit ?? 100);
  const rows = getDb()
    .prepare<unknown[], DecisionDraftRow>(
      `SELECT * FROM decision_drafts ${whereSql}
       ORDER BY status = 'pending' DESC, created_at DESC
       LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}

export interface ApproveDraftOverrides {
  kind?: DecisionKind;
  summary?: string;
  rationale?: string;
  alternatives_considered?: string | null;
  files_touched?: string[] | null;
  tags?: string[] | null;
  subtask_id?: number | null;
  session_id?: string | null;
}

export function approveDraft(
  id: number,
  overrides: ApproveDraftOverrides = {},
): { draft: DecisionDraft; decisionId: number } | null {
  const draft = getDraft(id);
  if (!draft) return null;
  if (draft.status !== 'pending') {
    throw new Error(`draft ${id} is already ${draft.status}; cannot approve again`);
  }

  const decision = logDecision({
    project_id: draft.project_id,
    subtask_id: overrides.subtask_id ?? null,
    summary: overrides.summary ?? draft.summary,
    rationale: overrides.rationale ?? draft.rationale,
    alternatives_considered:
      overrides.alternatives_considered !== undefined
        ? overrides.alternatives_considered
        : draft.alternatives_considered,
    files_touched:
      overrides.files_touched !== undefined ? overrides.files_touched : draft.files_touched,
    tags: overrides.tags ?? null,
    kind: overrides.kind ?? draft.kind,
    claude_session_id: overrides.session_id ?? draft.session_id,
  });

  getDb()
    .prepare(
      `UPDATE decision_drafts
       SET status = 'approved', approved_decision_id = ?, processed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(decision.id, id);

  const updated = getDraft(id);
  if (!updated) throw new Error('approveDraft: lookup after update returned null');
  return { draft: updated, decisionId: decision.id };
}

export function rejectDraft(id: number): DecisionDraft | null {
  const draft = getDraft(id);
  if (!draft) return null;
  if (draft.status !== 'pending') {
    throw new Error(`draft ${id} is already ${draft.status}; cannot reject again`);
  }
  getDb()
    .prepare(`UPDATE decision_drafts SET status = 'rejected', processed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(id);
  return getDraft(id);
}

export function countDraftsByStatus(
  projectId?: number,
): Record<DraftStatus, number> {
  const params: unknown[] = [];
  let where = '';
  if (projectId !== undefined) {
    where = 'WHERE project_id = ?';
    params.push(projectId);
  }
  const rows = getDb()
    .prepare<unknown[], { status: DraftStatus; n: number }>(
      `SELECT status, COUNT(*) AS n FROM decision_drafts ${where} GROUP BY status`,
    )
    .all(...params);
  const out: Record<DraftStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
