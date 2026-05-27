// Parses Claude Code JSONL transcripts (~/.claude/projects/<encoded-path>/<session-id>.jsonl)
// and emits per-session token aggregates. Each transcript line is a JSON
// object; assistant turns carry `message.usage` and `message.model` fields.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { computeCostUsd } from './pricing.js';

export interface ParsedSession {
  session_id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  assistant_turns: number;
  cost_usd: number;
  source_path: string;
}

interface TranscriptLine {
  type?: string;
  sessionId?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export function defaultTranscriptRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

export function parseTranscriptFile(path: string): ParsedSession | null {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  let sessionId: string | null = null;
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreate = 0;
  let cacheRead = 0;
  let turns = 0;
  for (const raw of lines) {
    if (!raw) continue;
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(raw) as TranscriptLine;
    } catch {
      continue;
    }
    if (obj.sessionId && !sessionId) sessionId = obj.sessionId;
    if (obj.type === 'assistant' && obj.message?.usage) {
      turns++;
      const u = obj.message.usage;
      inputTokens += u.input_tokens ?? 0;
      outputTokens += u.output_tokens ?? 0;
      cacheCreate += u.cache_creation_input_tokens ?? 0;
      cacheRead += u.cache_read_input_tokens ?? 0;
      if (obj.message.model && obj.message.model.length > 0) model = obj.message.model;
    }
  }
  if (!sessionId) return null;
  const cost = computeCostUsd(model, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_tokens: cacheCreate,
    cache_read_tokens: cacheRead,
  });
  return {
    session_id: sessionId,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_tokens: cacheCreate,
    cache_read_tokens: cacheRead,
    assistant_turns: turns,
    cost_usd: cost,
    source_path: path,
  };
}

export interface ParseTreeOptions {
  root?: string;
  projectFilter?: string;          // exact directory name match under root
  modifiedAfterMs?: number;        // skip files older than this mtime
}

export function* walkTranscripts(opts: ParseTreeOptions = {}): Generator<string> {
  const root = opts.root ?? defaultTranscriptRoot();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (opts.projectFilter && entry !== opts.projectFilter) continue;
    const sub = join(root, entry);
    let stat;
    try {
      stat = statSync(sub);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = readdirSync(sub);
    } catch {
      continue;
    }
    for (const f of files) {
      if (extname(f) !== '.jsonl') continue;
      const p = join(sub, f);
      if (opts.modifiedAfterMs !== undefined) {
        try {
          if (statSync(p).mtimeMs < opts.modifiedAfterMs) continue;
        } catch {
          continue;
        }
      }
      yield p;
    }
  }
}

export interface IngestResult {
  scanned: number;
  parsed: number;
  upserted: number;
  total_cost_usd: number;
  errors: Array<{ path: string; error: string }>;
}
