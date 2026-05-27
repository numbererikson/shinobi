// Smoke test for #174 — session summary compression.
import { readFileSync } from 'node:fs';
import { closeDb } from '../src/lib/db.js';
import { applyPendingMigrations } from '../src/lib/migrations.js';
import { getProject } from '../src/models/projects.js';
import { persistSummary, summarizeProject } from '../src/services/extraction/session-summarizer.js';

function loadEnv(): void {
  if (process.env['GROQ_API_KEY']) return;
  try {
    const envText = readFileSync('c:/laragon/www/shinobiapps/app/config/.env', 'utf-8');
    for (const line of envText.split('\n')) {
      const m = /^(GROQ_API_KEY|OPENAI_API_KEY)=(.+)$/.exec(line.trim());
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ignore */
  }
}

loadEnv();
process.env['SHINOBI_LLM_PROVIDER'] = process.env['SHINOBI_LLM_PROVIDER'] ?? 'auto';
applyPendingMigrations();

const PROJECT_ID = 36;
const project = getProject(PROJECT_ID);
if (!project) throw new Error(`project ${PROJECT_ID} not found`);

console.log(`summarizing project #${PROJECT_ID}: ${project.title}`);
const before = {
  recent_summary_md: project.recent_summary_md,
  recent_summary_at: project.recent_summary_at,
};
console.log('before:', before);

const result = await summarizeProject({ projectId: PROJECT_ID });
console.log('\n--- LLM result ---');
console.log(`provider: ${result.provider}:${result.model}`);
console.log(`input_chars: ${result.input_chars}, truncated: ${result.truncated}`);
console.log(`summary length: ${result.summary.length} chars\n`);
console.log(result.summary);

persistSummary(PROJECT_ID, result.summary, `${result.provider}:${result.model}`);
console.log('\n--- after persist ---');
const after = getProject(PROJECT_ID);
console.log(`recent_summary_md set: ${after?.recent_summary_md !== null}`);
console.log(`recent_summary_at: ${after?.recent_summary_at}`);
console.log(`recent_summary_provider: ${after?.recent_summary_provider}`);

closeDb();
console.log('\nSUMMARIZER SMOKE OK');
