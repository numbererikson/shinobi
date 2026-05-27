import type { EmbeddingProvider } from './types.js';

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[] }>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string; dimensions?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'text-embedding-3-small';
    this.dimensions = opts.dimensions ?? 1536;
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1';
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embed failed: ${response.status} ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as OpenAIEmbedResponse;
    const vec = json.data[0]?.embedding;
    if (!vec) throw new Error('OpenAI embed: empty response');
    return new Float32Array(vec);
  }
}
