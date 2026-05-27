import { getDb } from '../lib/db.js';

export type PrState = 'open' | 'closed' | 'merged';

export interface PrLink {
  id: number;
  subtask_id: number;
  project_id: number | null;
  repo: string;
  pr_number: number;
  pr_url: string;
  title: string | null;
  state: PrState;
  opened_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

export interface UpsertPrLinkInput {
  subtask_id: number;
  project_id?: number | null;
  repo: string;
  pr_number: number;
  pr_url: string;
  title?: string | null;
  state?: PrState;
}

export function upsertPrLink(input: UpsertPrLinkInput): PrLink {
  getDb()
    .prepare(
      `INSERT INTO pr_links (subtask_id, project_id, repo, pr_number, pr_url, title, state)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'open'))
       ON CONFLICT(repo, pr_number) DO UPDATE SET
         subtask_id = excluded.subtask_id,
         project_id = COALESCE(excluded.project_id, pr_links.project_id),
         pr_url = excluded.pr_url,
         title = excluded.title`,
    )
    .run(
      input.subtask_id,
      input.project_id ?? null,
      input.repo,
      input.pr_number,
      input.pr_url,
      input.title ?? null,
      input.state ?? null,
    );
  const row = getByRepoPr(input.repo, input.pr_number);
  if (!row) throw new Error('upsertPrLink: lookup after upsert returned null');
  return row;
}

export function getByRepoPr(repo: string, prNumber: number): PrLink | null {
  return (
    getDb()
      .prepare<[string, number], PrLink>('SELECT * FROM pr_links WHERE repo = ? AND pr_number = ?')
      .get(repo, prNumber) ?? null
  );
}

export function listLinksForSubtask(subtaskId: number): PrLink[] {
  return getDb()
    .prepare<[number], PrLink>('SELECT * FROM pr_links WHERE subtask_id = ? ORDER BY opened_at DESC')
    .all(subtaskId);
}

export function listLinksForProject(projectId: number, limit = 50): PrLink[] {
  return getDb()
    .prepare<[number, number], PrLink>(
      `SELECT * FROM pr_links WHERE project_id = ? ORDER BY opened_at DESC LIMIT ?`,
    )
    .all(projectId, limit);
}

export interface MarkPrStateInput {
  repo: string;
  pr_number: number;
  state: PrState;
  closed_at?: string | null;
  merged_at?: string | null;
}

export function markPrState(input: MarkPrStateInput): PrLink | null {
  const existing = getByRepoPr(input.repo, input.pr_number);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE pr_links
       SET state = ?,
           closed_at = COALESCE(?, closed_at),
           merged_at = COALESCE(?, merged_at)
       WHERE id = ?`,
    )
    .run(input.state, input.closed_at ?? null, input.merged_at ?? null, existing.id);
  return getByRepoPr(input.repo, input.pr_number);
}
