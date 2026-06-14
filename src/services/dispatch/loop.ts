// One iteration of the dispatch loop: pull the next ready task, claim it, run a
// worker against it, then either complete it (+ "done" push) or hand it back to
// the queue and buzz the operator (blocked). Kept worker- and notifier-injected
// so the whole transition is unit-testable without spawning processes or sending
// real pushes. The long-running loop + sleep/relay-wake lives in the CLI command.

import { recordActivity } from '../../models/activity.js';
import {
  claimSubtask,
  completeSubtask,
  nextTask,
  updateSubtask,
} from '../../models/subtasks.js';
import { sendPushSafe } from '../push/web-push.js';
import type { DispatchCycleResult, DispatchNotifier, Worker, WorkerResult } from './types.js';

export interface RunCycleOptions {
  sessionId: string;
  worker: Worker;
  projectId?: number;
  /** Defaults to a best-effort web push. Pass a stub in tests. */
  notifier?: DispatchNotifier;
}

/** Default notifier: best-effort web push reusing the #523 primitives. */
export const defaultNotifier: DispatchNotifier = async ({ kind, task, detail }) => {
  const title = kind === 'task_completed' ? 'Shinobi: task done' : 'Shinobi: agent blocked';
  const raw = detail ? `${task.title} — ${detail}` : task.title;
  await sendPushSafe({
    title,
    body: raw.length > 160 ? raw.slice(0, 160) + '…' : raw,
    tag: kind === 'task_completed' ? `task-${task.id}` : 'notify-blocked',
    url: '/',
    data: { kind, subtask_id: task.id },
  });
};

export async function runDispatchCycle(opts: RunCycleOptions): Promise<DispatchCycleResult> {
  const { sessionId, worker, projectId } = opts;
  const notifier = opts.notifier ?? defaultNotifier;

  const task = nextTask(projectId !== undefined ? { projectId } : {});
  if (!task) return { outcome: 'idle', task: null, detail: null };

  claimSubtask(task.id, sessionId);
  recordActivity({
    project_id: task.project_id,
    session_id: sessionId,
    action_type: 'dispatch_claim',
    action_details: task.title,
    entity_type: 'subtask',
    entity_id: task.id,
  });

  let result: WorkerResult;
  try {
    result = await worker(task);
  } catch (err) {
    result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  const detail = result.detail ?? null;

  if (result.ok) {
    completeSubtask(task.id);
    recordActivity({
      project_id: task.project_id,
      session_id: sessionId,
      action_type: 'complete_task',
      action_details: detail ?? task.title,
      entity_type: 'subtask',
      entity_id: task.id,
    });
    await notifier({ kind: 'task_completed', task, detail });
    return { outcome: 'completed', task, detail };
  }

  // Blocked: hand the task back to the queue so it is not stuck in_progress, and
  // buzz the operator — a human decision is needed before it can move.
  updateSubtask(task.id, { status: 'todo' });
  recordActivity({
    project_id: task.project_id,
    session_id: sessionId,
    action_type: 'dispatch_blocked',
    action_details: detail ?? task.title,
    entity_type: 'subtask',
    entity_id: task.id,
  });
  await notifier({ kind: 'blocked', task, detail });
  return { outcome: 'blocked', task, detail };
}
