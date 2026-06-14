import { describe, expect, it } from 'vitest';

import type { Subtask } from '../../models/subtasks.js';
import { buildPrompt, dryRunWorker, spawnCommandWorker } from './worker.js';

function fakeTask(over: Partial<Subtask> = {}): Subtask {
  return {
    id: 7,
    project_id: 1,
    title: 'ship it',
    description: 'with feeling',
    depends_on: null,
    sort_order: 0,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    created_at: '',
    updated_at: '',
    claude_session_id: null,
    last_claimed_at: null,
    files_touched: null,
    scope_warning_at: null,
    embedding: null,
    embedding_provider: null,
    embedding_dims: null,
    ...over,
  } as unknown as Subtask;
}

describe('buildPrompt', () => {
  it('includes id, title, and description', () => {
    const p = buildPrompt(fakeTask());
    expect(p).toContain('#7');
    expect(p).toContain('ship it');
    expect(p).toContain('with feeling');
  });

  it('omits the description block when there is none', () => {
    const p = buildPrompt(fakeTask({ description: null }));
    expect(p).toBe('Work on Shinobi task #7: ship it');
  });
});

describe('dryRunWorker', () => {
  it('reports success and logs what it would run', async () => {
    const lines: string[] = [];
    const res = await dryRunWorker((m) => lines.push(m))(fakeTask());
    expect(res.ok).toBe(true);
    expect(lines[0]).toContain('[dry-run]');
    expect(lines[0]).toContain('#7');
  });
});

describe('spawnCommandWorker', () => {
  it('maps exit 0 to ok', async () => {
    const res = await spawnCommandWorker('exit 0')(fakeTask());
    expect(res.ok).toBe(true);
  });

  it('maps a non-zero exit to blocked', async () => {
    const res = await spawnCommandWorker('exit 7')(fakeTask());
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('exit 7');
  });

  it('exposes the task to the command via env vars', async () => {
    const res = await spawnCommandWorker('printf "%s" "$SHINOBI_TASK_ID:$SHINOBI_TASK_TITLE"')(fakeTask());
    expect(res.ok).toBe(true);
    expect(res.detail).toBe('7:ship it');
  });

  it('reports a spawn failure as blocked rather than throwing', async () => {
    const res = await spawnCommandWorker('this-command-does-not-exist-zzz')(fakeTask());
    expect(res.ok).toBe(false);
  });
});
