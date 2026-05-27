export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly model: string;
  embed(text: string): Promise<Float32Array>;
}

export type EmbeddingProviderKind = 'openai' | 'voyage' | 'ollama' | 'auto' | 'none';

export type ConcreteProviderKind = Exclude<EmbeddingProviderKind, 'auto' | 'none'>;
