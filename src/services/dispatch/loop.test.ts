import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb } from '../../lib/db.js';
import { createProject } from '../../models/projects.js';
import { createSubtask, getSubtask } from '../../models/subtasks.js';
import { runDispatchCycle } from './loop.js';
import type { DispatchNotifier, NotifySignal, Worker } from './types.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-dispatch-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

function spyNotifier(): { fn: DispatchNotifier; calls: NotifySignal[] } {
  const calls: NotifySignal[] = [];
  const fn: DispatchNotifier = async (s) => {
    calls.push(s);
  };
  return { fn, calls };
}

const okWorker: Worker = async () => ({ ok: true, detail: 'did the thing' });
const blockedWorker: Worker = async () => ({ ok: false, detail: 'need a human' });
const throwingWorker: Worker = async () => {
  throw new Error('worker exploded');
};

describe('runDispatchCycle', () => {
  it('completes a task and fires a task_completed signal', async () => {
    const projectId = createProject({ title: 'Dispatch ok' }).id;
    const task = createSubtask({ project_id: projectId, title: 'do work' });
    const { fn, calls } = spyNotifier();

    const res = await runDispatchCycle({ sessionId: 'sess-d', worker: okWorker, projectId, notifier: fn });

    expect(res.outcome).toBe('completed');
    expect(res.task?.id).toBe(task.id);
    expect(getSubtask(task.id)?.status).toBe('done');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('task_completed');
    expect(calls[0]!.task.id).toBe(task.id);
  });

  it('hands a blocked task back to todo and fires a blocked signal', async () => {
    const projectId = createProject({ title: 'Dispatch blocked' }).id;
    const task = createSubtask({ project_id: projectId, title: 'hard one' });
    const { fn, calls } = spyNotifier();

    const res = await runDispatchCycle({ sessionId: 'sess-d', worker: blockedWorker, projectId, notifier: fn });

    expect(res.outcome).toBe('blocked');
    expect(getSubtask(task.id)?.status).toBe('todo');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('blocked');
    expect(res.detail).toBe('need a human');
  });

  it('treats a thrown worker as blocked (never rejects)', async () => {
    const projectId = createProject({ title: 'Dispatch throw' }).id;
    const task = createSubtask({ project_id: projectId, title: 'boom' });
    const { fn, calls } = spyNotifier();

    const res = await runDispatchCycle({ sessionId: 'sess-d', worker: throwingWorker, projectId, notifier: fn });

    expect(res.outcome).toBe('blocked');
    expect(res.detail).toBe('worker exploded');
    expect(getSubtask(task.id)?.status).toBe('todo');
    expect(calls[0]!.kind).toBe('blocked');
  });

  it('returns idle and never calls the worker or notifier when no task is ready', async () => {
    const projectId = createProject({ title: 'Dispatch empty' }).id;
    const { fn, calls } = spyNotifier();
    let ran = false;
    const tracerWorker: Worker = async () => {
      ran = true;
      return { ok: true };
    };

    const res = await runDispatchCycle({ sessionId: 'sess-d', worker: tracerWorker, projectId, notifier: fn });

    expect(res.outcome).toBe('idle');
    expect(res.task).toBeNull();
    expect(ran).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('drains tasks in priority/sort order across successive cycles', async () => {
    const projectId = createProject({ title: 'Dispatch drain' }).id;
    const first = createSubtask({ project_id: projectId, title: 'first', priority: 'high', sort_order: 1 });
    const second = createSubtask({ project_id: projectId, title: 'second', priority: 'low', sort_order: 2 });
    const { fn } = spyNotifier();

    const c1 = await runDispatchCycle({ sessionId: 'sess-d', worker: okWorker, projectId, notifier: fn });
    const c2 = await runDispatchCycle({ sessionId: 'sess-d', worker: okWorker, projectId, notifier: fn });
    const c3 = await runDispatchCycle({ sessionId: 'sess-d', worker: okWorker, projectId, notifier: fn });

    expect(c1.task?.id).toBe(first.id);
    expect(c2.task?.id).toBe(second.id);
    expect(c3.outcome).toBe('idle');
  });
});
