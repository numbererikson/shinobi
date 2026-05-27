// Auto-runs the weekly digest every Sunday at 18:00 local time when
// SHINOBI_DIGEST_AUTO=on. The dashboard process owns this loop — when
// the dashboard is stopped, scheduling is paused (intentional: the
// scheduler is best-effort and only useful while the dashboard is alive
// anyway, since Telegram delivery happens through outbound HTTP).

import { stderr } from 'node:process';
import { runDigest } from '../../commands/digest.js';
import { readEnvFile } from '../../dashboard/settings-store.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly tick

let timer: NodeJS.Timeout | null = null;
let lastRunIsoWeek: string | null = null;

function isDigestAutoEnabled(): boolean {
  const env = readEnvFile().values;
  const raw = (env['SHINOBI_DIGEST_AUTO'] ?? process.env['SHINOBI_DIGEST_AUTO'] ?? 'off').toLowerCase();
  return raw === 'on' || raw === 'true' || raw === '1';
}

function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

async function tick(): Promise<void> {
  if (!isDigestAutoEnabled()) return;
  const now = new Date();
  // Sunday is day 0 in JS getDay; we want Sunday 18:00 local.
  if (now.getDay() !== 0) return;
  if (now.getHours() !== 18) return;
  const week = isoWeekId(now);
  if (lastRunIsoWeek === week) return;
  lastRunIsoWeek = week;
  try {
    const env = readEnvFile().values;
    const wantTelegram = env['SHINOBI_TELEGRAM_BOT_TOKEN'] !== undefined && env['SHINOBI_TELEGRAM_BOT_TOKEN'].length > 0;
    await runDigest({ telegram: wantTelegram, quiet: true });
    stderr.write(`digest auto: week ${week} written${wantTelegram ? ' + telegram' : ''}\n`);
  } catch (err) {
    stderr.write(`digest auto: failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export function startDigestScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  // Run once at boot too, in case dashboard was started past Sunday 18:00.
  void tick();
}

export function stopDigestScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
