// Whisper audio transcription via OpenAI-compatible /audio/transcriptions endpoint.
// Default provider: Groq (free tier whisper-large-v3). Falls back to OpenAI if Groq
// not configured. Picks provider from env in same chain as LLM factory.

import { stderr } from 'node:process';

export type TranscriptionProviderKind = 'groq' | 'openai' | 'none';

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

function readEnvKind(): TranscriptionProviderKind {
  const raw = (process.env['SHINOBI_TRANSCRIPTION_PROVIDER'] ?? 'auto').toLowerCase();
  if (raw === 'groq' || raw === 'openai') return raw;
  if (raw === 'none') return 'none';
  if (process.env['GROQ_API_KEY']) return 'groq';
  if (process.env['OPENAI_API_KEY']) return 'openai';
  return 'none';
}

export function transcriptionProviderFromEnv(): TranscriptionProvider | null {
  const kind = readEnvKind();
  if (kind === 'none') return null;
  if (kind === 'groq') {
    const apiKey = process.env['SHINOBI_TRANSCRIPTION_API_KEY'] ?? process.env['GROQ_API_KEY'];
    if (!apiKey) return null;
    return {
      name: 'groq',
      apiKey,
      model: process.env['SHINOBI_TRANSCRIPTION_MODEL'] ?? 'whisper-large-v3',
      baseUrl: 'https://api.groq.com/openai/v1',
    };
  }
  if (kind === 'openai') {
    const apiKey = process.env['SHINOBI_TRANSCRIPTION_API_KEY'] ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) return null;
    return {
      name: 'openai',
      apiKey,
      model: process.env['SHINOBI_TRANSCRIPTION_MODEL'] ?? 'whisper-1',
      baseUrl: 'https://api.openai.com/v1',
    };
  }
  return null;
}

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  duration_seconds: number | null;
}

interface TranscriptionApiResponse {
  text: string;
  duration?: number;
}

export async function transcribeAudio(
  audio: Buffer,
  filename: string,
  mimeType: string,
): Promise<TranscriptionResult> {
  const provider = transcriptionProviderFromEnv();
  if (!provider) {
    throw new Error(
      'No transcription provider configured. Set SHINOBI_TRANSCRIPTION_PROVIDER + GROQ_API_KEY (or OPENAI_API_KEY).',
    );
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append('model', provider.model);
  form.append('response_format', 'verbose_json');

  const response = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    stderr.write(`whisper transcribe failed: ${response.status} ${body.slice(0, 200)}\n`);
    throw new Error(`whisper transcribe failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as TranscriptionApiResponse;
  return {
    text: (json.text ?? '').trim(),
    provider: provider.name,
    model: provider.model,
    duration_seconds: typeof json.duration === 'number' ? json.duration : null,
  };
}
