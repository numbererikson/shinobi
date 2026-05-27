import { stderr } from 'node:process';
import { getDb } from '../../lib/db.js';
import { resolveEmbeddingProvider } from './factory.js';
import { pack, unpack, cosineSim } from './vector-math.js';
import type { EmbeddingProvider } from './types.js';

const EMBEDDABLE_TABLES = ['decisions', 'dead_ends', 'notes', 'subtasks'] as const;
export type EmbeddableTable = (typeof EMBEDDABLE_TABLES)[number];

// Cache the detection result for the lifetime of the process so we don't
// hit /api/tags on every embed call. Settings changes still require a
// restart (consistent with embedding settings being marked requiresRestart).
let cached: EmbeddingProvider | null = null;
let cacheResolved = false;

async function resolveProvider(): Promise<EmbeddingProvider | null> {
  if (cacheResolved) return cached;
  cached = await resolveEmbeddingProvider();
  cacheResolved = true;
  return cached;
}

export function resetProviderCacheForTests(): void {
  cached = null;
  cacheResolved = false;
}

export async function updateRowEmbedding(
  table: EmbeddableTable,
  id: number,
  text: string,
): Promise<{ provider: string; dimensions: number } | null> {
  const provider = await resolveProvider();
  if (!provider) return null;
  if (text.trim() === '') return null;

  let vec: Float32Array;
  try {
    vec = await provider.embed(text);
  } catch (err) {
    stderr.write(
      `shinobi embed: ${provider.name} failed for ${table}#${id}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }

  getDb()
    .prepare(
      `UPDATE ${table}
       SET embedding = ?, embedding_provider = ?, embedding_dims = ?
       WHERE id = ?`,
    )
    .run(pack(vec), provider.name, provider.dimensions, id);

  return { provider: provider.name, dimensions: provider.dimensions };
}

export interface SemanticHit<T> {
  row: T;
  score: number;
}

interface EmbeddedRow {
  id: number;
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_dims: number | null;
}

export async function semanticSearch<T extends EmbeddedRow>(
  table: EmbeddableTable,
  query: string,
  options: { projectId?: number; limit?: number; provider?: EmbeddingProvider } = {},
): Promise<SemanticHit<T>[]> {
  const provider = options.provider ?? (await resolveProvider());
  if (!provider) return [];

  let queryVec: Float32Array;
  try {
    queryVec = await provider.embed(query);
  } catch (err) {
    stderr.write(
      `shinobi embed: semantic search failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return [];
  }

  const params: unknown[] = [provider.name];
  let projectFilter = '';
  if (options.projectId !== undefined) {
    projectFilter = 'AND project_id = ?';
    params.push(options.projectId);
  }

  const rows = getDb()
    .prepare<unknown[], T>(
      `SELECT * FROM ${table}
       WHERE embedding IS NOT NULL
         AND embedding_provider = ?
         ${projectFilter}`,
    )
    .all(...params);

  const scored: SemanticHit<T>[] = rows.map((row) => {
    const buf = row.embedding;
    if (!buf) return { row, score: -Infinity };
    const vec = unpack(buf);
    if (vec.length !== queryVec.length) return { row, score: -Infinity };
    return { row, score: cosineSim(queryVec, vec) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options.limit ?? 10);
}
