import { detectAvailableProvider, logDetection } from './detect.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { VoyageEmbeddingProvider } from './voyage.js';
import type { ConcreteProviderKind, EmbeddingProvider, EmbeddingProviderKind } from './types.js';

const VALID: ReadonlyArray<EmbeddingProviderKind> = ['openai', 'voyage', 'ollama', 'auto', 'none'];

function readEnvKind(): EmbeddingProviderKind {
  const raw = (process.env['SHINOBI_EMBED_PROVIDER'] ?? 'auto').toLowerCase();
  if ((VALID as readonly string[]).includes(raw)) {
    return raw as EmbeddingProviderKind;
  }
  return 'auto';
}

function instantiate(kind: ConcreteProviderKind): EmbeddingProvider | null {
  const explicitKey = process.env['SHINOBI_EMBED_API_KEY'];
  const sharedModel = process.env['SHINOBI_EMBED_MODEL'];
  const sharedDims = Number(process.env['SHINOBI_EMBED_DIMS']);
  const dimsValid = Number.isFinite(sharedDims) && sharedDims > 0;

  if (kind === 'openai') {
    const apiKey = explicitKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) return null;
    const opts: { apiKey: string; model?: string; dimensions?: number } = { apiKey };
    if (sharedModel) opts.model = sharedModel;
    if (dimsValid) opts.dimensions = sharedDims;
    return new OpenAIEmbeddingProvider(opts);
  }
  if (kind === 'voyage') {
    const apiKey = explicitKey ?? process.env['VOYAGE_API_KEY'];
    if (!apiKey) return null;
    const opts: { apiKey: string; model?: string; dimensions?: number } = { apiKey };
    if (sharedModel) opts.model = sharedModel;
    if (dimsValid) opts.dimensions = sharedDims;
    return new VoyageEmbeddingProvider(opts);
  }
  if (kind === 'ollama') {
    const opts: { model?: string; baseUrl?: string; dimensions?: number } = {};
    if (sharedModel) opts.model = sharedModel;
    const baseUrl = process.env['SHINOBI_OLLAMA_URL'];
    if (baseUrl) opts.baseUrl = baseUrl;
    if (dimsValid) opts.dimensions = sharedDims;
    return new OllamaEmbeddingProvider(opts);
  }
  return null;
}

export function embeddingProviderFromEnv(): EmbeddingProvider | null {
  const kind = readEnvKind();
  if (kind === 'none') return null;
  if (kind === 'auto') return null; // sync entry point cannot await detection
  return instantiate(kind);
}

/**
 * Async variant that runs the auto-detection chain when SHINOBI_EMBED_PROVIDER
 * is 'auto' (or unset). Order: ollama (free, local) → voyage (free tier) →
 * openai (paid) → null. When an explicit kind is set, falls back to the sync
 * factory for that kind.
 */
export async function resolveEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  const kind = readEnvKind();
  if (kind === 'none') return null;
  if (kind !== 'auto') return instantiate(kind);

  const detection = await detectAvailableProvider();
  logDetection(detection);
  if (!detection.provider) return null;
  return instantiate(detection.provider);
}
