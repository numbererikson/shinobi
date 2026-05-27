import type { EmbeddingProvider } from './types.js';

interface OllamaEmbedResponse {
  embedding?: number[];
  embeddings?: number[][];
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;
  readonly model: string;
  private baseUrl: string;

  constructor(opts: { model?: string; baseUrl?: string; dimensions?: number } = {}) {
    this.model = opts.model ?? 'nomic-embed-text';
    this.dimensions = opts.dimensions ?? 768;
    this.baseUrl = opts.baseUrl ?? 'http://localhost:11434';
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embed failed: ${response.status} ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as OllamaEmbedResponse;
    const vec = json.embedding ?? json.embeddings?.[0];
    if (!vec) throw new Error('Ollama embed: empty response');
    return new Float32Array(vec);
  }
}
