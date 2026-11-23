// Web push service: VAPID key bootstrap (auto-generates on first use, persists
// to <config dir>/.env via settings store) + sendPushToAll helper.

import { recordNotification } from '../../models/notifications.js';
import webpush from 'web-push';
import { stderr } from 'node:process';
import { listSubscriptions, recordSendResult, deleteSubscriptionByEndpoint } from '../../models/push_subscriptions.js';
import { envPath, writeEnvPatch, readEnvFile } from '../../dashboard/settings-store.js';

/**
 * The VAPID subject is the contact the push service sees. Apple's push service
 * rejects a subject it does not accept with 403 BadJwtToken, and the old
 * default (a mailto: on the reserved .local domain) is exactly that — so the
 * old value, which earlier versions wrote into .env, is ignored.
 */
const LEGACY_SUBJECT = 'mailto:operator@shinobi.local';
const SUBJECT_FALLBACK = 'https://github.com/numbererikson/shinobi';

let configured = false;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * First usable of: .env value, process env, the public https URL of this
 * Shinobi (SHINOBI_PUBLIC_URL), the project URL.
 */
export function resolveVapidSubject(
  fileValue: string | undefined,
  envValue: string | undefined,
  publicUrl: string | undefined,
): string {
  for (const v of [fileValue, envValue]) {
    const s = v?.trim();
    if (s && s !== LEGACY_SUBJECT) return s;
  }
  const url = (publicUrl ?? '').trim().replace(/\/+$/, '');
  return url.startsWith('https://') ? url : SUBJECT_FALLBACK;
}

function readVapidFromEnv(): { publicKey: string | null; privateKey: string | null; subject: string } {
  const env = readEnvFile().values;
  return {
    publicKey: env['SHINOBI_VAPID_PUBLIC_KEY'] ?? process.env['SHINOBI_VAPID_PUBLIC_KEY'] ?? null,
    privateKey: env['SHINOBI_VAPID_PRIVATE_KEY'] ?? process.env['SHINOBI_VAPID_PRIVATE_KEY'] ?? null,
    subject: resolveVapidSubject(env['SHINOBI_VAPID_SUBJECT'], process.env['SHINOBI_VAPID_SUBJECT'], process.env['SHINOBI_PUBLIC_URL']),
  };
}

export function ensureVapidConfigured(): VapidConfig {
  const existing = readVapidFromEnv();
  if (existing.publicKey && existing.privateKey) {
    if (!configured) {
      webpush.setVapidDetails(existing.subject, existing.publicKey, existing.privateKey);
      configured = true;
    }
    return {
      publicKey: existing.publicKey,
      privateKey: existing.privateKey,
      subject: existing.subject,
    };
  }
  // Generate fresh pair, persist to .env so they survive restart. The subject is
  // not persisted: it is resolved on every start, so a better default applies.
  const generated = webpush.generateVAPIDKeys();
  writeEnvPatch({
    SHINOBI_VAPID_PUBLIC_KEY: generated.publicKey,
    SHINOBI_VAPID_PRIVATE_KEY: generated.privateKey,
  });
  webpush.setVapidDetails(existing.subject, generated.publicKey, generated.privateKey);
  configured = true;
  stderr.write(`web-push: generated and persisted new VAPID keypair to ${envPath()}\n`);
  return {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: existing.subject,
  };
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  approval_id?: number;
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, unknown>;
}

export interface PushDeliveryResult {
  total: number;
  succeeded: number;
  failed: number;
  pruned_endpoints: string[];
}

export interface SafePushResult extends PushDeliveryResult {
  error: string | null;
}

/**
 * Best-effort variant of sendPushToAll: never throws. A failure to deliver a
 * notification must never break the caller's primary flow (e.g. completing a
 * task or signalling that an agent is blocked). Per-subscription errors are
 * already absorbed inside sendPushToAll; this also guards VAPID bootstrap.
 */
export async function sendPushSafe(payload: PushPayload): Promise<SafePushResult> {
  try {
    const result = await sendPushToAll(payload);
    return { ...result, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`web-push: sendPushSafe swallowed error: ${msg.slice(0, 160)}\n`);
    return { total: 0, succeeded: 0, failed: 0, pruned_endpoints: [], error: msg.slice(0, 500) };
  }
}

/** Where tapping a pushed notification leads: its own inbox entry. */
export function inboxUrl(id: number): string {
  return `/inbox#n${id}`;
}

export async function sendPushToAll(input: PushPayload): Promise<PushDeliveryResult> {
  // Keep a copy in the inbox first, so it is readable even when delivery
  // fails or the phone drops the banner. Inbox trouble never blocks the push.
  let payload = input;
  try {
    const id = recordNotification({ title: input.title, body: input.body, tag: input.tag ?? null, url: input.url ?? null });
    payload = { ...input, url: inboxUrl(id) };
  } catch (err) {
    stderr.write(`web-push: inbox record failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  ensureVapidConfigured();
  const subscriptions = listSubscriptions();
  const out: PushDeliveryResult = {
    total: subscriptions.length,
    succeeded: 0,
    failed: 0,
    pruned_endpoints: [],
  };
  if (subscriptions.length === 0) return out;

  const json = JSON.stringify(payload);
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          json,
          { TTL: 60 * 60 * 6 },
        );
        recordSendResult(sub.id, null);
        out.succeeded++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
        const errMsg = describePushError(err);
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired/gone — drop it.
          deleteSubscriptionByEndpoint(sub.endpoint);
          out.pruned_endpoints.push(sub.endpoint);
        } else {
          recordSendResult(sub.id, errMsg.slice(0, 500));
        }
        out.failed++;
        stderr.write(`web-push: send failed for sub#${sub.id}: ${errMsg.slice(0, 200)}\n`);
      }
    }),
  );
  return out;
}

/**
 * "403 BadJwtToken" instead of web-push's bare "Received unexpected response
 * code": the status and the push service's response body carry the reason.
 */
export function describePushError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const { statusCode, body } = (err ?? {}) as { statusCode?: number; body?: unknown };
  let reason = typeof body === 'string' ? body.trim() : '';
  try {
    const parsed = JSON.parse(reason) as { reason?: unknown };
    if (typeof parsed.reason === 'string') reason = parsed.reason;
  } catch {
    // not JSON: keep the raw text
  }
  const parts = [statusCode !== undefined ? String(statusCode) : null, reason || message].filter(Boolean);
  return parts.join(' ');
}
