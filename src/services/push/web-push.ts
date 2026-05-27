// Web push service: VAPID key bootstrap (auto-generates on first use, persists
// to ~/.shinobi/.env via settings store) + sendPushToAll helper.

import webpush from 'web-push';
import { stderr } from 'node:process';
import { listSubscriptions, recordSendResult, deleteSubscriptionByEndpoint } from '../../models/push_subscriptions.js';
import { writeEnvPatch, readEnvFile } from '../../dashboard/settings-store.js';

const SUBJECT_DEFAULT = 'mailto:operator@shinobi.local';

let configured = false;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

function readVapidFromEnv(): { publicKey: string | null; privateKey: string | null; subject: string } {
  const env = readEnvFile().values;
  return {
    publicKey: env['SHINOBI_VAPID_PUBLIC_KEY'] ?? process.env['SHINOBI_VAPID_PUBLIC_KEY'] ?? null,
    privateKey: env['SHINOBI_VAPID_PRIVATE_KEY'] ?? process.env['SHINOBI_VAPID_PRIVATE_KEY'] ?? null,
    subject: env['SHINOBI_VAPID_SUBJECT'] ?? process.env['SHINOBI_VAPID_SUBJECT'] ?? SUBJECT_DEFAULT,
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
  // Generate fresh pair, persist to ~/.shinobi/.env so they survive restart.
  const generated = webpush.generateVAPIDKeys();
  writeEnvPatch({
    SHINOBI_VAPID_PUBLIC_KEY: generated.publicKey,
    SHINOBI_VAPID_PRIVATE_KEY: generated.privateKey,
    SHINOBI_VAPID_SUBJECT: existing.subject,
  });
  webpush.setVapidDetails(existing.subject, generated.publicKey, generated.privateKey);
  configured = true;
  stderr.write(`web-push: generated and persisted new VAPID keypair to ~/.shinobi/.env\n`);
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

export async function sendPushToAll(payload: PushPayload): Promise<PushDeliveryResult> {
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
        const errMsg = err instanceof Error ? err.message : String(err);
        const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired/gone — drop it.
          deleteSubscriptionByEndpoint(sub.endpoint);
          out.pruned_endpoints.push(sub.endpoint);
        } else {
          recordSendResult(sub.id, errMsg.slice(0, 500));
        }
        out.failed++;
        stderr.write(`web-push: send failed for sub#${sub.id} (${statusCode ?? '?'}): ${errMsg.slice(0, 120)}\n`);
      }
    }),
  );
  return out;
}
