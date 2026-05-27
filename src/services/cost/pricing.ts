// Per-million-token USD rates. Anthropic pricing as of 2026-01.
// Models not listed default to the Sonnet rate.

export interface ModelRate {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
}

const RATES: Array<{ pattern: RegExp; rate: ModelRate }> = [
  {
    pattern: /opus/i,
    rate: { input_per_mtok: 15, output_per_mtok: 75, cache_write_per_mtok: 18.75, cache_read_per_mtok: 1.5 },
  },
  {
    pattern: /sonnet/i,
    rate: { input_per_mtok: 3, output_per_mtok: 15, cache_write_per_mtok: 3.75, cache_read_per_mtok: 0.3 },
  },
  {
    pattern: /haiku/i,
    rate: { input_per_mtok: 0.8, output_per_mtok: 4, cache_write_per_mtok: 1, cache_read_per_mtok: 0.08 },
  },
];

const DEFAULT_RATE: ModelRate = RATES[1]!.rate; // Sonnet — sensible middle ground.

export function rateFor(model: string | null): ModelRate {
  if (!model) return DEFAULT_RATE;
  for (const r of RATES) if (r.pattern.test(model)) return r.rate;
  return DEFAULT_RATE;
}

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export function computeCostUsd(model: string | null, tokens: TokenCounts): number {
  const r = rateFor(model);
  return (
    (tokens.input_tokens * r.input_per_mtok) / 1_000_000 +
    (tokens.output_tokens * r.output_per_mtok) / 1_000_000 +
    (tokens.cache_creation_tokens * r.cache_write_per_mtok) / 1_000_000 +
    (tokens.cache_read_tokens * r.cache_read_per_mtok) / 1_000_000
  );
}
