import { getDb } from '../lib/db.js';
import { PRIORITY_ORDER_SQL } from '../lib/priority.js';
import { resolve } from 'node:path';

export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: number;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  project_type: string | null;
  target_path: string | null;
  workspace: string | null;
  archived_at: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  recent_summary_md: string | null;
  recent_summary_at: string | null;
  recent_summary_provider: string | null;
  subtasks_total: number;
  subtasks_done: number;
}

const SUBTASK_AGGREGATE_SQL = `
  LEFT JOIN (
    SELECT
      project_id,
      COUNT(*) AS subtasks_total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS subtasks_done
    FROM subtasks
    GROUP BY project_id
  ) AS subtask_counts ON subtask_counts.project_id = projects.id
`;

const SUBTASK_AGGREGATE_COLS = `
  COALESCE(subtask_counts.subtasks_total, 0) AS subtasks_total,
  COALESCE(subtask_counts.subtasks_done, 0) AS subtasks_done
`;

export type ProjectSort = 'priority' | 'active' | 'created';

export interface ListProjectsOptions {
  includeArchived?: boolean;
  status?: Status;
  workspace?: string;
  sort?: ProjectSort;
}

export function listProjects(options: ListProjectsOptions = {}): Project[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!options.includeArchived) where.push('archived_at IS NULL');
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }
  if (options.workspace) {
    where.push('workspace = ?');
    params.push(options.workspace);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sort: ProjectSort = options.sort ?? 'priority';

  if (sort === 'active') {
    // Order by most-recent activity row per project; fall back to project creation timestamp
    // for projects that have no activity yet so they aren't pushed to the bottom forever.
    const sql = `
      SELECT projects.*,
        ${SUBTASK_AGGREGATE_COLS},
        COALESCE(MAX(activity.created_at), projects.created_at) AS last_active
      FROM projects
      LEFT JOIN activity ON activity.project_id = projects.id
      ${SUBTASK_AGGREGATE_SQL}
      ${whereSql}
      GROUP BY projects.id
      ORDER BY last_active DESC
    `;
    return getDb().prepare<unknown[], Project>(sql).all(...params);
  }

  if (sort === 'created') {
    const sql = `
      SELECT projects.*, ${SUBTASK_AGGREGATE_COLS}
      FROM projects
      ${SUBTASK_AGGREGATE_SQL}
      ${whereSql}
      ORDER BY projects.created_at DESC
    `;
    return getDb().prepare<unknown[], Project>(sql).all(...params);
  }

  const sql = `
    SELECT projects.*, ${SUBTASK_AGGREGATE_COLS}
    FROM projects
    ${SUBTASK_AGGREGATE_SQL}
    ${whereSql}
    ORDER BY ${PRIORITY_ORDER_SQL} DESC, projects.created_at DESC
  `;
  return getDb().prepare<unknown[], Project>(sql).all(...params);
}

export function getProject(id: number): Project | null {
  const sql = `
    SELECT projects.*, ${SUBTASK_AGGREGATE_COLS}
    FROM projects
    ${SUBTASK_AGGREGATE_SQL}
    WHERE projects.id = ?
  `;
  const row = getDb().prepare<[number], Project>(sql).get(id);
  return row ?? null;
}

export interface CreateProjectInput {
  title: string;
  description?: string | null;
  status?: Status;
  priority?: Priority;
  project_type?: string | null;
  target_path?: string | null;
  workspace?: string | null;
  due_date?: string | null;
}

export function createProject(input: CreateProjectInput): Project {
  const result = getDb()
    .prepare(
      `INSERT INTO projects (title, description, status, priority, project_type, target_path, workspace, due_date)
       VALUES (?, ?, COALESCE(?, 'todo'), COALESCE(?, 'medium'), ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.description ?? null,
      input.status ?? null,
      input.priority ?? null,
      input.project_type ?? null,
      input.target_path ?? null,
      input.workspace ?? null,
      input.due_date ?? null,
    );
  const created = getProject(Number(result.lastInsertRowid));
  if (!created) {
    throw new Error('createProject: insert succeeded but lookup returned null');
  }
  return created;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string | null;
  status?: Status;
  priority?: Priority;
  project_type?: string | null;
  target_path?: string | null;
  workspace?: string | null;
  due_date?: string | null;
}

const UPDATABLE_FIELDS = new Set<keyof UpdateProjectInput>([
  'title',
  'description',
  'status',
  'priority',
  'project_type',
  'target_path',
  'workspace',
  'due_date',
]);

export function updateProject(id: number, patch: UpdateProjectInput): Project | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(patch)) {
    if (!UPDATABLE_FIELDS.has(key as keyof UpdateProjectInput)) continue;
    sets.push(`${key} = ?`);
    params.push(val);
  }
  if (sets.length === 0) return getProject(id);
  params.push(id);
  getDb()
    .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
  return getProject(id);
}

export function archiveProject(id: number): Project | null {
  getDb()
    .prepare(`UPDATE projects SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL`)
    .run(id);
  return getProject(id);
}

export function unarchiveProject(id: number): Project | null {
  getDb().prepare('UPDATE projects SET archived_at = NULL WHERE id = ?').run(id);
  return getProject(id);
}

export function deleteProject(id: number): boolean {
  const r = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  return r.changes > 0;
}

export function projectsMatchingTargetPath(filePath: string): Project[] {
  const normalizedFile = normalizePathForMatch(filePath);
  return getDb()
    .prepare<[], Project>(
      `SELECT projects.*, ${SUBTASK_AGGREGATE_COLS}
       FROM projects
       ${SUBTASK_AGGREGATE_SQL}
       WHERE projects.target_path IS NOT NULL
         AND projects.target_path != ''
         AND projects.archived_at IS NULL
       ORDER BY LENGTH(projects.target_path) DESC`,
    )
    .all()
    .filter((project) => {
      if (!project.target_path) return false;
      const normalizedTarget = normalizePathForMatch(project.target_path);
      return (
        normalizedFile === normalizedTarget ||
        normalizedFile.startsWith(`${normalizedTarget}/`)
      );
    });
}

function normalizePathForMatch(path: string): string {
  const normalized = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
