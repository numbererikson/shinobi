import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { freemem, loadavg, totalmem, uptime as hostUptime } from 'node:os';
import { join } from 'node:path';

import { configDir, loadConfig } from '../../lib/config.js';
import { getPackageVersion } from '../../lib/version.js';
import { listProjects } from '../../models/projects.js';
import { listSubscriptions } from '../../models/push_subscriptions.js';
import { backupHealth } from '../../services/backup/watch.js';
import { DEVELOPMENT, isModuleEnabled } from '../../services/modules.js';
import { listLoadedPlugins } from '../../services/plugins/state.js';
import type { ShinobiTool } from './types.js';

const DAY_MS = 86_400_000;
const DISK_BACKUP_MAX_AGE_H = 26;
const STALE_PROJECT_DAYS = 5;
/** Past this, a project is parked rather than stalled: not worth a daily nudge. */
const DORMANT_PROJECT_DAYS = 30;
const LOW_DISK_PCT = 90;

interface DiskBackupStatus {
  at?: string;
  ok?: boolean;
  message?: string;
}

/**
 * Result of an external backup job (e.g. the nightly USB-disk script), written
 * by the host to <config dir>/status/disk-backup.json. Missing = not set up.
 */
export function readDiskBackupStatus(dir: string = configDir()): DiskBackupStatus | null {
  const path = join(dir, 'status', 'disk-backup.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as DiskBackupStatus;
  } catch {
    return { ok: false, message: 'status file is not valid JSON' };
  }
}

const round = (n: number, digits = 1) => Number(n.toFixed(digits));

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → epoch ms. */
function parseTime(s: string): number {
  return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

export function systemStatus(now = new Date()): Record<string, unknown> {
  const problems: string[] = [];

  // ---- server ----
  let dataDisk: Record<string, number> | null = null;
  try {
    const fs = statfsSync(configDir());
    const total = fs.blocks * fs.bsize;
    const free = fs.bavail * fs.bsize;
    const usedPct = total > 0 ? round(((total - free) / total) * 100, 0) : 0;
    dataDisk = { free_gb: round(free / 1e9), total_gb: round(total / 1e9), used_pct: usedPct };
    if (usedPct >= LOW_DISK_PCT) problems.push(`Server disk is ${usedPct}% full.`);
  } catch {
    /* statfs unsupported: leave null */
  }
  const server = {
    version: getPackageVersion(),
    shinobi_uptime_hours: round(process.uptime() / 3600),
    host_uptime_hours: round(hostUptime() / 3600),
    load_avg: loadavg().map((l) => round(l, 2)),
    memory: { free_mb: Math.round(freemem() / 1e6), total_mb: Math.round(totalmem() / 1e6) },
    data_disk: dataDisk,
  };
  if (hostUptime() < 24 * 3600) problems.push(`The server restarted ${round(hostUptime() / 3600)} hours ago.`);

  // ---- backups ----
  const sync = loadConfig().sync;
  const gh = backupHealth(sync, now);
  if (!gh.ok && gh.problem) problems.push(`GitHub backup: ${gh.problem}`);
  const github = sync
    ? { configured: true, ok: gh.ok, problem: gh.problem, last_push_at: sync.last_push_at ?? null, last_error: sync.last_error ?? null }
    : { configured: false };

  const diskStatus = readDiskBackupStatus();
  let disk: Record<string, unknown> = { configured: false };
  if (diskStatus) {
    const at = diskStatus.at ? Date.parse(diskStatus.at) : NaN;
    const ageH = Number.isNaN(at) ? null : round((now.getTime() - at) / 3_600_000);
    const stale = ageH === null || ageH > DISK_BACKUP_MAX_AGE_H;
    const ok = diskStatus.ok === true && !stale;
    disk = { configured: true, ok, last_run_at: diskStatus.at ?? null, hours_ago: ageH, message: diskStatus.message ?? null };
    if (diskStatus.ok !== true) problems.push(`Disk backup failed: ${diskStatus.message ?? 'unknown error'}`);
    else if (stale) problems.push(`Disk backup has not run for ${ageH ?? '?'} hours.`);
  }

  // ---- plugins + push ----
  const plugins = listLoadedPlugins().map((p) => ({ name: p.name, ok: p.error === null, error: p.error }));
  for (const p of plugins) if (!p.ok) problems.push(`Plugin ${p.name} failed to load: ${p.error}`);
  const subs = listSubscriptions();
  const push = { devices: subs.length, failing_devices: subs.filter((s) => s.last_error !== null).length };
  if (subs.length === 0) problems.push('No device is subscribed to push notifications.');

  // ---- projects (only when Development is on) ----
  let projects: Record<string, unknown>[] | null = null;
  if (isModuleEnabled(DEVELOPMENT)) {
    projects = listProjects({ sort: 'active' })
      .filter((p) => p.status !== 'done')
      .map((p) => {
        // Latest sign of life: the row itself, its activity log, or a session closeout.
        const row = p as typeof p & { last_active?: string | null; recent_summary_at?: string | null };
        const last = Math.max(
          ...[p.updated_at, row.last_active, row.recent_summary_at].filter((t): t is string => !!t).map(parseTime).filter((t) => !Number.isNaN(t)),
        );
        const days = Math.floor((now.getTime() - last) / DAY_MS);
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          progress: `${p.subtasks_done}/${p.subtasks_total}`,
          days_since_activity: days,
          stalled: p.status === 'in_progress' && days >= STALE_PROJECT_DAYS && days < DORMANT_PROJECT_DAYS,
          dormant: days >= DORMANT_PROJECT_DAYS,
        };
      })
      .sort((a, b) => a.days_since_activity - b.days_since_activity)
      .slice(0, 15);
  }

  return { now: now.toISOString(), ok: problems.length === 0, problems, server, backups: { github, disk }, plugins, push, projects };
}

export const systemTools: ShinobiTool[] = [
  {
    name: 'system_status',
    description:
      'Health report of the Shinobi server for a daily brief or a quick check: version, uptime, load, memory, free disk, ' +
      'GitHub and disk backup status, plugin load errors, push devices and (when Development is on) open projects (stalled = in progress, 5–30 days quiet; dormant = 30+ days). ' +
      '`problems` lists everything that needs attention in plain sentences; empty means all is well. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => systemStatus(),
  },
];
