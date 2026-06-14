import { spawn } from 'node:child_process';
import type { Subtask } from '../../models/subtasks.js';
import type { Worker, WorkerResult } from './types.js';

/** Build the plain-text prompt a headless worker receives for a task. */
export function buildPrompt(task: Subtask): string {
  const parts = [`Work on Shinobi task #${task.id}: ${task.title}`];
  if (task.description) parts.push('', task.description);
  return parts.join('\n');
}

/**
 * Dry-run worker — never executes anything; logs what it would dispatch and
 * reports success. The default when no SHINOBI_WORKER_CMD is set, so `shinobi
 * dispatch` is safe to demo and exercise without Claude Code on the box.
 */
export function dryRunWorker(log: (msg: string) => void = () => undefined): Worker {
  return (task: Subtask): Promise<WorkerResult> => {
    log(`[dry-run] would dispatch task #${task.id}: ${task.title}`);
    return Promise.resolve({ ok: true, detail: 'dry-run (no SHINOBI_WORKER_CMD configured)' });
  };
}

/**
 * Command worker — spawns a shell command per task. The task is exposed to the
 * command via env vars (SHINOBI_TASK_ID / _TITLE / _PROMPT) rather than string
 * interpolation, so task text can never break out into the shell. Reference it
 * explicitly, e.g. SHINOBI_WORKER_CMD='claude -p "$SHINOBI_TASK_PROMPT"'.
 *
 * Exit code 0 → ok (task done); any non-zero / spawn error / timeout → blocked.
 */
export function spawnCommandWorker(template: string, timeoutMs = 30 * 60 * 1000): Worker {
  return (task: Subtask): Promise<WorkerResult> =>
    new Promise<WorkerResult>((resolve) => {
      const child = spawn(template, {
        shell: true,
        env: {
          ...process.env,
          SHINOBI_TASK_ID: String(task.id),
          SHINOBI_TASK_TITLE: task.title,
          SHINOBI_TASK_PROMPT: buildPrompt(task),
        },
      });

      let out = '';
      const capture = (buf: Buffer): void => {
        out += buf.toString();
        if (out.length > 4000) out = out.slice(-4000);
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ ok: false, detail: `worker timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);
      timer.unref?.();

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, detail: `worker spawn failed: ${err.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const tail = out.trim().slice(-300);
        resolve({ ok: code === 0, detail: tail || `exit ${code ?? 'null'}` });
      });
    });
}
