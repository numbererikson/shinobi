// `shinobi dispatch` — the autonomous dispatch loop. Drains the task queue by
// pulling the next ready task, running a worker against it, and completing or
// un-blocking it, then idles until a new task appears (relay wake + poll). This
// is the "works while I sleep" engine: the worker is your headless agent
// (e.g. claude -p) and the operator's phone is the control surface.

import { hostname } from 'node:os';
import { stdout, stderr } from 'node:process';
import { runDispatchCycle } from '../services/dispatch/loop.js';
import { dryRunWorker, spawnCommandWorker } from '../services/dispatch/worker.js';
import type { Worker } from '../services/dispatch/types.js';
import { getRelayClient } from '../services/relay/client.js';

export interface DispatchOptions {
  projectId?: number;
  once?: boolean;
  /** Drain the ready backlog then exit, instead of idling for new tasks. */
  drain?: boolean;
  intervalMs?: number;
  maxFailures?: number;
  workerCmd?: string;
}

const DEFAULT_INTERVAL_MS = 30_000;

function log(msg: string): void {
  stdout.write(`[dispatch ${new Date().toISOString()}] ${msg}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

export async function runDispatch(opts: DispatchOptions): Promise<void> {
  const sessionId = `dispatch-${hostname()}-${Date.now().toString(36)}`;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const worker: Worker = opts.workerCmd
    ? spawnCommandWorker(opts.workerCmd)
    : dryRunWorker((m) => stderr.write(m + '\n'));

  log(
    `starting session=${sessionId} worker=${opts.workerCmd ? 'command' : 'dry-run'}` +
      `${opts.projectId !== undefined ? ` project=${opts.projectId}` : ''}` +
      `${opts.once ? ' (once)' : opts.drain ? ' (drain)' : ` interval=${Math.round(intervalMs / 1000)}s`}`,
  );

  // Relay wake: any peer event (notably sync-available, which auto-pulls a fresh
  // DB snapshot) cuts the idle sleep short so a task added from another device is
  // picked up promptly instead of waiting out the full poll interval.
  let woken = false;
  const relay = getRelayClient();
  relay.start();
  const offRelay = relay.onEvent(() => {
    woken = true;
  });

  let stopping = false;
  const onSignal = (): void => {
    if (stopping) return;
    stopping = true;
    log('shutdown signal received — finishing current cycle then exiting');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let consecutiveBlocked = 0;
  try {
    while (!stopping) {
      const res = await runDispatchCycle({
        sessionId,
        worker,
        ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
      });

      if (res.outcome === 'completed') {
        consecutiveBlocked = 0;
        log(`completed #${res.task?.id} "${res.task?.title}"`);
      } else if (res.outcome === 'blocked') {
        consecutiveBlocked += 1;
        log(`blocked #${res.task?.id} "${res.task?.title}"${res.detail ? ` — ${res.detail}` : ''}`);
        if (opts.maxFailures && consecutiveBlocked >= opts.maxFailures) {
          log(`halting — ${consecutiveBlocked} consecutive blocked tasks (>= max-failures ${opts.maxFailures})`);
          break;
        }
      } else {
        // idle — no ready task
        if (opts.once) {
          log('idle — no ready task (once)');
          break;
        }
        if (opts.drain) {
          log('idle — backlog drained, exiting');
          break;
        }
        log(`idle — waiting up to ${Math.round(intervalMs / 1000)}s for a new task`);
        woken = false;
        const step = 500;
        let waited = 0;
        while (waited < intervalMs && !woken && !stopping) {
          await delay(Math.min(step, intervalMs - waited));
          waited += step;
        }
        continue;
      }

      if (opts.once) break;
    }
  } finally {
    offRelay();
    relay.stop();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    log('stopped');
  }
}
