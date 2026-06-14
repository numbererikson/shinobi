import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the push service so tests never attempt real delivery or VAPID bootstrap.
const { sendPushSafe, sendPushToAll } = vi.hoisted(() => ({
  sendPushSafe: vi.fn(),
  sendPushToAll: vi.fn(),
}));
vi.mock('../../services/push/web-push.js', () => ({ sendPushSafe, sendPushToAll }));

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb } from '../../lib/db.js';
import { listActivity } from '../../models/activity.js';
import { createProject } from '../../models/projects.js';
import { createSubtask } from '../../models/subtasks.js';
import { getTool, registerBuiltins } from './index.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-notify-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
  registerBuiltins();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  sendPushSafe.mockReset();
  sendPushSafe.mockResolvedValue({
    total: 2,
    succeeded: 2,
    failed: 0,
    pruned_endpoints: [],
    error: null,
  });
});

function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return Promise.resolve(tool.handler(args));
}

describe('notify tool', () => {
  it('sends a blocked-kind push with the default title and records activity', async () => {
    const projectId = createProject({ title: 'Notify test' }).id;
    const res = (await call('notify', {
      kind: 'blocked',
      body: 'Stuck on migration 0009 — need a human call',
      project_id: projectId,
      session_id: 'sess-notify',
    })) as { kind: string; delivered: { total_devices: number; succeeded: number; error: string | null } };

    expect(res.kind).toBe('blocked');
    expect(res.delivered.total_devices).toBe(2);
    expect(res.delivered.succeeded).toBe(2);
    expect(res.delivered.error).toBeNull();

    expect(sendPushSafe).toHaveBeenCalledTimes(1);
    const payload = sendPushSafe.mock.calls[0]![0] as { title: string; tag: string; data: { kind: string } };
    expect(payload.title).toBe('Shinobi: agent blocked');
    expect(payload.tag).toBe('notify-blocked');
    expect(payload.data.kind).toBe('blocked');

    const activity = listActivity({ actionType: 'notify', projectId });
    expect(activity).toHaveLength(1);
    expect(activity[0]!.action_details).toContain('[blocked]');
  });

  it('falls back to info kind, honours a custom title, and forwards url', async () => {
    const res = (await call('notify', {
      body: 'fyi',
      title: 'Custom heading',
      url: '/projects/58',
    })) as { kind: string };
    expect(res.kind).toBe('info');
    const payload = sendPushSafe.mock.calls[0]![0] as { title: string; url?: string; data: { url?: string } };
    expect(payload.title).toBe('Custom heading');
    expect(payload.url).toBe('/projects/58');
    expect(payload.data.url).toBe('/projects/58');
  });

  it('requires a body', async () => {
    await expect(call('notify', {})).rejects.toThrow(/body/);
  });
});

describe('complete_task notify flag', () => {
  it('does not push by default', async () => {
    const projectId = createProject({ title: 'Complete no-push' }).id;
    const task = createSubtask({ project_id: projectId, title: 'quiet finish' });
    const res = (await call('complete_task', { subtask_id: task.id })) as {
      completed: boolean;
      push?: unknown;
    };
    expect(res.completed).toBe(true);
    expect(res.push).toBeUndefined();
    expect(sendPushSafe).not.toHaveBeenCalled();
  });

  it('pushes a task-done notification when notify:true', async () => {
    const projectId = createProject({ title: 'Complete with push' }).id;
    const task = createSubtask({ project_id: projectId, title: 'shipped while you slept' });
    const res = (await call('complete_task', {
      subtask_id: task.id,
      summary: 'merged PR #42',
      notify: true,
    })) as { completed: boolean; push: { total_devices: number; error: string | null } };

    expect(res.completed).toBe(true);
    expect(res.push.total_devices).toBe(2);
    expect(res.push.error).toBeNull();

    expect(sendPushSafe).toHaveBeenCalledTimes(1);
    const payload = sendPushSafe.mock.calls[0]![0] as { title: string; body: string; tag: string; data: { kind: string; subtask_id: number } };
    expect(payload.title).toBe('Shinobi: task done');
    expect(payload.body).toBe('merged PR #42');
    expect(payload.tag).toBe(`task-${task.id}`);
    expect(payload.data.kind).toBe('task_completed');
    expect(payload.data.subtask_id).toBe(task.id);
  });
});
