// Auto-detects which embedding provider is available without paid keys.
// Order: ollama (free, local) → voyage (free tier) → openai (paid) → none.

import { stderr } from 'node:process';
import { readEnvFile } from '../../dashboard/settings-store.js';
import type { ConcreteProviderKind } from './types.js';

export interface DetectionResult {
  provider: ConcreteProviderKind | null;
  ollama: { reachable: boolean; has_nomic: boolean; base_url: string; models: string[] };
  voyage: { has_api_key: boolean };
  openai: { has_api_key: boolean };
}

const PROBE_TIMEOUT_MS = 1500;

function getEnv(key: string): string | null {
  const env = readEnvFile().values;
  return env[key] ?? process.env[key] ?? null;
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = PROBE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export async function detectAvailableProvider(): Promise<DetectionResult> {
  const ollamaBase = getEnv('SHINOBI_OLLAMA_URL') ?? 'http://localhost:11434';

  let ollamaReachable = false;
  let hasNomic = false;
  let models: string[] = [];
  try {
    const r = await fetchWithTimeout(`${ollamaBase}/api/tags`);
    if (r.ok) {
      ollamaReachable = true;
      const json = (await r.json()) as OllamaTagsResponse;
      models = (json.models ?? []).map((m) => m.name);
      hasNomic = models.some((n) => n.startsWith('nomic-embed-text'));
    }
  } catch {
    ollamaReachable = false;
  }

  const voyageKey = getEnv('VOYAGE_API_KEY') ?? getEnv('SHINOBI_EMBED_API_KEY');
  const openaiKey = getEnv('OPENAI_API_KEY') ?? getEnv('SHINOBI_EMBED_API_KEY');

  let chosen: ConcreteProviderKind | null = null;
  if (ollamaReachable && hasNomic) chosen = 'ollama';
  else if (voyageKey) chosen = 'voyage';
  else if (openaiKey) chosen = 'openai';

  return {
    provider: chosen,
    ollama: { reachable: ollamaReachable, has_nomic: hasNomic, base_url: ollamaBase, models },
    voyage: { has_api_key: voyageKey !== null && voyageKey.length > 0 },
    openai: { has_api_key: openaiKey !== null && openaiKey.length > 0 },
  };
}

export function logDetection(result: DetectionResult): void {
  stderr.write(`embedding auto-detect:\n`);
  stderr.write(`  ollama: reachable=${result.ollama.reachable} has_nomic=${result.ollama.has_nomic} (${result.ollama.base_url})\n`);
  if (result.ollama.reachable && !result.ollama.has_nomic && result.ollama.models.length > 0) {
    stderr.write(`    models present: ${result.ollama.models.slice(0, 5).join(', ')}${result.ollama.models.length > 5 ? '…' : ''}\n`);
    stderr.write(`    hint: run \`ollama pull nomic-embed-text\` for free local embeddings\n`);
  }
  stderr.write(`  voyage api key: ${result.voyage.has_api_key ? 'present' : 'absent'}\n`);
  stderr.write(`  openai api key: ${result.openai.has_api_key ? 'present' : 'absent'}\n`);
  stderr.write(`  → selected: ${result.provider ?? 'none (semantic recall disabled; using fulltext FTS5)'}\n`);
}
