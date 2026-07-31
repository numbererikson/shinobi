import { listActivity } from '../../models/activity.js';
import { listApprovals } from '../../models/approvals.js';
import { getSubtask, nextTask } from '../../models/subtasks.js';
import type { ActivityEvent, CompanionState, Signals } from './types.js';

/**
 * The only part of the companion that touches the database. Everything it
 * gathers is read-only and already exposed by the models — she is a reader of
 * the spine, never a second writer to it.
 */

/** How far back to look for unseen events on a single poll. */
const ACTIVITY_WINDOW = 200;

const MS_PER_HOUR = 3_600_000;

function toEvent(row: {
  id: number;
  action_type: string;
  project_id: number | null;
  entity_id: number | null;
  entity_type: string | null;
  action_details: string | null;
  created_at: string;
}): ActivityEvent {
  const title =
    row.entity_type === 'subtask' && row.entity_id !== null
      ? (getSubtask(row.entity_id)?.title ?? null)
      : null;
  return {
    id: row.id,
    action_type: row.action_type,
    project_id: row.project_id,
    entity_id: row.entity_id,
    detail: row.action_details,
    title,
    created_at: row.created_at,
  };
}

/**
 * SQLite stores timestamps as UTC 'YYYY-MM-DD HH:MM:SS' with no zone marker,
 * which `new Date()` would read as local time. Normalizing here keeps the
 * "hours since closeout" nag from being hours off.
 */
function parseSqliteUtc(value: string): number {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export interface CollectOptions {
  /** Injectable clock, for tests and for the smoke harness. */
  now?: Date;
}

export function collectSignals(state: CompanionState, options: CollectOptions = {}): Signals {
  const now = options.now ?? new Date();
  const recent = listActivity({ limit: ACTIVITY_WINDOW });

  const unseen = recent
    .filter((row) => row.id > state.last_activity_id)
    .sort((a, b) => a.id - b.id)
    .map(toEvent);

  const lastCloseout = listActivity({ actionType: 'session_closeout', limit: 1 })[0];
  // With no closeout on record, measure from the oldest activity still in the
  // window — a brand-new brain should not be nagged about a session it never had.
  const baseline = lastCloseout ?? recent[recent.length - 1];
  const hoursSinceCloseout =
    recent.length === 0 || !baseline
      ? null
      : (now.getTime() - parseSqliteUtc(baseline.created_at)) / MS_PER_HOUR;

  const ready = nextTask();

  return {
    now: now.toISOString(),
    events: unseen,
    next_task: ready ? { id: ready.id, title: ready.title } : null,
    pending_approvals: listApprovals({ status: 'pending', limit: 50 }).length,
    hours_since_closeout: hoursSinceCloseout,
  };
}
