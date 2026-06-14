import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createProject } from './projects.js';
import { claimNextTask, createSubtask, getSubtask } from './subtasks.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-claimnext-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('claimNextTask', () => {
  it('claims the next ready task and marks it in_progress in one step', () => {
    const projectId = createProject({ title: 'claim one' }).id;
    const task = createSubtask({ project_id: projectId, title: 'do it' });

    const claimed = claimNextTask('agent-1', { projectId });

    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe('in_progress');
    expect(claimed?.claude_session_id).toBe('agent-1');
    // persisted, not just returned
    expect(getSubtask(task.id)?.status).toBe('in_progress');
  });

  it('hands distinct tasks to successive claimers — never the same one twice', () => {
    const projectId = createProject({ title: 'no double claim' }).id;
    const a = createSubtask({ project_id: projectId, title: 'a', priority: 'high', sort_order: 1 });
    const b = createSubtask({ project_id: projectId, title: 'b', priority: 'low', sort_order: 2 });

    const c1 = claimNextTask('agent-1', { projectId });
    const c2 = claimNextTask('agent-2', { projectId });

    expect(c1?.id).toBe(a.id);
    expect(c2?.id).toBe(b.id);
    expect(c1?.id).not.toBe(c2?.id);
    expect(new Set([c1!.id, c2!.id])).toEqual(new Set([a.id, b.id]));

    // backlog drained → next claimer gets nothing
    expect(claimNextTask('agent-3', { projectId })).toBeNull();
  });

  it('returns null when no task is ready', () => {
    const projectId = createProject({ title: 'empty' }).id;
    expect(claimNextTask('agent-1', { projectId })).toBeNull();
  });

  it('respects dependency gating (will not claim a task whose deps are unmet)', () => {
    const projectId = createProject({ title: 'deps' }).id;
    const dep = createSubtask({ project_id: projectId, title: 'first', sort_order: 1 });
    const blocked = createSubtask({
      project_id: projectId,
      title: 'second',
      sort_order: 2,
      depends_on: [dep.id],
    });

    // only the dependency is claimable
    const c1 = claimNextTask('agent-1', { projectId });
    expect(c1?.id).toBe(dep.id);
    // blocked task still not claimable until dep is done
    expect(claimNextTask('agent-2', { projectId })).toBeNull();
    expect(getSubtask(blocked.id)?.status).toBe('todo');
  });
});
