import { getDb } from '../lib/db.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';

export type ApprovalStatus = 'pending' | 'responded' | 'expired' | 'cancelled';

export interface ApprovalRow {
  id: number;
  project_id: number | null;
  session_id: string | null;
  prompt: string;
  options_json: string;
  status: ApprovalStatus;
  response_value: string | null;
  response_note: string | null;
  responded_at: string | null;
  responded_by: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Approval extends Omit<ApprovalRow, 'options_json'> {
  options: string[];
}

function hydrate(row: ApprovalRow): Approval {
  return {
    ...row,
    options: parseJsonOrNull<string[]>(row.options_json) ?? ['yes', 'no'],
  };
}

export interface CreateApprovalInput {
  project_id?: number | null;
  session_id?: string | null;
  prompt: string;
  options?: string[];
  expires_at?: string | null;
}

export function createApproval(input: CreateApprovalInput): Approval {
  const result = getDb()
    .prepare(
      `INSERT INTO approvals (project_id, session_id, prompt, options_json, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.project_id ?? null,
      input.session_id ?? null,
      input.prompt,
      stringifyOrNull(input.options ?? ['yes', 'no']) ?? '["yes","no"]',
      input.expires_at ?? null,
    );
  const row = getDb()
    .prepare<[number], ApprovalRow>('SELECT * FROM approvals WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) throw new Error('createApproval: lookup after insert returned null');
  return hydrate(row);
}

export function getApproval(id: number): Approval | null {
  const row = getDb()
    .prepare<[number], ApprovalRow>('SELECT * FROM approvals WHERE id = ?')
    .get(id);
  return row ? hydrate(row) : null;
}

export interface RespondInput {
  value: string;
  note?: string | null;
  responded_by?: string | null;
}

export function respondToApproval(id: number, input: RespondInput): Approval | null {
  const existing = getApproval(id);
  if (!existing) return null;
  if (existing.status !== 'pending') {
    throw new Error(`approval ${id} already ${existing.status}; cannot respond`);
  }
  getDb()
    .prepare(
      `UPDATE approvals
       SET status = 'responded', response_value = ?, response_note = ?, responded_by = ?, responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(input.value, input.note ?? null, input.responded_by ?? null, id);
  return getApproval(id);
}

export function cancelApproval(id: number): Approval | null {
  const existing = getApproval(id);
  if (!existing) return null;
  if (existing.status !== 'pending') return existing;
  getDb()
    .prepare(
      `UPDATE approvals SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(id);
  return getApproval(id);
}

export function expireOldApprovals(): number {
  const r = getDb()
    .prepare(
      `UPDATE approvals
       SET status = 'expired', responded_at = CURRENT_TIMESTAMP
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`,
    )
    .run();
  return r.changes;
}

export interface ListApprovalsOptions {
  status?: ApprovalStatus;
  projectId?: number;
  limit?: number;
}

export function listApprovals(options: ListApprovalsOptions = {}): Approval[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  if (options.projectId !== undefined) {
    where.push('project_id = ?');
    params.push(options.projectId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(options.limit ?? 100);
  const rows = getDb()
    .prepare<unknown[], ApprovalRow>(
      `SELECT * FROM approvals ${whereSql}
       ORDER BY status = 'pending' DESC, created_at DESC
       LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}

export function waitForApprovalResponse(id: number, timeoutMs: number, pollMs = 500): Promise<Approval> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = (): void => {
      const approval = getApproval(id);
      if (!approval) {
        reject(new Error(`approval ${id} disappeared`));
        return;
      }
      if (approval.status !== 'pending') {
        resolve(approval);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(approval);
        return;
      }
      setTimeout(tick, pollMs);
    };
    setTimeout(tick, pollMs);
  });
}
