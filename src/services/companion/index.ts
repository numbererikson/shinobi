import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { companionConfig } from './config.js';
import { react } from './reactor.js';
import { collectSignals } from './signals.js';
import { readState, writeState } from './state.js';
import type { Locale, Pose, Register } from './types.js';

export { companionConfig, companionDir } from './config.js';
export { react } from './reactor.js';
export { collectSignals } from './signals.js';
export { readState, statePath, writeState } from './state.js';
export type { CompanionState, Pose, Reaction, Register, Signals } from './types.js';

export const POSES: Pose[] = ['idle', 'talk', 'celebrate', 'warn', 'think', 'sleep'];

/** Accepted artwork extensions, in preference order. */
const ART_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

/** After this long with nothing happening she settles back to the idle pose. */
const IDLE_AFTER_MINUTES = 10;
/** And after this long, to sleep — a dark widget is a quiet one. */
const SLEEP_AFTER_MINUTES = 90;

export interface CompanionSnapshot {
  enabled: boolean;
  name: string;
  locale: Locale;
  pose: Pose;
  register: Register | null;
  line: string | null;
  detail: string | null;
  trigger: string | null;
  project_id: number | null;
  /** When the currently shown line was produced. */
  said_at: string | null;
  /** True when this poll produced a new line (the widget can animate on it). */
  fresh: boolean;
  /** Poses that have artwork on disk; the rest fall back to the placeholder. */
  available_art: Pose[];
}

/** Absolute path of the artwork for a pose, or null when none is installed. */
export function artPath(pose: Pose): string | null {
  const { artDir } = companionConfig();
  for (const ext of ART_EXTENSIONS) {
    const candidate = join(artDir, `${pose}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function availableArt(): Pose[] {
  return POSES.filter((pose) => artPath(pose) !== null);
}

function minutesSince(iso: string, now: Date): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - parsed) / 60_000;
}

export interface SnapshotOptions {
  now?: Date;
}

/** A snapshot with nothing to say — used when disabled and on the first poll. */
function quiet(
  enabled: boolean,
  name: string,
  locale: Locale,
  pose: Pose,
  available_art: Pose[],
): CompanionSnapshot {
  return {
    enabled,
    name,
    locale,
    pose,
    register: null,
    line: null,
    detail: null,
    trigger: null,
    project_id: null,
    said_at: null,
    fresh: false,
    available_art,
  };
}

/**
 * One poll of the companion: read the spine, decide whether there is anything
 * worth saying, persist what she learned, and hand the widget a view model.
 *
 * State is only written when something actually changed, so an idle dashboard
 * left open all day does not rewrite the file every few seconds.
 */
export function companionSnapshot(options: SnapshotOptions = {}): CompanionSnapshot {
  const config = companionConfig();
  const now = options.now ?? new Date();

  if (!config.enabled) {
    return quiet(false, config.name, config.locale, 'sleep', []);
  }

  const previous = readState();
  const signals = collectSignals(previous, { now });

  // First run against an existing brain: adopt the current watermark instead of
  // announcing a task that was closed three weeks ago.
  const newest = signals.events[signals.events.length - 1];
  if (previous.last_activity_id === 0 && newest) {
    writeState({ ...previous, last_activity_id: newest.id, updated_at: signals.now });
    return quiet(true, config.name, config.locale, 'idle', availableArt());
  }

  const { reaction, state } = react(signals, previous, { locale: config.locale });

  if (reaction || state.last_activity_id !== previous.last_activity_id) {
    writeState(state);
  }

  const shown = reaction ?? state.last_reaction;
  let pose: Pose = shown?.pose ?? 'idle';
  if (!reaction && shown) {
    const idleFor = minutesSince(shown.created_at, now);
    if (idleFor >= SLEEP_AFTER_MINUTES) pose = 'sleep';
    else if (idleFor >= IDLE_AFTER_MINUTES) pose = 'idle';
  }

  return {
    enabled: true,
    name: config.name,
    locale: config.locale,
    pose,
    register: shown?.register ?? null,
    line: shown?.line ?? null,
    detail: shown?.detail ?? null,
    trigger: shown?.trigger ?? null,
    project_id: shown?.project_id ?? null,
    said_at: shown?.created_at ?? null,
    fresh: reaction !== null,
    available_art: availableArt(),
  };
}
