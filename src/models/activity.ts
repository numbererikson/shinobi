import { getDb } from '../lib/db.js';

export interface ActivityRow {
  id: number;
  project_id: number | null;
  session_id: string | null;
  action_type: string;
  action_details: string | null;
  entity_type: string | null;
  entity_id: number | null;
  ref_url: string | null;
  ref_status: string | null;
  created_at: string;
}

export interface RecordActivityInput {
  project_id?: number | null;
  session_id?: string | null;
  action_type: string;
  action_details?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  ref_url?: string | null;
  ref_status?: string | null;
}

export function recordActivity(input: RecordActivityInput): ActivityRow {
  const result = getDb()
    .prepare(
      `INSERT INTO activity
        (project_id, session_id, action_type, action_details, entity_type, entity_id, ref_url, ref_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.project_id ?? null,
      input.session_id ?? null,
      input.action_type,
      input.action_details ?? null,
      input.entity_type ?? null,
      input.entity_id ?? null,
      input.ref_url ?? null,
      input.ref_status ?? null,
    );
  const row = getDb()
    .prepare<[number], ActivityRow>('SELECT * FROM activity WHERE id = ?')
    .get(Number(result.lastInsertRowid));
  if (!row) throw new Error('recordActivity: lookup after insert returned null');
  return row;
}

export interface ListActivityOptions {
  projectId?: number;
  sessionId?: string;
  entityType?: string;
  entityId?: number;
  actionType?: string;
  limit?: number;
}

export function listActivity(options: ListActivityOptions = {}): ActivityRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.projectId !== undefined) {
    where.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.sessionId) {
    where.push('session_id = ?');
    params.push(options.sessionId);
  }
  if (options.entityType) {
    where.push('entity_type = ?');
    params.push(options.entityType);
  }
  if (options.entityId !== undefined) {
    where.push('entity_id = ?');
    params.push(options.entityId);
  }
  if (options.actionType) {
    where.push('action_type = ?');
    params.push(options.actionType);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(options.limit ?? 100);
  return getDb()
    .prepare<unknown[], ActivityRow>(
      `SELECT * FROM activity ${whereSql} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
}

export function linkCommit(input: {
  project_id?: number | null;
  subtask_id?: number | null;
  commit_sha: string;
  ref_url?: string | null;
  message?: string | null;
  session_id?: string | null;
}): ActivityRow {
  return recordActivity({
    project_id: input.project_id ?? null,
    session_id: input.session_id ?? null,
    action_type: input.subtask_id ? 'commit_linked' : 'commit_path_matched',
    action_details: input.message ?? input.commit_sha,
    entity_type: input.subtask_id ? 'subtask' : 'commit',
    entity_id: input.subtask_id ?? null,
    ref_url: input.ref_url ?? input.commit_sha,
  });
}
