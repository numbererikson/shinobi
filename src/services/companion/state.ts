import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { companionDir } from './config.js';
import { emptyState, type CompanionState } from './types.js';

/**
 * Companion state lives in its own JSON file rather than the `plugin_state`
 * table on purpose: it keeps this layer free of a migration dependency, so it
 * runs on any Shinobi that has the `activity` table — and it stays trivially
 * portable when the layer moves out into a real plugin.
 */
export function statePath(): string {
  return join(companionDir(), 'state.json');
}

function isState(value: unknown): value is CompanionState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CompanionState>;
  return (
    candidate.version === 1 &&
    typeof candidate.last_activity_id === 'number' &&
    typeof candidate.completed_streak === 'number'
  );
}

/** Never throws: a corrupt or hand-edited file resets rather than breaking the dashboard. */
export function readState(): CompanionState {
  const path = statePath();
  if (!existsSync(path)) return emptyState();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isState(parsed)) return emptyState();
    return {
      ...emptyState(),
      ...parsed,
      blocked_counts: parsed.blocked_counts ?? {},
      recent_lines: parsed.recent_lines ?? [],
    };
  } catch {
    return emptyState();
  }
}

/** Write-then-rename so a crash mid-write cannot leave a truncated file behind. */
export function writeState(state: CompanionState): void {
  const path = statePath();
  mkdirSync(companionDir(), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}
