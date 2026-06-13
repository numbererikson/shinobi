import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createProject } from './projects.js';
import {
  bulkCreateSubtasks,
  claimSubtask,
  completeSubtask,
  createSubtask,
  deleteSubtask,
  findDependents,
  getSubtask,
  listSubtasks,
  nextTask,
  searchSubtasks,
  updateSubtask,
} from './subtasks.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-subtasks-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function newProject(title = 'P'): number {
  return createProject({ title }).id;
}

describe('createSubtask', () => {
  it('applies defaults (todo, medium, sort 0, no deps)', () => {
    const p = newProject();
    const s = createSubtask({ project_id: p, title: 'task' });
    expect(s.status).toBe('todo');
    expect(s.priority).toBe('medium');
    expect(s.sort_order).toBe(0);
    expect(s.depends_on).toBeNull();
  });
});

describe('listSubtasks', () => {
  it('orders by priority desc, then sort_order asc', () => {
    const p = newProject();
    createSubtask({ project_id: p, title: 'low', priority: 'low', sort_order: 1 });
    const urgent = createSubtask({ project_id: p, title: 'urgent', priority: 'urgent', sort_order: 2 });
    const list = listSubtasks({ projectId: p });
    expect(list[0]!.id).toBe(urgent.id);
  });
});

describe('claim / complete', () => {
  it('claim sets in_progress + session + timestamp', () => {
    const p = newProject();
    const s = createSubtask({ project_id: p, title: 't' });
    const claimed = claimSubtask(s.id, 'sess-1');
    expect(claimed?.status).toBe('in_progress');
    expect(claimed?.claude_session_id).toBe('sess-1');
    expect(claimed?.last_claimed_at).not.toBeNull();
  });

  it('complete sets done', () => {
    const p = newProject();
    const s = createSubtask({ project_id: p, title: 't' });
    expect(completeSubtask(s.id)?.status).toBe('done');
  });
});

describe('nextTask dependency gating', () => {
  it('skips a higher-priority task with unmet deps, returns it once deps complete', () => {
    const p = newProject();
    const dep = createSubtask({ project_id: p, title: 'dep', priority: 'medium' });
    const dependent = createSubtask({
      project_id: p,
      title: 'dependent',
      priority: 'urgent',
      depends_on: [dep.id],
    });
    // dependent outranks dep on priority but is blocked → dep comes first
    expect(nextTask({ projectId: p })?.id).toBe(dep.id);
    completeSubtask(dep.id);
    expect(nextTask({ projectId: p })?.id).toBe(dependent.id);
  });

  it('returns null when no todo tasks remain', () => {
    const p = newProject();
    expect(nextTask({ projectId: p })).toBeNull();
  });
});

describe('updateSubtask', () => {
  it('rejects a circular dependency', () => {
    const p = newProject();
    const a = createSubtask({ project_id: p, title: 'a' });
    const b = createSubtask({ project_id: p, title: 'b', depends_on: [a.id] });
    expect(() => updateSubtask(a.id, { depends_on: [b.id] })).toThrow(/circular/i);
  });

  it('patches only provided fields', () => {
    const p = newProject();
    const s = createSubtask({ project_id: p, title: 'a' });
    const u = updateSubtask(s.id, { priority: 'high', status: 'in_progress' });
    expect(u?.priority).toBe('high');
    expect(u?.status).toBe('in_progress');
    expect(u?.title).toBe('a');
  });
});

describe('bulkCreateSubtasks', () => {
  it('creates many in one transaction', () => {
    const p = newProject();
    const created = bulkCreateSubtasks([
      { project_id: p, title: 'one' },
      { project_id: p, title: 'two' },
    ]);
    expect(created).toHaveLength(2);
    expect(listSubtasks({ projectId: p })).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(bulkCreateSubtasks([])).toEqual([]);
  });
});

describe('deleteSubtask', () => {
  it('deletes and reports success', () => {
    const p = newProject();
    const s = createSubtask({ project_id: p, title: 'gone' });
    expect(deleteSubtask(s.id)).toBe(true);
    expect(getSubtask(s.id)).toBeNull();
  });
});

describe('findDependents', () => {
  it('finds subtasks that depend on a given id', () => {
    const p = newProject();
    const dep = createSubtask({ project_id: p, title: 'dep' });
    const d1 = createSubtask({ project_id: p, title: 'd1', depends_on: [dep.id] });
    expect(findDependents(dep.id).map((d) => d.id)).toContain(d1.id);
  });
});

describe('searchSubtasks', () => {
  it('matches via FTS', () => {
    const p = newProject();
    createSubtask({ project_id: p, title: 'implement webhookhandler endpoint' });
    const res = searchSubtasks('webhookhandler', p);
    expect(res.some((s) => s.title.includes('webhookhandler'))).toBe(true);
  });
});
