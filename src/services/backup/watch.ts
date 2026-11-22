// Nightly backup + backup alerts, owned by the long-lived dashboard process.
//
// - When `shinobi sync` is configured, the snapshot is pushed on
//   SHINOBI_BACKUP_CRON (default 03:17 in SHINOBI_TIMEZONE / the host zone).
//   Set it to `off` to rely on an external cron instead.
// - Every hour the last push is checked. A failed push, or no good push for
//   SHINOBI_BACKUP_MAX_AGE_HOURS (default 26), sends a push notification —
//   at most once a day while the problem lasts.

import { stderr } from 'node:process';
import { syncPush } from '../../commands/sync.js';
import { readEnvFile } from '../../dashboard/settings-store.js';
import { loadConfig, type ShinobiConfig } from '../../lib/config.js';
import { parseCron, type CronMatcher } from '../../lib/cron.js';
import { sendPushSafe } from '../push/web-push.js';

export const DEFAULT_BACKUP_CRON = '17 3 * * *';
const DEFAULT_MAX_AGE_HOURS = 26;
const TICK_MS = 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const REALERT_MS = 24 * 60 * 60 * 1000;

type SyncSection = NonNullable<ShinobiConfig['sync']>;

export interface BackupHealth {
  ok: boolean;
  /** Human-readable reason when not ok. */
  problem: string | null;
}

/** Pure health check, separated for tests. `sync` undefined = backups not set up (nothing to alert on). */
export function backupHealth(sync: SyncSection | undefined, now: Date, maxAgeHours = DEFAULT_MAX_AGE_HOURS): BackupHealth {
  if (!sync) return { ok: true, problem: null };
  const lastPush = sync.last_push_at ? Date.parse(sync.last_push_at) : NaN;
  const lastError = sync.last_error_at ? Date.parse(sync.last_error_at) : NaN;
  if (sync.last_error && (Number.isNaN(lastPush) || lastError >= lastPush)) {
    return { ok: false, problem: `Backup failed: ${sync.last_error}` };
  }
  if (Number.isNaN(lastPush)) return { ok: false, problem: 'No backup has been pushed yet.' };
  const ageHours = (now.getTime() - lastPush) / 3_600_000;
  if (ageHours > maxAgeHours) return { ok: false, problem: `No backup for ${Math.floor(ageHours)} hours.` };
  return { ok: true, problem: null };
}

function env(key: string): string | undefined {
  const v = readEnvFile().values[key] ?? process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

/** The cron to run backups on, or null when switched off / invalid. */
export function backupCron(raw: string | undefined): CronMatcher | null {
  const value = raw ?? DEFAULT_BACKUP_CRON;
  if (['off', 'false', '0', 'no'].includes(value.toLowerCase())) return null;
  try {
    return parseCron(value);
  } catch (err) {
    stderr.write(`backup: ignoring SHINOBI_BACKUP_CRON (${err instanceof Error ? err.message : String(err)})\n`);
    return null;
  }
}

let timer: NodeJS.Timeout | null = null;
let lastRunMinute = '';
let lastCheckAt = 0;
let lastAlertAt = 0;
let running = false;

async function alert(problem: string): Promise<void> {
  const now = Date.now();
  if (now - lastAlertAt < REALERT_MS) return;
  lastAlertAt = now;
  stderr.write(`backup: ${problem}\n`);
  await sendPushSafe({ title: 'Shinobi backup problem', body: problem.slice(0, 200), tag: 'shinobi-backup', url: '/' });
}

async function check(): Promise<void> {
  const maxAge = Number(env('SHINOBI_BACKUP_MAX_AGE_HOURS') ?? DEFAULT_MAX_AGE_HOURS);
  const health = backupHealth(loadConfig().sync, new Date(), Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_MAX_AGE_HOURS);
  if (health.ok) {
    lastAlertAt = 0; // a new problem later alerts straight away
    return;
  }
  await alert(health.problem ?? 'Backup problem');
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    if (loadConfig().sync) {
      const cron = backupCron(env('SHINOBI_BACKUP_CRON'));
      const minute = now.toISOString().slice(0, 16);
      if (cron && minute !== lastRunMinute && cron.matches(now, env('SHINOBI_TIMEZONE'))) {
        lastRunMinute = minute;
        try {
          await syncPush();
          stderr.write('backup: nightly push done\n');
        } catch (err) {
          // syncPush recorded the error; force the check below to alert now.
          lastCheckAt = 0;
          stderr.write(`backup: nightly push failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    }
    if (Date.now() - lastCheckAt >= CHECK_EVERY_MS) {
      lastCheckAt = Date.now();
      await check();
    }
  } catch (err) {
    stderr.write(`backup: tick failed: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    running = false;
  }
}

export function startBackupScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  // First health check a few minutes after boot, not during startup.
  lastCheckAt = Date.now() - CHECK_EVERY_MS + 5 * 60 * 1000;
}

export function stopBackupScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
