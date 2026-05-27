import { getDb } from '../lib/db.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';

export interface ContextRow {
  project_id: number;
  conventions: string | null;
  dont_touch: string | null;
  test_patterns: string | null;
  deploy_notes: string | null;
  file_annotations: string | null;
  last_validated_commit: string | null;
  updated_at: string;
}

export interface Context extends Omit<ContextRow, 'dont_touch' | 'file_annotations'> {
  dont_touch: string[] | null;
  file_annotations: Record<string, string> | null;
}

function hydrate(row: ContextRow): Context {
  return {
    ...row,
    dont_touch: parseJsonOrNull<string[]>(row.dont_touch),
    file_annotations: parseJsonOrNull<Record<string, string>>(row.file_annotations),
  };
}

export function getContext(projectId: number): Context | null {
  const row = getDb()
    .prepare<[number], ContextRow>('SELECT * FROM context WHERE project_id = ?')
    .get(projectId);
  return row ? hydrate(row) : null;
}

export interface ContextPatch {
  conventions?: string | null;
  dont_touch?: string[] | null;
  test_patterns?: string | null;
  deploy_notes?: string | null;
  file_annotations?: Record<string, string> | null;
  last_validated_commit?: string | null;
}

export function upsertContext(projectId: number, patch: ContextPatch): Context {
  const db = getDb();
  const existing = getContext(projectId);

  if (!existing) {
    db.prepare(
      `INSERT INTO context
        (project_id, conventions, dont_touch, test_patterns, deploy_notes, file_annotations, last_validated_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      patch.conventions ?? null,
      stringifyOrNull(patch.dont_touch),
      patch.test_patterns ?? null,
      patch.deploy_notes ?? null,
      stringifyOrNull(patch.file_annotations),
      patch.last_validated_commit ?? null,
    );
    const created = getContext(projectId);
    if (!created) throw new Error('upsertContext: lookup after insert returned null');
    return created;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if ('conventions' in patch) {
    sets.push('conventions = ?');
    params.push(patch.conventions ?? null);
  }
  if ('dont_touch' in patch) {
    sets.push('dont_touch = ?');
    params.push(stringifyOrNull(patch.dont_touch));
  }
  if ('test_patterns' in patch) {
    sets.push('test_patterns = ?');
    params.push(patch.test_patterns ?? null);
  }
  if ('deploy_notes' in patch) {
    sets.push('deploy_notes = ?');
    params.push(patch.deploy_notes ?? null);
  }
  if ('file_annotations' in patch) {
    sets.push('file_annotations = ?');
    params.push(stringifyOrNull(patch.file_annotations));
  }
  if ('last_validated_commit' in patch) {
    sets.push('last_validated_commit = ?');
    params.push(patch.last_validated_commit ?? null);
  }

  if (sets.length > 0) {
    params.push(projectId);
    db.prepare(`UPDATE context SET ${sets.join(', ')} WHERE project_id = ?`).run(...params);
  }

  const updated = getContext(projectId);
  if (!updated) throw new Error('upsertContext: lookup after update returned null');
  return updated;
}
