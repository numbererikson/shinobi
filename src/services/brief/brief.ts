// Morning brief: one push a day with what needs attention.
//
// Core lines come from system_status (problems, backups, stalled projects);
// each plugin may add its own short section (registry.brief), e.g. today's
// reminders. A switched-off module drops out of the brief with it. The
// dashboard process sends it on SHINOBI_BRIEF_CRON (default 07:45 in
// SHINOBI_TIMEZONE / the host zone); `off` disables it.

import { stderr } from 'node:process';
import { readEnvFile } from '../../dashboard/settings-store.js';
import { parseCron, type CronMatcher } from '../../lib/cron.js';
import { systemStatus } from '../../server/tools/system.js';
import { isModuleEnabled, moduleDisplayName } from '../modules.js';
import type { ShinobiApi } from '../plugins/api.js';
import { withTimeout } from '../plugins/invoke.js';
import { sendPushSafe, type SafePushResult } from '../push/web-push.js';

export const DEFAULT_BRIEF_CRON = '45 7 * * *';
const SECTION_ID = /^[a-z][a-z0-9_-]{0,39}$/;
const SECTION_TIMEOUT_MS = 5_000;
const MAX_LINES_PER_SECTION = 6;
const MAX_LINE = 200;
const MAX_BODY = 1500;

export interface BriefSectionDef {
  /** Unique within the plugin: lowercase letters, digits, `-`, `_`. */
  id: string;
  /** Sort key among plugin sections (lower first, default 100). */
  order?: number;
  /**
   * Plain text for the brief: a string (newlines allowed) or an array of
   * lines. Return null or an empty value to stay out of today's brief.
   */
  render: (api: ShinobiApi) => unknown | Promise<unknown>;
}

interface Section {
  plugin: string;
  def: BriefSectionDef;
  api: ShinobiApi;
}

const sections = new Map<string, Section>();

export function validateBriefSection(plugin: string, def: BriefSectionDef): void {
  if (!def || typeof def !== 'object') throw new Error(`plugin '${plugin}': brief section must be an object`);
  if (typeof def.id !== 'string' || !SECTION_ID.test(def.id)) {
    throw new Error(`plugin '${plugin}': brief section id must match ${SECTION_ID}`);
  }
  if (typeof def.render !== 'function') throw new Error(`plugin '${plugin}': brief section '${def.id}' needs a render function`);
}

export function registerBriefSection(plugin: string, def: BriefSectionDef, api: ShinobiApi): void {
  validateBriefSection(plugin, def);
  const key = `${plugin}:${def.id}`;
  if (sections.has(key)) throw new Error(`plugin '${plugin}': duplicate brief section '${def.id}'`);
  sections.set(key, { plugin, def, api });
}

export function resetBriefSections(): void {
  sections.clear();
}

/** Whatever a section returned → at most a few short plain-text lines. */
export function sectionLines(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.split('\n') : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return raw
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES_PER_SECTION)
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE - 1)}…` : l));
}

export interface Brief {
  title: string;
  body: string;
  ok: boolean;
}

type Status = {
  ok: boolean;
  problems: string[];
  backups: { github: { configured: boolean; ok?: boolean }; disk: { configured: boolean; ok?: boolean; message?: string | null } };
  projects: { title: string; days_since_activity: number; stalled: boolean }[] | null;
};

const mark = (b: { configured: boolean; ok?: boolean }) => (!b.configured ? '–' : b.ok ? '✓' : '✗');
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function composeBrief(now = new Date()): Promise<Brief> {
  const status = systemStatus(now) as unknown as Status;
  const lines: string[] = [];

  if (status.problems.length === 0) lines.push('✅ All good');
  else {
    lines.push(`⚠️ ${status.problems.length} problem${status.problems.length === 1 ? '' : 's'}`);
    for (const p of status.problems) lines.push(`• ${short(p, MAX_LINE)}`);
  }

  const ordered = [...sections.values()]
    .filter((s) => isModuleEnabled(s.plugin))
    .sort((a, b) => (a.def.order ?? 100) - (b.def.order ?? 100) || a.plugin.localeCompare(b.plugin));
  for (const s of ordered) {
    try {
      const value = await withTimeout(Promise.resolve().then(() => s.def.render(s.api)), SECTION_TIMEOUT_MS, `brief '${s.def.id}'`);
      lines.push(...sectionLines(value));
    } catch (err) {
      stderr.write(`brief: section ${s.plugin}:${s.def.id} failed: ${err instanceof Error ? err.message : String(err)}\n`);
      lines.push(`(${moduleDisplayName(s.plugin)}: not available)`);
    }
  }

  const { github, disk } = status.backups;
  if (github.configured || disk.configured) lines.push(`💾 Backup: GitHub ${mark(github)} · disk ${mark(disk)}`);

  const stalled = (status.projects ?? []).filter((p) => p.stalled).slice(0, 3);
  if (stalled.length) lines.push(`💻 Stalled: ${stalled.map((p) => `${short(p.title, 40)} (${p.days_since_activity}d)`).join(', ')}`);

  const body = lines.join('\n');
  return { title: env('SHINOBI_BRIEF_TITLE') ?? 'Morning brief', body: short(body, MAX_BODY), ok: status.ok };
}

export async function sendBrief(now = new Date()): Promise<{ brief: Brief; delivery: SafePushResult }> {
  const brief = await composeBrief(now);
  const delivery = await sendPushSafe({ title: brief.title, body: brief.body, tag: 'morning-brief', url: '/' });
  return { brief, delivery };
}

// ---- scheduler ----

function env(key: string): string | undefined {
  const v = readEnvFile().values[key] ?? process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

/** The cron the brief runs on, or null when switched off or invalid. */
export function briefCron(raw: string | undefined): CronMatcher | null {
  const value = raw ?? DEFAULT_BRIEF_CRON;
  if (['off', 'false', '0', 'no'].includes(value.toLowerCase())) return null;
  try {
    return parseCron(value);
  } catch (err) {
    stderr.write(`brief: ignoring SHINOBI_BRIEF_CRON (${err instanceof Error ? err.message : String(err)})\n`);
    return null;
  }
}

let timer: NodeJS.Timeout | null = null;
let lastMinute = '';

async function tick(): Promise<void> {
  const now = new Date();
  const minute = now.toISOString().slice(0, 16);
  if (minute === lastMinute) return;
  try {
    const cron = briefCron(env('SHINOBI_BRIEF_CRON'));
    if (!cron || !cron.matches(now, env('SHINOBI_TIMEZONE'))) return;
    lastMinute = minute;
    const { delivery } = await sendBrief(now);
    stderr.write(`brief: sent to ${delivery.succeeded}/${delivery.total} device(s)${delivery.error ? ` (${delivery.error})` : ''}\n`);
  } catch (err) {
    stderr.write(`brief: failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export function startBriefScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 30_000);
  timer.unref();
}

export function stopBriefScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
