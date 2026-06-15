// Circuit-breaker + backoff for the dispatch loop. A blocked task is handed
// back to the queue and is immediately the next ready task, so without these
// guards an unattended `dispatch`/`swarm` would re-claim and re-run the same
// blocked task in a tight loop, hammering the worker command. Pure functions so
// the policy is unit-testable without running the loop.

/** Default cap on consecutive blocked tasks before the loop halts. */
export const DEFAULT_MAX_FAILURES = 3;

/** Base backoff applied after a blocked task; escalates per consecutive block. */
export const BLOCKED_BACKOFF_MS = 2_000;

/**
 * Whether to halt after this many consecutive blocked tasks.
 * `maxFailures <= 0` means unlimited (explicit opt-out).
 */
export function shouldHaltOnBlocked(consecutiveBlocked: number, maxFailures: number): boolean {
  return maxFailures > 0 && consecutiveBlocked >= maxFailures;
}

/**
 * Backoff before retrying after a blocked task: linear escalation
 * (2s, 4s, 6s, …) capped at the poll interval so we never sleep longer than a
 * normal idle wait.
 */
export function blockedBackoffMs(consecutiveBlocked: number, intervalMs: number): number {
  const escalated = BLOCKED_BACKOFF_MS * Math.max(1, consecutiveBlocked);
  return Math.min(intervalMs, escalated);
}
