// Smoke test for #173 — extract_decisions pipeline.
// Reads GROQ_API_KEY from shinobiapps .env (only for local smoke; production
// reads from process env or ~/.shinobi/.env), runs extraction on a sample
// transcript, persists drafts, verifies list_drafts works.

import { readFileSync } from 'node:fs';
import { closeDb } from '../src/lib/db.js';
import { applyPendingMigrations } from '../src/lib/migrations.js';
import { countDraftsByStatus, listDrafts } from '../src/models/decision_drafts.js';
import { listProjects } from '../src/models/projects.js';
import { extractDecisions } from '../src/services/extraction/decision-extractor.js';
import { createDraft } from '../src/models/decision_drafts.js';
import { createHash } from 'node:crypto';

function loadShinobiappsEnv(): void {
  if (process.env['GROQ_API_KEY']) return;
  try {
    const envText = readFileSync('c:/laragon/www/shinobiapps/app/config/.env', 'utf-8');
    for (const line of envText.split('\n')) {
      const match = /^(GROQ_API_KEY|OPENAI_API_KEY)=(.+)$/.exec(line.trim());
      if (match && !process.env[match[1]!]) {
        process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* ignore */
  }
}

loadShinobiappsEnv();
process.env['SHINOBI_LLM_PROVIDER'] = process.env['SHINOBI_LLM_PROVIDER'] ?? 'auto';

if (!process.env['GROQ_API_KEY'] && !process.env['OPENAI_API_KEY']) {
  console.error('FATAL: no GROQ_API_KEY or OPENAI_API_KEY; cannot smoke-test extraction.');
  process.exit(1);
}

applyPendingMigrations();

// Pick a real project to attach drafts to — use Shinobi v1.0 roadmap (#36) if present.
const allProjects = listProjects({ includeArchived: true });
const target =
  allProjects.find((p) => p.title.startsWith('Shinobi v1.0')) ?? allProjects[0];
if (!target) {
  console.error('FATAL: no projects exist; cannot attach drafts');
  process.exit(1);
}
console.log(`using project #${target.id}: ${target.title.slice(0, 60)}`);

const TRANSCRIPT = `
User: Need to pick a frontend stack for the dashboard rewrite. Current vanilla JS with Hono-served HTML strings is slowing feature dev.
Assistant: Three viable paths: keep vanilla but better-organised (htmx-style), Svelte, or React + shadcn. Each has tradeoffs.
User: Pool of contributors matters more than purity for us. Let's go React + shadcn. Vite build, Tailwind for styling.
Assistant: Agreed. Migrating all 9 views over 2 weeks. dnd-kit for Kanban drag-drop. Bundle target under 500KB gzipped.

Later in conversation...

User: For multi-agent sync, Cloudflare Worker free tier should cover us. Self-host as fallback for org-sensitive users.
Assistant: Confirmed. Cloudflare DurableObjects per project room, websocket broadcast on state diffs.
User: We tried mocking the relay locally for tests last week but it diverged from real CF behavior. Skip the mock, integration test against real CF dev env.
Assistant: Sounds right. CF wrangler dev gives us a local-but-real environment.

User: Embedding provider — what's our default for new installs?
Assistant: We have OpenAI, Voyage, Ollama. OpenAI requires paid key, Voyage has free tier but signup friction.
User: Default to Ollama, zero cost, local. Fallback chain to Voyage then OpenAI if user configures keys.
Assistant: Logged. nomic-embed-text as default model for Ollama (768 dims).

User: Files I'll touch: src/dashboard/server.ts for the API rewrite, src/dashboard/views.ts becomes deprecated, src/services/embedding/factory.ts for the fallback chain.
`;

console.log('\n--- calling extractDecisions ---');
const result = await extractDecisions(TRANSCRIPT);
console.log(`provider: ${result.provider}:${result.model}`);
console.log(`raw_length: ${result.raw_length}, truncated: ${result.truncated}`);
console.log(`decisions extracted: ${result.decisions.length}`);
console.log('');
for (const d of result.decisions) {
  console.log(`  [${d.kind}] ${d.summary}`);
  console.log(`    rationale: ${d.rationale}`);
  if (d.alternatives_considered) console.log(`    alternatives: ${d.alternatives_considered}`);
  if (d.files_touched) console.log(`    files: ${d.files_touched.join(', ')}`);
  console.log('');
}

if (result.decisions.length === 0) {
  console.error('FAIL: extraction returned 0 decisions; LLM/prompt issue');
  closeDb();
  process.exit(2);
}

const sourceHash = createHash('sha256').update(TRANSCRIPT).digest('hex').slice(0, 32);
console.log('\n--- persisting drafts ---');
const persisted = result.decisions.map((d) =>
  createDraft({
    project_id: target.id,
    session_id: 'smoke-extraction',
    kind: d.kind,
    summary: d.summary,
    rationale: d.rationale,
    alternatives_considered: d.alternatives_considered,
    files_touched: d.files_touched,
    source: 'extraction',
    extractor_model: `${result.provider}:${result.model}`,
    source_text_hash: sourceHash,
  }),
);
console.log(`persisted: ${persisted.length} drafts (ids ${persisted.map((p) => p.id).join(', ')})`);

console.log('\n--- list_drafts roundtrip ---');
const drafts = listDrafts({ projectId: target.id, status: 'pending', limit: 10 });
console.log(`pending drafts for project ${target.id}: ${drafts.length}`);
const counts = countDraftsByStatus(target.id);
console.log(`counts: ${JSON.stringify(counts)}`);

closeDb();
console.log('\nEXTRACTION SMOKE OK');
