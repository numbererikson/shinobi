import type { EmbeddingProvider } from './types.js';

interface VoyageEmbedResponse {
  data: Array<{ embedding: number[] }>;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly dimensions: number;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string; dimensions?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'voyage-3-lite';
    this.dimensions = opts.dimensions ?? 512;
    this.baseUrl = opts.baseUrl ?? 'https://api.voyageai.com/v1';
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: [text] }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage embed failed: ${response.status} ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as VoyageEmbedResponse;
    const vec = json.data[0]?.embedding;
    if (!vec) throw new Error('Voyage embed: empty response');
    return new Float32Array(vec);
  }
}
