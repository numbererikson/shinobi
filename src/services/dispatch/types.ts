import type { Subtask } from '../../models/subtasks.js';

/** Result of a worker attempting one task. ok=false means the agent is blocked. */
export interface WorkerResult {
  ok: boolean;
  detail?: string;
}

/** Executes a single task. Resolves (never rejects) with a WorkerResult. */
export type Worker = (task: Subtask) => Promise<WorkerResult>;

export type DispatchOutcome = 'completed' | 'blocked' | 'idle';

export interface DispatchCycleResult {
  outcome: DispatchOutcome;
  task: Subtask | null;
  detail: string | null;
}

export interface NotifySignal {
  kind: 'task_completed' | 'blocked';
  task: Subtask;
  detail: string | null;
}

/** Side-channel that buzzes the operator. Injected so it can be stubbed in tests. */
export type DispatchNotifier = (signal: NotifySignal) => Promise<void>;
