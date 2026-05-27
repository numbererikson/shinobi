import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stderr, stdout } from 'node:process';
import { collectDigestData, isoWeekId, renderDigestMarkdown } from '../services/digest/generator.js';
import { sendTelegramMessage } from '../services/digest/telegram.js';

export interface DigestCommandOptions {
  workspace?: string;
  sinceIso?: string;
  untilIso?: string;
  out?: string;
  noWrite?: boolean;
  telegram?: boolean;
  quiet?: boolean;
}

export function digestsDir(): string {
  const override = process.env['SHINOBI_DIGESTS_DIR'];
  if (override && override.length > 0) return override;
  return join(homedir(), '.shinobi', 'digests');
}

export interface DigestRunResult {
  markdown: string;
  saved_path: string | null;
  telegram?: { ok: boolean; chunks_sent: number; chunks_total: number; error?: string };
  totals: ReturnType<typeof collectDigestData>['totals'];
}

export async function runDigest(options: DigestCommandOptions = {}): Promise<DigestRunResult> {
  const collectOptions: Parameters<typeof collectDigestData>[0] = {};
  if (options.sinceIso !== undefined) collectOptions.sinceIso = options.sinceIso;
  if (options.untilIso !== undefined) collectOptions.untilIso = options.untilIso;
  if (options.workspace !== undefined) collectOptions.workspace = options.workspace;
  const data = collectDigestData(collectOptions);
  const markdown = renderDigestMarkdown(data);

  let savedPath: string | null = null;
  if (!options.noWrite) {
    const dir = digestsDir();
    mkdirSync(dir, { recursive: true });
    const baseName = options.workspace ? `${isoWeekId()}--${options.workspace}.md` : `${isoWeekId()}.md`;
    savedPath = options.out ?? join(dir, baseName);
    writeFileSync(savedPath, markdown, 'utf-8');
    if (!options.quiet) stdout.write(`digest written: ${savedPath}\n`);
  }

  const result: DigestRunResult = {
    markdown,
    saved_path: savedPath,
    totals: data.totals,
  };
  if (options.telegram) {
    const tg = await sendTelegramMessage(markdown);
    result.telegram = tg;
    if (!options.quiet) {
      if (tg.ok) stdout.write(`telegram: sent ${tg.chunks_sent}/${tg.chunks_total} chunks\n`);
      else stderr.write(`telegram: failed (${tg.error})\n`);
    }
  }
  return result;
}

export interface SavedDigest {
  file: string;
  size_bytes: number;
}

export function listSavedDigests(): SavedDigest[] {
  const dir = digestsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => {
      const stat = statSync(join(dir, f));
      return { file: f, size_bytes: stat.size };
    });
}
