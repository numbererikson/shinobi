export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompleteOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface LLMResult {
  text: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<LLMResult>;
}

export type LLMProviderKind = 'groq' | 'openai' | 'ollama' | 'none';
