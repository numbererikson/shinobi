import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb } from '../../lib/db.js';
import { getBoolean, getNumber, getNumberArray, getObject, getString, getStringArray, requireNumber, requireString } from './args.js';
import { getTool, registerBuiltins } from './index.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-tools-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  // Keep recall/embedding on the local fulltext path: no provider probing.
  process.env.SHINOBI_EMBED_PROVIDER = 'none';
  applyPendingMigrations();
  registerBuiltins();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.SHINOBI_EMBED_PROVIDER;
});

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const tool = getTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return (await tool.handler(args)) as T;
}

describe('argument helpers', () => {
  it('validate types and required values', () => {
    expect(getString({ a: 'x' }, 'a')).toBe('x');
    expect(getString({ a: null }, 'a')).toBeUndefined();
    expect(() => getString({ a: 1 }, 'a')).toThrow(/must be a string/);
    expect(() => requireString({ a: '' }, 'a')).toThrow(/Missing required argument: a/);

    expect(getNumber({ n: 5 }, 'n')).toBe(5);
    expect(getNumber({ n: '7' }, 'n')).toBe(7);
    expect(() => getNumber({ n: 'seven' }, 'n')).toThrow(/must be a number/);
    expect(() => getNumber({ n: Number.NaN }, 'n')).toThrow(/must be a number/);
    expect(() => requireNumber({}, 'n')).toThrow(/Missing required argument: n/);

    expect(getBoolean({ b: true }, 'b')).toBe(true);
    expect(getBoolean({ b: 'false' }, 'b')).toBe(false);
    expect(() => getBoolean({ b: 'yes' }, 'b')).toThrow(/must be a boolean/);

    expect(getStringArray({ s: ['a', 'b'] }, 's')).toEqual(['a', 'b']);
    expect(() => getStringArray({ s: 'a' }, 's')).toThrow(/array of strings/);
    expect(() => getStringArray({ s: ['a', 1] }, 's')).toThrow(/strings only/);
    expect(getNumberArray({ n: [1, 2] }, 'n')).toEqual([1, 2]);
    expect(() => getNumberArray({ n: [1, '2'] }, 'n')).toThrow(/numbers only/);

    expect(getObject({ o: { k: 1 } }, 'o')).toEqual({ k: 1 });
    expect(() => getObject({ o: [] }, 'o')).toThrow(/must be an object/);
  });
});

describe('project tools', () => {
  it('create → update → archive → unarchive → delete, with validation errors', async () => {
    await expect(call('create_project', {})).rejects.toThrow(/Missing required argument: title/);
    const p = await call<{ id: number; status: string }>('create_project', { title: 'Tools test', priority: 'high' });
    expect(p.status).toBe('todo');

    const updated = await call<{ status: string }>('update_project', { project_id: p.id, status: 'in_progress' });
    expect(updated.status).toBe('in_progress');

    await call('archive_project', { project_id: p.id });
    const visible = await call<{ id: number }[]>('list_projects', {});
    expect(visible.some((x) => x.id === p.id)).toBe(false);
    const all = await call<{ id: number }[]>('list_projects', { include_archived: true });
    expect(all.some((x) => x.id === p.id)).toBe(true);
    await call('unarchive_project', { project_id: p.id });
    expect((await call<{ id: number }[]>('list_projects', {})).some((x) => x.id === p.id)).toBe(true);

    await call('delete_project', { project_id: p.id });
    expect(await call('get_project', { project_id: p.id })).toBeNull();
  });
});

describe('agent_bootstrap / session_closeout', () => {
  it('selects and claims the next task, flags a stale summary, and closeout refreshes it', async () => {
    const p = await call<{ id: number }>('create_project', { title: 'Workflow test' });
    const t1 = await call<{ id: number }>('create_task', { project_id: p.id, title: 'First task', priority: 'urgent' });
    await call('create_task', { project_id: p.id, title: 'Second task', priority: 'low' });

    const boot = await call<{ task: { id: number } | null; summary_stale: boolean; recent_summary: unknown }>('agent_bootstrap', { project_id: p.id });
    expect(boot.task?.id).toBe(t1.id);
    expect(boot.summary_stale).toBe(true);
    expect(boot.recent_summary).toBeNull();

    await expect(call('agent_bootstrap', { project_id: p.id, claim: true })).rejects.toThrow(/session_id is required/);
    const claimed = await call<{ task: { id: number; status: string } }>('agent_bootstrap', { project_id: p.id, claim: true, session_id: 'sess-1' });
    expect(claimed.task.status).toBe('in_progress');

    const other = await call<{ id: number }>('create_project', { title: 'Other project' });
    await expect(call('agent_bootstrap', { project_id: other.id, task_id: t1.id })).rejects.toThrow(/does not belong to project/);
    await expect(call('agent_bootstrap', { project_id: 999999 })).rejects.toThrow(/project not found/);

    const close = await call<{ summary_fallback_persisted: boolean; completed_tasks: { id: number; status: string }[]; next_tasks: { title: string }[] }>(
      'session_closeout',
      {
        project_id: p.id,
        session_id: 'sess-1',
        summary: 'Did the first task; second is next.',
        completed_task_ids: [t1.id],
        dead_ends: [{ attempted_approach: 'Polling the API every second', failure_reason: 'Rate limited after a minute' }],
        next_tasks: [{ title: 'Follow-up task' }],
      },
    );
    expect(close.summary_fallback_persisted).toBe(true);
    expect(close.completed_tasks.map((t) => t.status)).toEqual(['done']);
    expect(close.next_tasks.map((t) => t.title)).toEqual(['Follow-up task']);

    const after = await call<{ summary_stale: boolean; recent_summary: { md: string; provider: string } | null; task: { title: string } | null }>('agent_bootstrap', {
      project_id: p.id,
      query: 'poll the API every second',
    });
    expect(after.summary_stale).toBe(false);
    expect(after.recent_summary?.md).toBe('Did the first task; second is next.');
    expect(after.recent_summary?.provider).toBe('agent:closeout');
  });

  it('file_context returns annotations and refuses an empty file list', async () => {
    const p = await call<{ id: number }>('create_project', { title: 'File context test' });
    await call('update_context', { project_id: p.id, file_annotations: { 'src/lib/db.ts': 'singleton; never open a second connection' } });
    await expect(call('file_context', { project_id: p.id, files: [] })).rejects.toThrow(/at least one path/);
    const ctx = await call<{ file_context: { file: string; annotation: string | null }[] }>('file_context', { project_id: p.id, files: ['src/lib/db.ts', 'README.md'] });
    expect(ctx.file_context).toEqual([
      expect.objectContaining({ file: 'src/lib/db.ts', annotation: 'singleton; never open a second connection' }),
      expect.objectContaining({ file: 'README.md', annotation: null }),
    ]);
  });
});

describe('recall', () => {
  it('fulltext mode finds decisions, dead ends and notes across a project', async () => {
    const p = await call<{ id: number }>('create_project', { title: 'Recall test' });
    await call('log_decision', { project_id: p.id, summary: 'Use the walrus cache', rationale: 'Walrus is fast enough' });
    await call('log_dead_end', { project_id: p.id, attempted_approach: 'Walrus over UDP', failure_reason: 'Packets dropped' });
    await call('add_note', { project_id: p.id, body: 'The walrus cache needs warming on boot' });
    const r = await call<{ decisions: unknown[]; dead_ends: unknown[]; notes: unknown[] }>('recall', { query: 'walrus', project_id: p.id, mode: 'fulltext' });
    expect(r.decisions.length).toBe(1);
    expect(r.dead_ends.length).toBe(1);
    expect(r.notes.length).toBe(1);
    await expect(call('recall', {})).rejects.toThrow(/Missing required argument: query/);
  });
});
