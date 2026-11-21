import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createProject, getProject, updateProject } from './projects.js';
import { bulkCreateSubtasks, claimSubtask, completeSubtask, createSubtask, deleteSubtask, updateSubtask } from './subtasks.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-autodone-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('project status follows its tasks', () => {
  it('closes when the last task is done and reopens when work appears again', () => {
    const p = createProject({ title: 'Auto done' });
    updateProject(p.id, { status: 'in_progress' });
    const [a, b] = bulkCreateSubtasks([
      { project_id: p.id, title: 'a' },
      { project_id: p.id, title: 'b' },
    ]);

    completeSubtask(a!.id);
    expect(getProject(p.id)?.status).toBe('in_progress');
    completeSubtask(b!.id);
    expect(getProject(p.id)?.status).toBe('done');

    // A new task reopens it…
    const c = createSubtask({ project_id: p.id, title: 'c' });
    expect(getProject(p.id)?.status).toBe('in_progress');
    // …finishing it via update closes it again…
    updateSubtask(c.id, { status: 'done' });
    expect(getProject(p.id)?.status).toBe('done');
    // …claiming a done task reopens, deleting the only open task closes.
    claimSubtask(c.id, 'sess');
    expect(getProject(p.id)?.status).toBe('in_progress');
    deleteSubtask(c.id);
    expect(getProject(p.id)?.status).toBe('done');
  });

  it('leaves projects without tasks alone', () => {
    const p = createProject({ title: 'No tasks' });
    expect(getProject(p.id)?.status).toBe('todo');
    const t = createSubtask({ project_id: p.id, title: 'only' });
    deleteSubtask(t.id);
    expect(getProject(p.id)?.status).toBe('todo');
  });

  it('moving a task between projects updates both', () => {
    const from = createProject({ title: 'From' });
    const to = createProject({ title: 'To' });
    const done = createSubtask({ project_id: from.id, title: 'done one', status: 'done' });
    const open = createSubtask({ project_id: from.id, title: 'open one' });
    createSubtask({ project_id: to.id, title: 'finished', status: 'done' });
    expect(getProject(to.id)?.status).toBe('done');
    updateSubtask(open.id, { project_id: to.id });
    expect(getProject(from.id)?.status).toBe('done');
    expect(getProject(to.id)?.status).toBe('in_progress');
    void done;
  });
});
