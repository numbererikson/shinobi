import { stderr, stdout } from 'node:process';
import { upsertSessionCost } from '../models/session_costs.js';
import { parseTranscriptFile, walkTranscripts, type IngestResult } from '../services/cost/claude-code-parser.js';

export interface CostIngestOptions {
  source?: string;
  projectFilter?: string;
  sinceHours?: number;
  quiet?: boolean;
}

export function costIngest(options: CostIngestOptions = {}): IngestResult {
  const result: IngestResult = {
    scanned: 0,
    parsed: 0,
    upserted: 0,
    total_cost_usd: 0,
    errors: [],
  };
  const modifiedAfterMs =
    options.sinceHours !== undefined ? Date.now() - options.sinceHours * 3_600_000 : undefined;

  const walkOpts: Parameters<typeof walkTranscripts>[0] = {};
  if (options.source !== undefined) walkOpts.root = options.source;
  if (options.projectFilter !== undefined) walkOpts.projectFilter = options.projectFilter;
  if (modifiedAfterMs !== undefined) walkOpts.modifiedAfterMs = modifiedAfterMs;

  for (const path of walkTranscripts(walkOpts)) {
    result.scanned++;
    try {
      const parsed = parseTranscriptFile(path);
      if (!parsed) continue;
      result.parsed++;
      upsertSessionCost(parsed);
      result.upserted++;
      result.total_cost_usd += parsed.cost_usd;
    } catch (err) {
      result.errors.push({
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (!options.quiet) {
    stdout.write(
      `cost ingest: scanned=${result.scanned} parsed=${result.parsed} upserted=${result.upserted} total=$${result.total_cost_usd.toFixed(4)}\n`,
    );
    if (result.errors.length > 0) {
      stderr.write(`  errors (${result.errors.length}):\n`);
      for (const e of result.errors.slice(0, 5)) {
        stderr.write(`    ${e.path}: ${e.error}\n`);
      }
    }
  }
  return result;
}
