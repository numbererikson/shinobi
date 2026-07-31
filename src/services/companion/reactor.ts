import { catalogFor, interpolate, pickVariant, type LineSet } from './lines.js';
import type { ActivityEvent, CompanionState, Locale, Pose, Reaction, Register, Signals } from './types.js';

/**
 * The reactor is pure: signals in, reaction + next state out. No DB, no clock,
 * no randomness it did not receive. That is what makes her testable, and it is
 * also what keeps the whole layer extractable into a plugin later.
 */

export interface ReactorOptions {
  locale?: Locale;
  /** Injectable for deterministic tests. */
  random?: () => number;
  /** Hours of activity without a closeout before she starts nagging. */
  staleSessionHours?: number;
  /** Completions in a row before the cheer register unlocks. */
  streakThreshold?: number;
  /** How many recent lines to remember when avoiding repeats. */
  recentLineMemory?: number;
}

export interface ReactorResult {
  reaction: Reaction | null;
  state: CompanionState;
}

const POSE_BY_REGISTER: Record<Register, Pose> = {
  business: 'talk',
  cheer: 'celebrate',
  caution: 'warn',
  dry: 'think',
  nag: 'warn',
};

/** action_type → catalog key, for the events that map one-to-one. */
const SIMPLE_TRIGGERS: Record<string, string> = {
  log_decision: 'decision',
  save_plan: 'plan',
  create_task: 'task_created',
  ingest_findings: 'findings',
  log_dead_end: 'dead_end',
};

interface Candidate {
  trigger: string;
  vars: Record<string, string | number>;
  project_id: number | null;
}

function taskLabel(event: ActivityEvent): string {
  const title = event.title?.trim();
  if (title) return title;
  const detail = event.detail?.trim();
  if (detail && detail.length <= 60) return detail;
  return `#${event.entity_id ?? '?'}`;
}

/**
 * Fold new events into the running state. The streak is the point: it only
 * survives an unbroken run of completions, so the cheer register cannot fire
 * on a day that is actually going badly.
 */
function advanceState(state: CompanionState, events: ActivityEvent[]): CompanionState {
  const next: CompanionState = {
    ...state,
    blocked_counts: { ...state.blocked_counts },
    recent_lines: [...state.recent_lines],
  };
  for (const event of events) {
    next.last_activity_id = Math.max(next.last_activity_id, event.id);
    if (event.action_type === 'complete_task') {
      next.completed_streak += 1;
    } else if (event.action_type === 'dispatch_blocked') {
      next.completed_streak = 0;
      const key = String(event.entity_id ?? 'unknown');
      next.blocked_counts[key] = (next.blocked_counts[key] ?? 0) + 1;
    }
  }
  return next;
}

/**
 * Pick what she reacts to, highest priority first. Trouble outranks progress:
 * a block in the same batch as three completions gets the block, because that
 * is the thing the operator needs to hear.
 */
function chooseCandidate(
  signals: Signals,
  state: CompanionState,
  options: Required<Pick<ReactorOptions, 'staleSessionHours' | 'streakThreshold'>>,
): Candidate | null {
  const events = signals.events;
  const lastBlocked = [...events].reverse().find((e) => e.action_type === 'dispatch_blocked');
  if (lastBlocked) {
    const count = state.blocked_counts[String(lastBlocked.entity_id ?? 'unknown')] ?? 1;
    return {
      trigger: count >= 2 ? 'blocked_repeat' : 'blocked',
      vars: { task: taskLabel(lastBlocked), count },
      project_id: lastBlocked.project_id,
    };
  }

  const deadEnd = [...events].reverse().find((e) => e.action_type === 'log_dead_end');
  if (deadEnd) {
    return { trigger: 'dead_end', vars: {}, project_id: deadEnd.project_id };
  }

  const lastCompleted = [...events].reverse().find((e) => e.action_type === 'complete_task');
  if (lastCompleted) {
    const streak = state.completed_streak;
    const trigger = streak >= options.streakThreshold ? 'streak' : 'task_completed';
    return {
      trigger,
      vars: { task: taskLabel(lastCompleted), n: streak },
      project_id: lastCompleted.project_id,
    };
  }

  for (const event of [...events].reverse()) {
    const trigger = SIMPLE_TRIGGERS[event.action_type];
    if (trigger) {
      return { trigger, vars: {}, project_id: event.project_id };
    }
  }

  // Ambient nudges — only when nothing happened, so they never talk over work.
  if (signals.pending_approvals > 0) {
    return {
      trigger: 'approvals',
      vars: { count: signals.pending_approvals },
      project_id: null,
    };
  }

  if (
    signals.hours_since_closeout !== null &&
    signals.hours_since_closeout >= options.staleSessionHours
  ) {
    return {
      trigger: 'stale_session',
      vars: { hours: Math.floor(signals.hours_since_closeout) },
      project_id: null,
    };
  }

  return null;
}

export function react(
  signals: Signals,
  state: CompanionState,
  options: ReactorOptions = {},
): ReactorResult {
  const locale = options.locale ?? 'en';
  const random = options.random ?? Math.random;
  const staleSessionHours = options.staleSessionHours ?? 3;
  const streakThreshold = options.streakThreshold ?? 3;
  const recentLineMemory = options.recentLineMemory ?? 8;

  const advanced = advanceState(state, signals.events);
  const candidate = chooseCandidate(signals, advanced, { staleSessionHours, streakThreshold });

  if (!candidate) {
    return {
      reaction: null,
      state: { ...advanced, updated_at: signals.now },
    };
  }

  const catalog = catalogFor(locale);
  const set: LineSet | undefined = catalog[candidate.trigger];
  if (!set) {
    return { reaction: null, state: { ...advanced, updated_at: signals.now } };
  }

  const template = pickVariant(set.lines, advanced.recent_lines, random);
  const vars = { ...candidate.vars, next: signals.next_task?.title ?? '' };
  const line = interpolate(template, vars);

  // The "what's next" half is dropped rather than rendered empty when the
  // queue has nothing ready — a dangling "Next up: ." reads like a bug.
  let detail: string | null = null;
  if (set.details && set.details.length > 0 && signals.next_task) {
    detail = interpolate(pickVariant(set.details, advanced.recent_lines, random), vars);
  }

  const recent = [template, ...advanced.recent_lines].slice(0, recentLineMemory);

  const reaction: Reaction = {
    register: set.register,
    pose: POSE_BY_REGISTER[set.register],
    line,
    detail,
    trigger: candidate.trigger,
    project_id: candidate.project_id,
    created_at: signals.now,
  };

  return {
    reaction,
    state: { ...advanced, recent_lines: recent, last_reaction: reaction, updated_at: signals.now },
  };
}
