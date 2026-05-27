import { getDb } from '../lib/db.js';

export interface Plan {
  id: number;
  project_id: number;
  version: number;
  plan_md: string;
  claude_session_id: string | null;
  created_at: string;
}

export interface SavePlanInput {
  project_id: number;
  plan_md: string;
  claude_session_id?: string | null;
}

export function savePlan(input: SavePlanInput): Plan {
  const db = getDb();
  const tx = db.transaction(() => {
    const next = db
      .prepare<[number], { v: number | null }>(
        'SELECT MAX(version) AS v FROM plans WHERE project_id = ?',
      )
      .get(input.project_id);
    const version = (next?.v ?? 0) + 1;
    const result = db
      .prepare(
        `INSERT INTO plans (project_id, version, plan_md, claude_session_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.project_id, version, input.plan_md, input.claude_session_id ?? null);
    return Number(result.lastInsertRowid);
  });
  const id = tx();
  const created = db.prepare<[number], Plan>('SELECT * FROM plans WHERE id = ?').get(id);
  if (!created) throw new Error('savePlan: lookup after insert returned null');
  return created;
}

export function getLatestPlan(projectId: number): Plan | null {
  const row = getDb()
    .prepare<[number], Plan>(
      'SELECT * FROM plans WHERE project_id = ? ORDER BY version DESC LIMIT 1',
    )
    .get(projectId);
  return row ?? null;
}

export function getPlanByVersion(projectId: number, version: number): Plan | null {
  const row = getDb()
    .prepare<[number, number], Plan>(
      'SELECT * FROM plans WHERE project_id = ? AND version = ?',
    )
    .get(projectId, version);
  return row ?? null;
}

export interface PlanSummary {
  id: number;
  version: number;
  claude_session_id: string | null;
  created_at: string;
  plan_md_length: number;
}

export function listPlanVersions(projectId: number): PlanSummary[] {
  return getDb()
    .prepare<[number], PlanSummary>(
      `SELECT id, version, claude_session_id, created_at, LENGTH(plan_md) AS plan_md_length
       FROM plans WHERE project_id = ? ORDER BY version DESC`,
    )
    .all(projectId);
}
