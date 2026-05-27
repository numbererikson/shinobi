import { OpenAICompatProvider } from './openai-compat.js';
import type { LLMProvider, LLMProviderKind } from './types.js';

function readEnvKind(): LLMProviderKind {
  const raw = (process.env['SHINOBI_LLM_PROVIDER'] ?? 'auto').toLowerCase();
  if (raw === 'groq' || raw === 'openai' || raw === 'ollama') return raw;
  if (raw === 'none') return 'none';
  // 'auto' or anything else: pick the first available
  if (process.env['GROQ_API_KEY']) return 'groq';
  if (process.env['OPENAI_API_KEY']) return 'openai';
  return 'none';
}

export function llmProviderFromEnv(): LLMProvider | null {
  const kind = readEnvKind();
  if (kind === 'none') return null;

  const explicitKey = process.env['SHINOBI_LLM_API_KEY'];
  const overrideModel = process.env['SHINOBI_LLM_MODEL'];

  if (kind === 'groq') {
    const apiKey = explicitKey ?? process.env['GROQ_API_KEY'];
    if (!apiKey) return null;
    return new OpenAICompatProvider({
      name: 'groq',
      apiKey,
      model: overrideModel ?? 'llama-3.3-70b-versatile',
      baseUrl: process.env['GROQ_BASE_URL'] ?? 'https://api.groq.com/openai/v1',
    });
  }

  if (kind === 'openai') {
    const apiKey = explicitKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) return null;
    return new OpenAICompatProvider({
      name: 'openai',
      apiKey,
      model: overrideModel ?? 'gpt-4o-mini',
      baseUrl: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1',
    });
  }

  if (kind === 'ollama') {
    return new OpenAICompatProvider({
      name: 'ollama',
      apiKey: 'ollama',
      model: overrideModel ?? 'llama3.1:8b',
      baseUrl: process.env['SHINOBI_OLLAMA_URL'] ?? 'http://localhost:11434/v1',
    });
  }

  return null;
}
