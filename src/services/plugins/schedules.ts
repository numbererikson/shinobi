import { stderr } from 'node:process';
import { assertTimeZone, parseCron, type CronMatcher } from '../../lib/cron.js';
import { claimScheduleRun, finishScheduleRun, pruneScheduleRuns } from '../../models/plugin_schedule_runs.js';
import { isModuleEnabled } from '../modules.js';
import type { ShinobiApi } from './api.js';
import { withTimeout } from './invoke.js';
import { findPlugin } from './state.js';

/**
 * Plugin schedules (registry.schedule).
 *
 * Plugins load in every Shinobi process — each stdio MCP session and the
 * dashboard — so registration is cheap bookkeeping everywhere, but only the
 * long-lived dashboard process ticks (startPluginScheduler). Each due slot is
 * claimed in SQLite before it runs, so it fires at most once. A switched-off
 * module's schedules are skipped. Missed slots (host down) are not replayed;
 * jobs that must never miss work should compare stored due times to "now".
 */

export interface PluginScheduleDef {
  /** Unique within the plugin: lowercase letters, digits, `-`, `_`. */
  id: string;
  /** 5-field cron: minute hour day-of-month month day-of-week. */
  cron: string;
  /** IANA zone for the cron fields, e.g. 'Europe/Zagreb'. Defaults to the host zone. */
  timezone?: string;
  run: (api: ShinobiApi) => unknown | Promise<unknown>;
}

export interface ScheduleSummary {
  plugin: string;
  id: string;
  cron: string;
  timezone: string | null;
}

export interface ScheduleTickResult {
  plugin: string;
  id: string;
  status: 'ran' | 'failed';
  error: string | null;
}

const SCHEDULE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const RUN_TIMEOUT_MS = 50_000;
const RETENTION_DAYS = 7;

interface Entry {
  plugin: string;
  def: PluginScheduleDef;
  matcher: CronMatcher;
  api: ShinobiApi;
}

const schedules = new Map<string, Entry>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Validate a definition; returns its parsed cron. Throws with a plugin-scoped message. */
export function validateScheduleDef(pluginName: string, def: PluginScheduleDef): CronMatcher {
  if (!def || typeof def !== 'object') throw new Error(`plugin '${pluginName}': schedule definition must be an object`);
  if (typeof def.id !== 'string' || !SCHEDULE_ID.test(def.id)) {
    throw new Error(`plugin '${pluginName}': schedule id '${String(def.id)}' must match ${SCHEDULE_ID}`);
  }
  if (typeof def.run !== 'function') throw new Error(`plugin '${pluginName}': schedule '${def.id}' needs a run function`);
  if (typeof def.cron !== 'string') throw new Error(`plugin '${pluginName}': schedule '${def.id}' needs a cron string`);
  if (def.timezone !== undefined) assertTimeZone(def.timezone);
  return parseCron(def.cron);
}

export function registerPluginSchedule(pluginName: string, def: PluginScheduleDef, api: ShinobiApi): void {
  const matcher = validateScheduleDef(pluginName, def);
  const key = `${pluginName}\u0000${def.id}`;
  if (schedules.has(key)) throw new Error(`plugin '${pluginName}': duplicate schedule '${def.id}'`);
  schedules.set(key, { plugin: pluginName, def, matcher, api });
  findPlugin(pluginName)?.schedules_registered.push(def.id);
}

export function listPluginSchedules(): ScheduleSummary[] {
  return [...schedules.values()].map((e) => ({
    plugin: e.plugin,
    id: e.def.id,
    cron: e.matcher.expression,
    timezone: e.def.timezone ?? null,
  }));
}

export function resetPluginSchedules(): void {
  schedules.clear();
}

/** The UTC minute a date falls in, e.g. '2026-11-21T08:00' — the claim key. */
export function slotOf(date: Date): string {
  return date.toISOString().slice(0, 16);
}

/** Run every schedule due at `now` whose slot this process wins. */
export async function runDueSchedules(now: Date = new Date()): Promise<ScheduleTickResult[]> {
  const slot = slotOf(now);
  const due = [...schedules.values()].filter(
    (e) => isModuleEnabled(e.plugin) && e.matcher.matches(now, e.def.timezone) && claimScheduleRun(e.plugin, e.def.id, slot),
  );
  return Promise.all(
    due.map(async (e): Promise<ScheduleTickResult> => {
      let error: string | null = null;
      try {
        await withTimeout(Promise.resolve().then(() => e.def.run(e.api)), RUN_TIMEOUT_MS, `schedule '${e.def.id}'`);
      } catch (err) {
        error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        stderr.write(`plugin schedule: ${e.plugin}/${e.def.id} failed: ${error}\n`);
      }
      finishScheduleRun(e.plugin, e.def.id, slot, error);
      return { plugin: e.plugin, id: e.def.id, status: error === null ? 'ran' : 'failed', error };
    }),
  );
}

async function tick(): Promise<void> {
  const now = new Date();
  try {
    await runDueSchedules(now);
    if (now.getUTCMinutes() === 0) pruneScheduleRuns(RETENTION_DAYS);
  } catch (err) {
    stderr.write(`plugin scheduler: tick failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/** Fire a tick a moment after every minute boundary; re-aligned each time so it never drifts. */
function scheduleNext(): void {
  const delay = 60_000 - (Date.now() % 60_000) + 500;
  timer = setTimeout(() => {
    void tick().finally(() => {
      if (timer !== null) scheduleNext();
    });
  }, delay);
}

/** Start ticking. Called once by the long-lived dashboard process only. */
export function startPluginScheduler(): void {
  if (timer !== null) return;
  scheduleNext();
}

export function stopPluginScheduler(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
