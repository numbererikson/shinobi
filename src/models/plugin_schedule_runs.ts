import { getDb } from '../lib/db.js';

/**
 * Bookkeeping for plugin schedules. A row is the claim that a schedule's
 * minute slot has fired; the primary key makes the claim at-most-once.
 */

/** Claim a slot. Returns false when it was already claimed (by any process). */
export function claimScheduleRun(plugin: string, scheduleId: string, slot: string): boolean {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO plugin_schedule_runs (plugin, schedule_id, slot, started_at)
         VALUES (?, ?, ?, datetime('now'))`,
    )
    .run(plugin, scheduleId, slot);
  return info.changes === 1;
}

export function finishScheduleRun(plugin: string, scheduleId: string, slot: string, error: string | null): void {
  getDb()
    .prepare(
      `UPDATE plugin_schedule_runs SET finished_at = datetime('now'), error = ?
        WHERE plugin = ? AND schedule_id = ? AND slot = ?`,
    )
    .run(error, plugin, scheduleId, slot);
}

/** Delete claims older than `days`. Returns the number of rows removed. */
export function pruneScheduleRuns(days: number): number {
  return getDb()
    .prepare(`DELETE FROM plugin_schedule_runs WHERE started_at < datetime('now', ?)`)
    .run(`-${days} days`).changes;
}
