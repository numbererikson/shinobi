import { getDb } from '../lib/db.js';
import { escapeFtsQuery } from '../lib/fts.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';
import { normalizeFilesTouched } from '../lib/paths.js';
import { PRIORITY_ORDER_SQL } from '../lib/priority.js';
import type { Priority, Status } from './projects.js';

export interface SubtaskRow {
  id: number;
  project_id: number | null;
  title: string;
  description: string | null;
  depends_on: string | null;
  sort_order: number;
  status: Status;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  claude_session_id: string | null;
  last_claimed_at: string | null;
  files_touched: string | null;
  scope_warning_at: string | null;
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_dims: number | null;
}

export interface Subtask
  extends Omit<SubtaskRow, 'depends_on' | 'files_touched'> {
  depends_on: number[] | null;
  files_touched: string[] | null;
}

function hydrate(row: SubtaskRow): Subtask {
  return {
    ...row,
    depends_on: parseJsonOrNull<number[]>(row.depends_on),
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
  };
}

export interface ListSubtasksOptions {
  projectId?: number;
  status?: Status;
  sessionId?: string;
}

export function listSubtasks(options: ListSubtasksOptions = {}): Subtask[] {
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
  if (options.sessionId) {
    where.push('claude_session_id = ?');
    params.push(options.sessionId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM subtasks
    ${whereSql}
    ORDER BY ${PRIORITY_ORDER_SQL} DESC, sort_order ASC, created_at ASC
  `;
  const rows = getDb().prepare<unknown[], SubtaskRow>(sql).all(...params);
  return rows.map(hydrate);
}

export function getSubtask(id: number): Subtask | null {
  const row = getDb()
    .prepare<[number], SubtaskRow>('SELECT * FROM subtasks WHERE id = ?')
    .get(id);
  return row ? hydrate(row) : null;
}

export interface CreateSubtaskInput {
  project_id?: number | null;
  title: string;
  description?: string | null;
  depends_on?: number[] | null;
  sort_order?: number;
  status?: Status;
  priority?: Priority;
  due_date?: string | null;
}

export function createSubtask(input: CreateSubtaskInput): Subtask {
  const result = getDb()
    .prepare(
      `INSERT INTO subtasks
        (project_id, title, description, depends_on, sort_order, status, priority, due_date)
       VALUES
        (?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 'todo'), COALESCE(?, 'medium'), ?)`,
    )
    .run(
      input.project_id ?? null,
      input.title,
      input.description ?? null,
      stringifyOrNull(input.depends_on),
      input.sort_order ?? null,
      input.status ?? null,
      input.priority ?? null,
      input.due_date ?? null,
    );
  const created = getSubtask(Number(result.lastInsertRowid));
  if (!created) throw new Error('createSubtask: lookup after insert returned null');
  return created;
}

export function bulkCreateSubtasks(inputs: CreateSubtaskInput[]): Subtask[] {
  if (inputs.length === 0) return [];
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO subtasks
      (project_id, title, description, depends_on, sort_order, status, priority, due_date)
     VALUES
      (?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 'todo'), COALESCE(?, 'medium'), ?)`,
  );
  const ids: number[] = [];
  const tx = db.transaction((batch: CreateSubtaskInput[]) => {
    for (const input of batch) {
      const r = stmt.run(
        input.project_id ?? null,
        input.title,
        input.description ?? null,
        stringifyOrNull(input.depends_on),
        input.sort_order ?? null,
        input.status ?? null,
        input.priority ?? null,
        input.due_date ?? null,
      );
      ids.push(Number(r.lastInsertRowid));
    }
  });
  tx(inputs);
  return ids.map((id) => {
    const s = getSubtask(id);
    if (!s) throw new Error(`bulkCreateSubtasks: missing id ${id}`);
    return s;
  });
}

export interface UpdateSubtaskInput {
  project_id?: number | null;
  title?: string;
  description?: string | null;
  depends_on?: number[] | null;
  sort_order?: number;
  status?: Status;
  priority?: Priority;
  due_date?: string | null;
  claude_session_id?: string | null;
  last_claimed_at?: string | null;
  files_touched?: string[] | null;
}

const UPDATABLE: Record<keyof UpdateSubtaskInput, (v: unknown) => unknown> = {
  project_id: (v) => v ?? null,
  title: (v) => v,
  description: (v) => v ?? null,
  depends_on: (v) => stringifyOrNull(v),
  sort_order: (v) => v,
  status: (v) => v,
  priority: (v) => v,
  due_date: (v) => v ?? null,
  claude_session_id: (v) => v ?? null,
  last_claimed_at: (v) => v ?? null,
  files_touched: (v) => stringifyOrNull(normalizeFilesTouched(v as string[] | null | undefined)),
};

function detectCircular(id: number, deps: number[]): boolean {
  if (deps.includes(id)) return true;
  const visited = new Set<number>();
  const stack = [...deps];
  const select = getDb().prepare<[number], { depends_on: string | null }>(
    'SELECT depends_on FROM subtasks WHERE id = ?',
  );
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) continue;
    if (next === id) return true;
    if (visited.has(next)) continue;
    visited.add(next);
    const row = select.get(next);
    const sub = parseJsonOrNull<number[]>(row?.depends_on ?? null);
    if (sub) stack.push(...sub);
  }
  return false;
}

export function updateSubtask(id: number, patch: UpdateSubtaskInput): Subtask | null {
  if ('depends_on' in patch && Array.isArray(patch.depends_on)) {
    if (detectCircular(id, patch.depends_on)) {
      throw new Error(`updateSubtask: circular dependency detected for subtask ${id}`);
    }
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(patch)) {
    const k = key as keyof UpdateSubtaskInput;
    if (!(k in UPDATABLE)) continue;
    sets.push(`${k} = ?`);
    params.push(UPDATABLE[k](val));
  }
  if (sets.length === 0) return getSubtask(id);
  params.push(id);
  getDb()
    .prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
  return getSubtask(id);
}

export function deleteSubtask(id: number): boolean {
  const r = getDb().prepare('DELETE FROM subtasks WHERE id = ?').run(id);
  return r.changes > 0;
}

export function claimSubtask(id: number, sessionId: string): Subtask | null {
  getDb()
    .prepare(
      `UPDATE subtasks SET status = 'in_progress', claude_session_id = ?, last_claimed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(sessionId, id);
  return getSubtask(id);
}

export function setSubtaskAssignee(id: number, userId: number | null): Subtask | null {
  getDb().prepare('UPDATE subtasks SET assignee_user_id = ? WHERE id = ?').run(userId, id);
  return getSubtask(id);
}

export function completeSubtask(id: number): Subtask | null {
  getDb().prepare(`UPDATE subtasks SET status = 'done' WHERE id = ?`).run(id);
  return getSubtask(id);
}

export interface NextTaskOptions {
  projectId?: number;
}

export function nextTask(options: NextTaskOptions = {}): Subtask | null {
  const params: unknown[] = ['todo'];
  let projectFilter = '';
  if (options.projectId !== undefined) {
    projectFilter = 'AND project_id = ?';
    params.push(options.projectId);
  }
  const candidates = getDb()
    .prepare<unknown[], SubtaskRow>(
      `SELECT * FROM subtasks
       WHERE status = ? ${projectFilter}
       ORDER BY ${PRIORITY_ORDER_SQL} DESC, sort_order ASC, created_at ASC`,
    )
    .all(...params);

  const doneCheck = getDb().prepare<[number], { status: Status }>(
    'SELECT status FROM subtasks WHERE id = ?',
  );

  for (const candidate of candidates) {
    const deps = parseJsonOrNull<number[]>(candidate.depends_on);
    if (!deps || deps.length === 0) return hydrate(candidate);

    let allDone = true;
    for (const depId of deps) {
      const row = doneCheck.get(depId);
      if (!row || row.status !== 'done') {
        allDone = false;
        break;
      }
    }
    if (allDone) return hydrate(candidate);
  }
  return null;
}

export function findDependents(subtaskId: number): Subtask[] {
  const rows = getDb()
    .prepare<[string, string], SubtaskRow>(
      `SELECT * FROM subtasks
       WHERE depends_on IS NOT NULL
         AND (depends_on LIKE ? OR depends_on LIKE ?)`,
    )
    .all(`%[${subtaskId}]%`, `%,${subtaskId}%`);
  return rows.filter((row) => {
    const deps = parseJsonOrNull<number[]>(row.depends_on);
    return deps?.includes(subtaskId) ?? false;
  }).map(hydrate);
}

export function searchSubtasks(query: string, projectId?: number, limit = 20): Subtask[] {
  const ftsQ = escapeFtsQuery(query);
  if (!ftsQ) return [];
  const params: unknown[] = [ftsQ];
  let projectFilter = '';
  if (projectId !== undefined) {
    projectFilter = 'AND s.project_id = ?';
    params.push(projectId);
  }
  params.push(limit);
  const rows = getDb()
    .prepare<unknown[], SubtaskRow>(
      `SELECT s.* FROM subtasks s
       JOIN subtasks_fts f ON s.id = f.rowid
       WHERE subtasks_fts MATCH ? ${projectFilter}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}
