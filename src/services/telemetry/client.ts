// Anonymous, opt-in telemetry. Off by default. When SHINOBI_TELEMETRY=on,
// records events into the local telemetry_events table for inspection and
// optionally batches them to SHINOBI_TELEMETRY_ENDPOINT.
//
// Privacy rules (enforced by callers, not the transport):
//   - NEVER include project titles, task titles, file paths, code snippets,
//     decision bodies, note contents, prompt text, model output, IP addresses,
//     usernames, or any identifier that links events to a specific human.
//   - Allowed: enum values (tool name, view path, provider name), small
//     non-negative integers (counts, byte sizes rounded), boolean flags.

import { stderr } from 'node:process';
import { getDb } from '../../lib/db.js';
import { readEnvFile } from '../../dashboard/settings-store.js';

export interface TelemetryEvent {
  id: number;
  event_type: string;
  payload_json: string | null;
  recorded_at: string;
  sent_at: string | null;
}

let enabledCache: boolean | null = null;

function envValue(key: string): string | null {
  const env = readEnvFile().values;
  return env[key] ?? process.env[key] ?? null;
}

export function isTelemetryEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  const raw = (envValue('SHINOBI_TELEMETRY') ?? 'off').toLowerCase();
  enabledCache = raw === 'on' || raw === 'true' || raw === '1';
  return enabledCache;
}

export function resetTelemetryEnabledCache(): void {
  enabledCache = null;
}

export function trackEvent(eventType: string, payload?: Record<string, unknown>): void {
  if (!isTelemetryEnabled()) return;
  try {
    getDb()
      .prepare('INSERT INTO telemetry_events (event_type, payload_json) VALUES (?, ?)')
      .run(eventType, payload ? JSON.stringify(payload) : null);
  } catch (err) {
    // Telemetry must never break the host. Worst-case we silently drop.
    stderr.write(`telemetry: insert failed (${err instanceof Error ? err.message : String(err)})\n`);
  }
}

export interface TelemetrySummary {
  enabled: boolean;
  total_events: number;
  unsent_events: number;
  last_recorded_at: string | null;
  last_sent_at: string | null;
  endpoint_configured: boolean;
  by_event_type: Array<{ event_type: string; count: number }>;
  last_7d_count: number;
}

export function getTelemetrySummary(): TelemetrySummary {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM telemetry_events').get() as { n: number }).n;
  const unsent = (db.prepare('SELECT COUNT(*) AS n FROM telemetry_events WHERE sent_at IS NULL').get() as { n: number }).n;
  const last = db.prepare('SELECT MAX(recorded_at) AS r, MAX(sent_at) AS s FROM telemetry_events').get() as {
    r: string | null;
    s: string | null;
  };
  const byType = db
    .prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM telemetry_events
       GROUP BY event_type
       ORDER BY count DESC
       LIMIT 30`,
    )
    .all() as Array<{ event_type: string; count: number }>;
  const last7d = (db.prepare(
    `SELECT COUNT(*) AS n FROM telemetry_events
     WHERE recorded_at >= datetime('now', '-7 days')`,
  ).get() as { n: number }).n;
  return {
    enabled: isTelemetryEnabled(),
    total_events: total,
    unsent_events: unsent,
    last_recorded_at: last.r,
    last_sent_at: last.s,
    endpoint_configured: envValue('SHINOBI_TELEMETRY_ENDPOINT') !== null,
    by_event_type: byType,
    last_7d_count: last7d,
  };
}

export interface FlushResult {
  ok: boolean;
  attempted: number;
  sent: number;
  endpoint: string | null;
  status?: number;
  error?: string;
}

export async function flushTelemetry(batchLimit = 200): Promise<FlushResult> {
  const endpoint = envValue('SHINOBI_TELEMETRY_ENDPOINT');
  if (!endpoint) {
    return { ok: false, attempted: 0, sent: 0, endpoint: null, error: 'SHINOBI_TELEMETRY_ENDPOINT not configured' };
  }
  const rows = getDb()
    .prepare<[number], TelemetryEvent>(
      `SELECT * FROM telemetry_events WHERE sent_at IS NULL ORDER BY id ASC LIMIT ?`,
    )
    .all(batchLimit);
  if (rows.length === 0) {
    return { ok: true, attempted: 0, sent: 0, endpoint };
  }
  const payload = rows.map((r) => ({
    event_type: r.event_type,
    payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    recorded_at: r.recorded_at,
  }));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: payload }),
    });
  } catch (err) {
    return {
      ok: false,
      attempted: rows.length,
      sent: 0,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      attempted: rows.length,
      sent: 0,
      endpoint,
      status: response.status,
      error: `endpoint returned ${response.status}`,
    };
  }
  // Mark rows as sent.
  const markStmt = getDb().prepare('UPDATE telemetry_events SET sent_at = CURRENT_TIMESTAMP WHERE id = ?');
  const tx = getDb().transaction((ids: number[]) => {
    for (const id of ids) markStmt.run(id);
  });
  tx(rows.map((r) => r.id));
  return { ok: true, attempted: rows.length, sent: rows.length, endpoint, status: response.status };
}

export function purgeOldTelemetry(olderThanDays = 90): number {
  const r = getDb()
    .prepare(`DELETE FROM telemetry_events WHERE recorded_at < datetime('now', ?)`)
    .run(`-${olderThanDays} days`);
  return r.changes;
}
