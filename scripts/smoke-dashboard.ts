import { setTimeout as delay } from 'node:timers/promises';
import { applyPendingMigrations } from '../src/lib/migrations.js';
import { closeDb } from '../src/lib/db.js';
import { createProject, deleteProject } from '../src/models/projects.js';
import { claimSubtask, createSubtask } from '../src/models/subtasks.js';
import { logDecision } from '../src/models/decisions.js';
import { logDeadEnd } from '../src/models/dead_ends.js';
import { addNote } from '../src/models/notes.js';
import { savePlan } from '../src/models/plans.js';
import { upsertContext } from '../src/models/context.js';
import { recordActivity } from '../src/models/activity.js';
import { closeSession, openSession } from '../src/models/sessions.js';
import { buildApp, startDashboard } from '../src/dashboard/server.js';

applyPendingMigrations();

const project = createProject({
  title: 'Dashboard smoke',
  description: 'Renders every dashboard view',
  priority: 'high',
  target_path: 'src/',
});

const t1 = createSubtask({ project_id: project.id, title: 'First task', priority: 'urgent', sort_order: 1 });
const t2 = createSubtask({ project_id: project.id, title: 'Second task', priority: 'medium', sort_order: 2, status: 'in_progress' });
createSubtask({ project_id: project.id, title: 'Third task', priority: 'low', status: 'done' });

logDecision({
  project_id: project.id,
  summary: 'Use SQLite over Postgres',
  rationale: 'Embedded, zero infra, FTS5 + JSON1 cover us',
  alternatives_considered: 'Postgres, DuckDB',
  files_touched: ['src/lib/db.ts'],
  tags: ['storage'],
  kind: 'architecture',
});

logDeadEnd({
  project_id: project.id,
  attempted_approach: 'Mocked DB in tests',
  failure_reason: 'Mocks diverged from real FTS5',
  files_involved: ['tests/integration.test.ts'],
});

addNote({
  project_id: project.id,
  body: 'Flaky test on Tuesday turned out to be timezone shift, not rate limiter.',
  tags: ['flaky', 'timezone'],
});

savePlan({ project_id: project.id, plan_md: '# Plan v1\nStep 1: schema\nStep 2: models\nStep 3: server' });
savePlan({ project_id: project.id, plan_md: '# Plan v2\nMore detail.' });

upsertContext(project.id, {
  conventions: 'TypeScript strict, functional models, no classes.',
  dont_touch: ['vendor/', 'legacy/'],
  test_patterns: 'vitest, in-memory SQLite',
  deploy_notes: 'npm pack, distribute as .tgz, install via npm install -g',
  file_annotations: { 'src/lib/db.ts': 'singleton; do not open second connection' },
});

const sessionId = 'sess-smoke';
openSession({ session_id: sessionId, project_id: project.id, subtask_id: t2.id });
claimSubtask(t2.id, sessionId);
recordActivity({
  project_id: project.id,
  session_id: sessionId,
  action_type: 'claim_task',
  action_details: 'Started task #2',
  entity_type: 'subtask',
  entity_id: t2.id,
});
recordActivity({
  project_id: project.id,
  session_id: sessionId,
  action_type: 'commit_path_matched',
  action_details: 'feat: dashboard ready',
  entity_type: 'commit',
  ref_url: 'abc1234567',
});
logDecision({
  project_id: project.id,
  summary: 'Use FTS5 for recall fallback',
  rationale: 'No external embedding provider needed for v0.1',
  kind: 'pattern',
  claude_session_id: sessionId,
});
logDeadEnd({
  project_id: project.id,
  attempted_approach: 'Skip session bookkeeping in agent_bootstrap',
  failure_reason: 'Without it the per-session view has nothing to group on',
  claude_session_id: sessionId,
});
addNote({
  project_id: project.id,
  body: 'Per-session view groups everything by claude_session_id',
  claude_session_id: sessionId,
});
closeSession(sessionId, 'smoke session closed');

void t1;

const server = await startDashboard({ port: 38765, host: '127.0.0.1' });
await delay(200);

async function fetchOk(path: string): Promise<{ status: number; bodySize: number; sample: string }> {
  const res = await fetch(`http://127.0.0.1:38765${path}`);
  const text = await res.text();
  return { status: res.status, bodySize: text.length, sample: text.slice(0, 80).replace(/\n/g, ' ') };
}

const routes = [
  '/',
  '/health',
  '/sessions',
  `/projects/${project.id}`,
  `/projects/${project.id}/subtasks`,
  `/projects/${project.id}/decisions`,
  `/projects/${project.id}/dead-ends`,
  `/projects/${project.id}/notes`,
  `/projects/${project.id}/plans`,
  `/projects/${project.id}/context`,
  `/projects/${project.id}/sessions`,
  `/projects/${project.id}/timeline`,
  `/projects/${project.id}/analytics`,
  `/sessions/${encodeURIComponent(sessionId)}`,
  `/api/projects/${project.id}/snapshot`,
];

let pass = 0;
for (const path of routes) {
  const r = await fetchOk(path);
  const ok = r.status === 200;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.status}  ${String(r.bodySize).padStart(6)} bytes  ${path}`);
  if (ok) pass++;
}

const patchRes = await fetch(`http://127.0.0.1:38765/api/subtasks/${t2.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'done' }),
});
console.log(`PATCH /api/subtasks/${t2.id} → ${patchRes.status}`);
if (patchRes.status === 200) pass++;

// /sessions/:id returns the SPA shell HTML — data loads client-side via the JSON APIs below.
const sessionDetail = await fetchOk(`/sessions/${encodeURIComponent(sessionId)}`);
const snapshotBody = await (await fetch(`http://127.0.0.1:38765/api/projects/${project.id}/snapshot`)).text();
const sessionApiBody = await (await fetch(`http://127.0.0.1:38765/api/sessions/${encodeURIComponent(sessionId)}`)).text();
let detailChecks = 0;
const detailExpectations: Array<[string, boolean]> = [
  ['decision summary present (snapshot)', snapshotBody.includes('Use FTS5 for recall fallback')],
  ['dead end approach present (snapshot)', snapshotBody.includes('Skip session bookkeeping')],
  ['note body present (snapshot)', snapshotBody.includes('Per-session view groups everything')],
  ['claimed subtask present (snapshot)', snapshotBody.includes('First task') || snapshotBody.includes('Second task')],
  ['activity action present (session API)', sessionApiBody.includes('claim_task')],
];
for (const [label, ok] of detailExpectations) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  session detail: ${label}`);
  if (ok) detailChecks++;
}
console.log(`/sessions/${sessionId} status=${sessionDetail.status} body=${sessionDetail.bodySize} bytes`);

console.log('\n--- auth middleware (in-process, no port) ---');
const AUTH_TOKEN = 'shinobi-test-token-do-not-use-irl-32bytes-min';
const authApp = buildApp({ enabled: true, token: AUTH_TOKEN, tokenPath: '~/.shinobi/dashboard-token' });
let authPass = 0;
const authExpectations: Array<[string, Response]> = [
  ['GET /health bypasses auth → 200', await authApp.fetch(new Request('http://localhost/health'))],
  ['GET / without auth → 401', await authApp.fetch(new Request('http://localhost/'))],
  ['GET / with wrong token → 401', await authApp.fetch(new Request('http://localhost/?token=wrong'))],
  [`GET /?token=VALID → 200`, await authApp.fetch(new Request(`http://localhost/?token=${AUTH_TOKEN}`))],
  ['GET / Bearer header → 200', await authApp.fetch(new Request('http://localhost/', { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }))],
  ['GET / X-Shinobi-Token header → 200', await authApp.fetch(new Request('http://localhost/', { headers: { 'X-Shinobi-Token': AUTH_TOKEN } }))],
  ['GET / cookie → 200', await authApp.fetch(new Request('http://localhost/', { headers: { Cookie: `shinobi_token=${AUTH_TOKEN}` } }))],
  ['DELETE /api/projects/1 without auth → 401', await authApp.fetch(new Request('http://localhost/api/projects/1', { method: 'DELETE' }))],
];
for (const [label, res] of authExpectations) {
  const expected = label.includes('200') ? 200 : 401;
  const ok = res.status === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  actual=${res.status}`);
  if (ok) authPass++;
}
const queryRes = await authApp.fetch(new Request(`http://localhost/?token=${AUTH_TOKEN}`));
const setCookie = queryRes.headers.get('set-cookie') ?? '';
const cookieOk = setCookie.includes('shinobi_token=');
console.log(`${cookieOk ? 'PASS' : 'FAIL'}  ?token= promotes to cookie  set-cookie="${setCookie.slice(0, 80)}…"`);
if (cookieOk) authPass++;

const totalExpected = routes.length + 1 + detailExpectations.length + authExpectations.length + 1;
const totalActual = pass + detailChecks + authPass;
console.log(`\n${totalActual}/${totalExpected} checks passed`);

server.close();
deleteProject(project.id);
closeDb();

if (totalActual !== totalExpected) {
  process.exit(1);
}
console.log('DASHBOARD SMOKE OK');
// Force clean exit — Hono server keep-alive connections can keep the event loop alive
// past server.close(), which would hang CI until the workflow timeout fires.
process.exit(0);
