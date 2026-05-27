import { llmProviderFromEnv } from '../llm/factory.js';
import type { LLMMessage } from '../llm/types.js';

const EXTRACTION_PROMPT = `You extract decisions from a developer/AI conversation transcript.

A "decision" is a concrete choice the team committed to — e.g., "we'll use SQLite over Postgres because embedded fits the use case", "switching to Hono after Express friction", "dropping Redis from the plan".

NOT decisions:
- Tool/file paths mentioned in passing
- Questions still open or hypothetical "we could maybe..."
- Quoting someone else's prior decision (unless re-affirmed in this transcript)
- Implementation details that follow naturally from an existing decision

For EACH real decision in the transcript, emit one JSON object with these fields:
- summary: one-line statement (max 100 chars)
- rationale: short reason WHY (1-3 sentences, max 500 chars)
- kind: one of "architecture" | "library" | "pattern" | "tradeoff" | "workaround" | "other"
- alternatives_considered: comma-separated rejected alternatives (string, optional)
- files_touched: array of file paths mentioned in context of this decision (optional)

Output STRICTLY valid JSON: an object with one key "decisions" whose value is the array of decision objects. No other text, no markdown wrapping, no commentary.

If no decisions found in the transcript: {"decisions": []}`;

const MAX_TRANSCRIPT_CHARS = 24000;

export interface ExtractedDecision {
  summary: string;
  rationale: string;
  kind: 'architecture' | 'library' | 'pattern' | 'tradeoff' | 'workaround' | 'other';
  alternatives_considered: string | null;
  files_touched: string[] | null;
}

export interface ExtractionResult {
  decisions: ExtractedDecision[];
  model: string;
  provider: string;
  truncated: boolean;
  raw_length: number;
}

const VALID_KINDS = new Set([
  'architecture',
  'library',
  'pattern',
  'tradeoff',
  'workaround',
  'other',
]);

function clamp(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeDecision(raw: unknown): ExtractedDecision | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const summary = clamp(row['summary'], 100);
  const rationale = clamp(row['rationale'], 500);
  if (!summary || !rationale) return null;

  const kindRaw = typeof row['kind'] === 'string' ? row['kind'].toLowerCase() : 'other';
  const kind = VALID_KINDS.has(kindRaw) ? (kindRaw as ExtractedDecision['kind']) : 'other';

  const altRaw = row['alternatives_considered'];
  const alternatives_considered =
    typeof altRaw === 'string' && altRaw.trim() !== '' ? clamp(altRaw, 500) : null;

  let files_touched: string[] | null = null;
  if (Array.isArray(row['files_touched'])) {
    const cleaned = row['files_touched']
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map((s) => s.trim())
      .slice(0, 20);
    files_touched = cleaned.length > 0 ? cleaned : null;
  }

  return { summary, rationale, kind, alternatives_considered, files_touched };
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fence if present.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const inner = fence ? fence[1]! : trimmed;
  return JSON.parse(inner);
}

export async function extractDecisions(text: string): Promise<ExtractionResult> {
  const provider = llmProviderFromEnv();
  if (!provider) {
    throw new Error(
      'No LLM provider configured for extraction. Set SHINOBI_LLM_PROVIDER + SHINOBI_LLM_API_KEY (or GROQ_API_KEY / OPENAI_API_KEY).',
    );
  }

  const rawLength = text.length;
  const truncated = rawLength > MAX_TRANSCRIPT_CHARS;
  const transcript = truncated ? text.slice(-MAX_TRANSCRIPT_CHARS) : text;

  const messages: LLMMessage[] = [
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: `Transcript:\n\n${transcript}` },
  ];

  const result = await provider.complete(messages, {
    temperature: 0.1,
    responseFormat: 'json',
  });

  let parsed: unknown;
  try {
    parsed = tryParseJson(result.text);
  } catch (err) {
    throw new Error(
      `extractor: ${provider.name} returned unparseable JSON: ${err instanceof Error ? err.message : String(err)} :: text=${result.text.slice(0, 200)}`,
    );
  }

  let decisionsRaw: unknown[] = [];
  if (Array.isArray(parsed)) {
    decisionsRaw = parsed;
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['decisions'])) decisionsRaw = obj['decisions'];
  }

  const decisions: ExtractedDecision[] = [];
  for (const raw of decisionsRaw) {
    const normalized = normalizeDecision(raw);
    if (normalized) decisions.push(normalized);
  }

  return {
    decisions,
    model: provider.model,
    provider: provider.name,
    truncated,
    raw_length: rawLength,
  };
}
