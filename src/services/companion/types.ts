/**
 * Rin — the companion layer. A face on the brain: she reads the same activity
 * spine everything else writes to, and reacts to the *actual* state of the
 * work. Deliberately not a compliment dispenser — a register is chosen by what
 * the numbers say, so praise means something when it comes.
 */

/** Tone of voice. Chosen by project state, never at random. */
export type Register =
  /** Neutral report: what happened, what's next. */
  | 'business'
  /** Earned encouragement — only on a real streak. */
  | 'cheer'
  /** Something is about to be repeated that already failed. */
  | 'caution'
  /** Dry, a little sharp. For the second identical failure. */
  | 'dry'
  /** Nagging about the thing you keep not doing. */
  | 'nag';

/** Which artwork slot to show. Maps to `<art-dir>/<pose>.webp`. */
export type Pose = 'idle' | 'talk' | 'celebrate' | 'warn' | 'think' | 'sleep';

export type Locale = 'en' | 'hr';

export interface ActivityEvent {
  id: number;
  action_type: string;
  project_id: number | null;
  entity_id: number | null;
  /** Free-text detail as recorded (often a completion summary). */
  detail: string | null;
  /** Subtask title, resolved at collection time — `detail` can be a paragraph. */
  title: string | null;
  created_at: string;
}

/** Everything the reactor is allowed to look at. Gathered once, then pure. */
export interface Signals {
  /** ISO timestamp — injectable so tests don't depend on the clock. */
  now: string;
  /** Unseen events, oldest first. */
  events: ActivityEvent[];
  next_task: { id: number; title: string } | null;
  pending_approvals: number;
  /** Hours since the last session_closeout; null when there has never been one. */
  hours_since_closeout: number | null;
}

export interface Reaction {
  register: Register;
  pose: Pose;
  /** The line she says. Already interpolated. */
  line: string;
  /** Optional second line — the "what's next" half. */
  detail: string | null;
  /** Which signal produced this, for the dashboard and for tests. */
  trigger: string;
  project_id: number | null;
  created_at: string;
}

export interface CompanionState {
  version: 1;
  /** Highest activity id already reacted to. */
  last_activity_id: number;
  /** Consecutive completions with no block in between. */
  completed_streak: number;
  /** subtask id → how many times it has come back blocked. */
  blocked_counts: Record<string, number>;
  /** Recently used line templates, so she doesn't repeat herself. */
  recent_lines: string[];
  /** Kept so the widget has something to show between events. */
  last_reaction: Reaction | null;
  updated_at: string | null;
}

export function emptyState(): CompanionState {
  return {
    version: 1,
    last_activity_id: 0,
    completed_streak: 0,
    blocked_counts: {},
    recent_lines: [],
    last_reaction: null,
    updated_at: null,
  };
}
