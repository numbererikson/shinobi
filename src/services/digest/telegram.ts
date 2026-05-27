// Minimal Telegram delivery. Splits long messages into ≤4096-char chunks
// (Telegram hard limit) and sends sequentially. Markdown rendering is the
// caller's job; we send as plain text by default to avoid escape headaches.

import { readEnvFile } from '../../dashboard/settings-store.js';

const TELEGRAM_MAX = 4000; // safety margin under the 4096 hard limit

function envValue(key: string): string | null {
  const env = readEnvFile().values;
  return env[key] ?? process.env[key] ?? null;
}

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

export function readTelegramConfig(): TelegramConfig | null {
  const bot = envValue('SHINOBI_TELEGRAM_BOT_TOKEN');
  const chat = envValue('SHINOBI_TELEGRAM_CHAT_ID');
  if (!bot || !chat) return null;
  return { bot_token: bot, chat_id: chat };
}

export interface TelegramDeliveryResult {
  ok: boolean;
  chunks_sent: number;
  chunks_total: number;
  error?: string;
}

export async function sendTelegramMessage(text: string): Promise<TelegramDeliveryResult> {
  const config = readTelegramConfig();
  if (!config) {
    return { ok: false, chunks_sent: 0, chunks_total: 0, error: 'SHINOBI_TELEGRAM_BOT_TOKEN + SHINOBI_TELEGRAM_CHAT_ID required' };
  }
  const chunks = splitForTelegram(text);
  let sent = 0;
  for (const chunk of chunks) {
    const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chat_id,
          text: chunk,
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      return { ok: false, chunks_sent: sent, chunks_total: chunks.length, error: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, chunks_sent: sent, chunks_total: chunks.length, error: `${res.status}: ${body.slice(0, 200)}` };
    }
    sent++;
  }
  return { ok: true, chunks_sent: sent, chunks_total: chunks.length };
}

function splitForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX) return [text];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX) {
      out.push(remaining);
      break;
    }
    // Prefer to break at the last newline before the limit.
    let cut = remaining.lastIndexOf('\n', TELEGRAM_MAX);
    if (cut < TELEGRAM_MAX / 2) cut = TELEGRAM_MAX; // no newline near limit, hard cut
    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, '');
  }
  return out;
}
