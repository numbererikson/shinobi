import type { LLMCompleteOptions, LLMMessage, LLMProvider, LLMResult } from './types.js';

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAICompatOptions {
  name: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/**
 * Generic OpenAI-compatible chat client. Works for OpenAI, Groq, Together,
 * Anyscale, etc. — any provider exposing /v1/chat/completions.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name;
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<LLMResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
    };
    if (options.maxTokens !== undefined) body['max_tokens'] = options.maxTokens;
    if (options.responseFormat === 'json') {
      body['response_format'] = { type: 'json_object' };
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.name} chat failed: ${response.status} ${text.slice(0, 200)}`);
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const text = json.choices[0]?.message.content ?? '';
    const result: LLMResult = {
      text,
      model: this.model,
      provider: this.name,
    };
    if (json.usage?.prompt_tokens !== undefined) result.inputTokens = json.usage.prompt_tokens;
    if (json.usage?.completion_tokens !== undefined) result.outputTokens = json.usage.completion_tokens;
    return result;
  }
}
