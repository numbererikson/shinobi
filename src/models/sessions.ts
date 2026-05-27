import { getDb } from '../lib/db.js';

export interface Session {
  session_id: string;
  project_id: number | null;
  subtask_id: number | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tool_calls_count: number;
  files_touched_count: number;
  notes: string | null;
}

export interface OpenSessionInput {
  session_id: string;
  project_id?: number | null;
  subtask_id?: number | null;
  notes?: string | null;
}

export function openSession(input: OpenSessionInput): Session {
  getDb()
    .prepare(
      `INSERT INTO sessions (session_id, project_id, subtask_id, started_at, notes)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         project_id = excluded.project_id,
         subtask_id = excluded.subtask_id,
         notes      = excluded.notes`,
    )
    .run(
      input.session_id,
      input.project_id ?? null,
      input.subtask_id ?? null,
      input.notes ?? null,
    );
  const found = getSession(input.session_id);
  if (!found) throw new Error(`openSession: lookup after upsert returned null for ${input.session_id}`);
  return found;
}

export function getSession(sessionId: string): Session | null {
  const row = getDb()
    .prepare<[string], Session>('SELECT * FROM sessions WHERE session_id = ?')
    .get(sessionId);
  return row ?? null;
}

export function closeSession(sessionId: string, notes?: string | null): Session | null {
  const existing = getSession(sessionId);
  if (!existing) return null;
  if (existing.ended_at) return existing;

  getDb()
    .prepare(
      `UPDATE sessions
       SET ended_at = CURRENT_TIMESTAMP,
           duration_seconds = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER),
           notes = COALESCE(?, notes)
       WHERE session_id = ?`,
    )
    .run(notes ?? null, sessionId);
  return getSession(sessionId);
}

export function incrementToolCalls(sessionId: string, by = 1): void {
  getDb()
    .prepare('UPDATE sessions SET tool_calls_count = tool_calls_count + ? WHERE session_id = ?')
    .run(by, sessionId);
}

export interface TaskTimeStats {
  subtask_id: number;
  total_seconds: number;
  total_minutes: number;
  session_count: number;
  open_sessions: number;
  first_session_at: string | null;
  last_session_at: string | null;
}

export function getTaskTimeStats(subtaskId: number): TaskTimeStats {
  interface AggRow {
    total_seconds: number | null;
    session_count: number;
    open_sessions: number;
    first_session_at: string | null;
    last_session_at: string | null;
  }
  const row = getDb()
    .prepare<[number], AggRow>(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN duration_seconds IS NOT NULL THEN duration_seconds
             WHEN ended_at IS NULL THEN
               CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400 AS INTEGER)
             ELSE 0
           END
         ), 0) AS total_seconds,
         COUNT(*) AS session_count,
         SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open_sessions,
         MIN(started_at) AS first_session_at,
         MAX(started_at) AS last_session_at
       FROM sessions
       WHERE subtask_id = ?`,
    )
    .get(subtaskId);
  const totalSeconds = row?.total_seconds ?? 0;
  return {
    subtask_id: subtaskId,
    total_seconds: totalSeconds,
    total_minutes: Math.round(totalSeconds / 60),
    session_count: row?.session_count ?? 0,
    open_sessions: row?.open_sessions ?? 0,
    first_session_at: row?.first_session_at ?? null,
    last_session_at: row?.last_session_at ?? null,
  };
}

export interface ProjectTimeStats {
  project_id: number;
  total_seconds: number;
  total_minutes: number;
  session_count: number;
  per_subtask: TaskTimeStats[];
}

export function getProjectTimeStats(projectId: number): ProjectTimeStats {
  const subtaskRows = getDb()
    .prepare<[number], { id: number }>('SELECT id FROM subtasks WHERE project_id = ?')
    .all(projectId);
  const perSubtask = subtaskRows.map((r) => getTaskTimeStats(r.id));
  const totalSeconds = perSubtask.reduce((sum, s) => sum + s.total_seconds, 0);
  const sessionCount = perSubtask.reduce((sum, s) => sum + s.session_count, 0);
  return {
    project_id: projectId,
    total_seconds: totalSeconds,
    total_minutes: Math.round(totalSeconds / 60),
    session_count: sessionCount,
    per_subtask: perSubtask.filter((s) => s.session_count > 0).sort((a, b) => b.total_seconds - a.total_seconds),
  };
}

export function listSessions(projectId?: number, limit = 50): Session[] {
  if (projectId !== undefined) {
    return getDb()
      .prepare<[number, number], Session>(
        'SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(projectId, limit);
  }
  return getDb()
    .prepare<[number], Session>('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
    .all(limit);
}
