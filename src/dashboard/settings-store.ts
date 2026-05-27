// Settings store: read/write ~/.shinobi/.env preserving comments + blank lines.
// Writes always create a timestamped backup so accidents are recoverable.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configDir } from '../lib/config.js';

export interface SettingSpec {
  key: string;
  label: string;
  description: string;
  group: 'storage' | 'dashboard' | 'embedding' | 'llm' | 'recall' | 'sync' | 'push' | 'relay' | 'github' | 'telemetry' | 'digest';
  secret?: boolean;
  enumValues?: string[];
  placeholder?: string;
  requiresRestart?: boolean;
}

export const KNOWN_SETTINGS: SettingSpec[] = [
  // storage
  { key: 'SHINOBI_DB_PATH', label: 'DB path', description: 'Override the SQLite database location.', group: 'storage', placeholder: '~/.shinobi/shinobi.db', requiresRestart: true },
  { key: 'SHINOBI_CONFIG_DIR', label: 'Config dir', description: 'Override where ~/.shinobi/ lives.', group: 'storage', requiresRestart: true },
  // dashboard
  { key: 'SHINOBI_DASHBOARD_PORT', label: 'Dashboard port', description: 'HTTP port (default 8765).', group: 'dashboard', placeholder: '8765', requiresRestart: true },
  { key: 'SHINOBI_DASHBOARD_HOST', label: 'Dashboard host', description: 'Bind host. 127.0.0.1 is local-only.', group: 'dashboard', placeholder: '127.0.0.1', requiresRestart: true },
  { key: 'SHINOBI_DASHBOARD_AUTH', label: 'Dashboard auth', description: 'Force auth on/off regardless of bind host. Auto = on for non-loopback, off otherwise.', group: 'dashboard', enumValues: ['auto', 'on', 'off'], requiresRestart: true },
  { key: 'SHINOBI_DASHBOARD_TOKEN', label: 'Dashboard token', description: 'Override the auth token. Setting this implies auth=on. Leave empty to use the auto-generated file token.', group: 'dashboard', secret: true, requiresRestart: true },
  // embedding (semantic recall)
  { key: 'SHINOBI_EMBED_PROVIDER', label: 'Embed provider', description: 'Which embedding provider to use for semantic recall. "auto" detects in order: ollama (local) → voyage (free) → openai (paid).', group: 'embedding', enumValues: ['auto', 'none', 'openai', 'voyage', 'ollama'], requiresRestart: true },
  { key: 'SHINOBI_EMBED_API_KEY', label: 'Embed API key', description: 'Override provider API key. Falls back to canonical OPENAI_API_KEY / VOYAGE_API_KEY.', group: 'embedding', secret: true },
  { key: 'SHINOBI_EMBED_MODEL', label: 'Embed model', description: 'Override default model.', group: 'embedding', placeholder: 'text-embedding-3-small' },
  { key: 'SHINOBI_OLLAMA_URL', label: 'Ollama base URL', description: 'Used by embedding + LLM providers when provider=ollama.', group: 'embedding', placeholder: 'http://localhost:11434' },
  // llm (extraction + summarization)
  { key: 'SHINOBI_LLM_PROVIDER', label: 'LLM provider', description: 'Which LLM to use for extract_decisions + compress_session_summary.', group: 'llm', enumValues: ['auto', 'groq', 'openai', 'ollama', 'none'] },
  { key: 'SHINOBI_LLM_API_KEY', label: 'LLM API key', description: 'Override LLM API key. Falls back to GROQ_API_KEY / OPENAI_API_KEY.', group: 'llm', secret: true },
  { key: 'SHINOBI_LLM_MODEL', label: 'LLM model', description: 'Override default model.', group: 'llm', placeholder: 'llama-3.3-70b-versatile' },
  // canonical keys (shared with other tools)
  { key: 'GROQ_API_KEY', label: 'Groq API key', description: 'Canonical Groq key (free tier). Used by LLM extractor when no SHINOBI_LLM_API_KEY set.', group: 'llm', secret: true },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API key', description: 'Canonical OpenAI key. Used by embedding + LLM as fallback.', group: 'llm', secret: true },
  { key: 'VOYAGE_API_KEY', label: 'Voyage API key', description: 'Canonical Voyage key (free tier). Embedding fallback.', group: 'embedding', secret: true },
  // recall mode
  { key: 'SHINOBI_RECALL_MODE', label: 'Recall mode', description: 'semantic uses embeddings when available, fulltext is FTS5-only.', group: 'recall', enumValues: ['semantic', 'fulltext'] },
  // web push (auto-generated on first /api/push/vapid-key call)
  { key: 'SHINOBI_VAPID_PUBLIC_KEY', label: 'VAPID public key', description: 'Web Push public key. Auto-generated on first push subscription.', group: 'push' },
  { key: 'SHINOBI_VAPID_PRIVATE_KEY', label: 'VAPID private key', description: 'Web Push private key. Auto-generated on first push subscription.', group: 'push', secret: true },
  { key: 'SHINOBI_VAPID_SUBJECT', label: 'VAPID subject', description: 'Contact email/URL for push services. Default mailto:operator@shinobi.local.', group: 'push', placeholder: 'mailto:you@example.com' },
  // multi-agent relay (Cloudflare Worker websocket)
  { key: 'SHINOBI_RELAY_URL', label: 'Relay URL', description: 'WebSocket URL of the shinobi-relay Cloudflare Worker. Leave empty to disable multi-agent sync.', group: 'relay', placeholder: 'wss://shinobi-relay.yourname.workers.dev/ws', requiresRestart: true },
  { key: 'SHINOBI_RELAY_TOKEN', label: 'Relay token', description: 'Shared secret matching wrangler secret SHINOBI_RELAY_TOKEN on the Worker.', group: 'relay', secret: true, requiresRestart: true },
  { key: 'SHINOBI_RELAY_WORKSPACE', label: 'Relay workspace', description: 'Workspace identifier. All agents using the same string share a relay channel.', group: 'relay', placeholder: 'personal', requiresRestart: true },
  // GitHub integration (webhook receiver)
  { key: 'SHINOBI_GITHUB_WEBHOOK_SECRET', label: 'GitHub webhook secret', description: 'Shared HMAC secret with the GitHub repo webhook. Required to enable /api/github/webhook.', group: 'github', secret: true },
  { key: 'SHINOBI_GITHUB_TOKEN', label: 'GitHub token (optional)', description: 'Personal access token enabling bi-directional comments (subtask done → PR comment). Leave empty to keep one-way ingestion only.', group: 'github', secret: true },
  // Telemetry (off by default, anonymous, no content ever leaves)
  { key: 'SHINOBI_TELEMETRY', label: 'Anonymous telemetry', description: 'When on, records MCP tool calls + dashboard view hits to a local buffer. Off by default. Inspect at /telemetry. No project content, titles, or usernames are ever included.', group: 'telemetry', enumValues: ['off', 'on'], requiresRestart: true },
  { key: 'SHINOBI_TELEMETRY_ENDPOINT', label: 'Telemetry endpoint (optional)', description: 'HTTPS URL accepting POST {events:[...]} batches. Leave empty to keep events local only.', group: 'telemetry', placeholder: 'https://shinobi-telemetry.example.com/ingest' },
  // Weekly digest auto-export
  { key: 'SHINOBI_DIGEST_AUTO', label: 'Auto weekly digest', description: 'When on, the dashboard generates the weekly digest every Sunday 18:00 local time → ~/.shinobi/digests/YYYY-WW.md.', group: 'digest', enumValues: ['off', 'on'], requiresRestart: true },
  { key: 'SHINOBI_TELEGRAM_BOT_TOKEN', label: 'Telegram bot token', description: 'Optional. When set with SHINOBI_TELEGRAM_CHAT_ID, the auto digest is also delivered via Telegram bot.', group: 'digest', secret: true },
  { key: 'SHINOBI_TELEGRAM_CHAT_ID', label: 'Telegram chat ID', description: 'Numeric chat ID the bot should send digests to. Get it by sending /start to your bot and reading https://api.telegram.org/bot<TOKEN>/getUpdates.', group: 'digest' },
];

export function envPath(): string {
  return join(configDir(), '.env');
}

export function backupsDir(): string {
  return join(configDir(), '.env.backups');
}

export interface ParsedEnv {
  lines: Array<{ kind: 'kv'; key: string; value: string } | { kind: 'comment'; raw: string } | { kind: 'blank' }>;
  values: Record<string, string>;
}

export function readEnvFile(): ParsedEnv {
  const path = envPath();
  if (!existsSync(path)) return { lines: [], values: {} };
  const text = readFileSync(path, 'utf-8');
  const lines: ParsedEnv['lines'] = [];
  const values: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      lines.push({ kind: 'blank' });
      continue;
    }
    if (trimmed.startsWith('#')) {
      lines.push({ kind: 'comment', raw });
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq < 0) {
      lines.push({ kind: 'comment', raw });
      continue;
    }
    const key = raw.slice(0, eq).trim();
    let value = raw.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key !== '') {
      lines.push({ kind: 'kv', key, value });
      values[key] = value;
    } else {
      lines.push({ kind: 'comment', raw });
    }
  }
  return { lines, values };
}

export interface RedactedSetting {
  key: string;
  value: string | null;
  is_set: boolean;
  is_secret: boolean;
}

export function listRedactedSettings(): RedactedSetting[] {
  const { values } = readEnvFile();
  return KNOWN_SETTINGS.map((spec) => {
    const raw = values[spec.key];
    const isSet = raw !== undefined && raw !== '';
    if (spec.secret) {
      return {
        key: spec.key,
        value: isSet ? `***${raw!.slice(-4)}` : null,
        is_set: isSet,
        is_secret: true,
      };
    }
    return {
      key: spec.key,
      value: isSet ? raw! : null,
      is_set: isSet,
      is_secret: false,
    };
  });
}

export interface WriteEnvResult {
  written: number;
  cleared: number;
  backup_path: string | null;
  env_path: string;
}

/**
 * Apply a patch to the .env file. Undefined entries leave the key alone,
 * null clears the key (removes the line), strings set or update the key.
 */
export function writeEnvPatch(patch: Record<string, string | null | undefined>): WriteEnvResult {
  const known = new Set(KNOWN_SETTINGS.map((s) => s.key));
  for (const k of Object.keys(patch)) {
    if (!known.has(k)) {
      throw new Error(`unknown setting key: ${k}`);
    }
  }

  const path = envPath();
  mkdirSync(dirname(path), { recursive: true });

  let backupPath: string | null = null;
  if (existsSync(path)) {
    mkdirSync(backupsDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = join(backupsDir(), `.env-${stamp}.bak`);
    copyFileSync(path, backupPath);
  }

  const parsed = readEnvFile();
  const seen = new Set<string>();
  const outLines: string[] = [];
  let written = 0;
  let cleared = 0;

  for (const line of parsed.lines) {
    if (line.kind === 'blank') {
      outLines.push('');
      continue;
    }
    if (line.kind === 'comment') {
      outLines.push(line.raw);
      continue;
    }
    const key = line.key;
    seen.add(key);
    if (key in patch) {
      const next = patch[key];
      if (next === null || next === '') {
        cleared++;
        continue;
      }
      if (next === undefined) {
        outLines.push(`${key}=${line.value}`);
        continue;
      }
      outLines.push(`${key}=${next}`);
      written++;
      continue;
    }
    outLines.push(`${key}=${line.value}`);
  }

  // Append new keys that didn't exist in the file yet.
  const newKeys = Object.keys(patch).filter((k) => !seen.has(k));
  if (newKeys.length > 0) {
    if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
      outLines.push('');
    }
    outLines.push('# Added via dashboard Settings');
    for (const key of newKeys) {
      const next = patch[key];
      if (next === null || next === undefined || next === '') continue;
      outLines.push(`${key}=${next}`);
      written++;
    }
  }

  writeFileSync(path, outLines.join('\n') + '\n', 'utf-8');

  return { written, cleared, backup_path: backupPath, env_path: path };
}
