import { getDb } from '../lib/db.js';

export interface SessionCost {
  session_id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  assistant_turns: number;
  cost_usd: number;
  source_path: string | null;
  parsed_at: string;
}

export interface UpsertSessionCostInput {
  session_id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  assistant_turns: number;
  cost_usd: number;
  source_path: string | null;
}

export function upsertSessionCost(input: UpsertSessionCostInput): SessionCost {
  getDb()
    .prepare(
      `INSERT INTO session_costs (
         session_id, model, input_tokens, output_tokens,
         cache_creation_tokens, cache_read_tokens, assistant_turns,
         cost_usd, source_path, parsed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(session_id) DO UPDATE SET
         model = excluded.model,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens,
         cache_read_tokens = excluded.cache_read_tokens,
         assistant_turns = excluded.assistant_turns,
         cost_usd = excluded.cost_usd,
         source_path = excluded.source_path,
         parsed_at = CURRENT_TIMESTAMP`,
    )
    .run(
      input.session_id,
      input.model,
      input.input_tokens,
      input.output_tokens,
      input.cache_creation_tokens,
      input.cache_read_tokens,
      input.assistant_turns,
      input.cost_usd,
      input.source_path,
    );
  const row = getSessionCost(input.session_id);
  if (!row) throw new Error(`upsertSessionCost: lookup after upsert returned null for ${input.session_id}`);
  return row;
}

export function getSessionCost(sessionId: string): SessionCost | null {
  return (
    getDb()
      .prepare<[string], SessionCost>('SELECT * FROM session_costs WHERE session_id = ?')
      .get(sessionId) ?? null
  );
}

export interface TaskCostStats {
  subtask_id: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  session_count: number;
  by_model: Array<{ model: string; cost_usd: number; sessions: number }>;
}

export function getTaskCostStats(subtaskId: number): TaskCostStats {
  interface SumRow {
    total_cost_usd: number | null;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
    total_cache_creation_tokens: number | null;
    total_cache_read_tokens: number | null;
    session_count: number;
  }
  const sum = getDb()
    .prepare<[number], SumRow>(
      `SELECT
         COALESCE(SUM(sc.cost_usd), 0) AS total_cost_usd,
         COALESCE(SUM(sc.input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(sc.output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(sc.cache_creation_tokens), 0) AS total_cache_creation_tokens,
         COALESCE(SUM(sc.cache_read_tokens), 0) AS total_cache_read_tokens,
         COUNT(*) AS session_count
       FROM session_costs sc
       JOIN sessions s ON s.session_id = sc.session_id
       WHERE s.subtask_id = ?`,
    )
    .get(subtaskId);

  interface ByModelRow {
    model: string;
    cost_usd: number;
    sessions: number;
  }
  const byModel = getDb()
    .prepare<[number], ByModelRow>(
      `SELECT
         COALESCE(sc.model, '(unknown)') AS model,
         SUM(sc.cost_usd) AS cost_usd,
         COUNT(*) AS sessions
       FROM session_costs sc
       JOIN sessions s ON s.session_id = sc.session_id
       WHERE s.subtask_id = ?
       GROUP BY sc.model
       ORDER BY cost_usd DESC`,
    )
    .all(subtaskId);

  return {
    subtask_id: subtaskId,
    total_cost_usd: sum?.total_cost_usd ?? 0,
    total_input_tokens: sum?.total_input_tokens ?? 0,
    total_output_tokens: sum?.total_output_tokens ?? 0,
    total_cache_creation_tokens: sum?.total_cache_creation_tokens ?? 0,
    total_cache_read_tokens: sum?.total_cache_read_tokens ?? 0,
    session_count: sum?.session_count ?? 0,
    by_model: byModel,
  };
}

export interface ProjectCostStats {
  project_id: number;
  total_cost_usd: number;
  session_count: number;
  per_subtask: TaskCostStats[];
}

export function getProjectCostStats(projectId: number): ProjectCostStats {
  const subtaskRows = getDb()
    .prepare<[number], { id: number }>('SELECT id FROM subtasks WHERE project_id = ?')
    .all(projectId);
  const perSubtask = subtaskRows.map((r) => getTaskCostStats(r.id));
  return {
    project_id: projectId,
    total_cost_usd: perSubtask.reduce((s, x) => s + x.total_cost_usd, 0),
    session_count: perSubtask.reduce((s, x) => s + x.session_count, 0),
    per_subtask: perSubtask.filter((s) => s.session_count > 0).sort((a, b) => b.total_cost_usd - a.total_cost_usd),
  };
}
