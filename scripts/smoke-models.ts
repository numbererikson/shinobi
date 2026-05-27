import { applyPendingMigrations } from '../src/lib/migrations.js';
import { closeDb, getDb } from '../src/lib/db.js';
import { createProject, getProject, listProjects, updateProject } from '../src/models/projects.js';
import {
  bulkCreateSubtasks,
  claimSubtask,
  completeSubtask,
  createSubtask,
  listSubtasks,
  nextTask,
  searchSubtasks,
  updateSubtask,
} from '../src/models/subtasks.js';
import { closeSession, openSession } from '../src/models/sessions.js';
import { listDecisions, logDecision, searchDecisions } from '../src/models/decisions.js';
import { checkDeadEnds, logDeadEnd } from '../src/models/dead_ends.js';
import { addNote, searchNotes } from '../src/models/notes.js';
import { getLatestPlan, listPlanVersions, savePlan } from '../src/models/plans.js';
import { getContext, upsertContext } from '../src/models/context.js';

const SECTION = (title: string): void => {
  console.log(`\n=== ${title} ===`);
};

applyPendingMigrations();

SECTION('projects');
const p = createProject({
  title: 'Smoke project',
  description: 'Models exercise',
  priority: 'high',
  target_path: 'src/',
});
console.log('created project', p.id, p.title, p.status, p.priority);
console.log('list count', listProjects().length);
const pUpdated = updateProject(p.id, { description: 'Updated description', priority: 'urgent' });
console.log('updated priority', pUpdated?.priority);

SECTION('subtasks');
const s1 = createSubtask({ project_id: p.id, title: 'First task', priority: 'high', sort_order: 1 });
const s2 = createSubtask({
  project_id: p.id,
  title: 'Second task depending on first',
  priority: 'urgent',
  sort_order: 2,
  depends_on: [s1.id],
});
console.log('subtasks created', s1.id, s2.id, 'deps on s2', s2.depends_on);

const bulk = bulkCreateSubtasks([
  { project_id: p.id, title: 'Bulk one' },
  { project_id: p.id, title: 'Bulk two', priority: 'low' },
]);
console.log('bulk created', bulk.map((b) => b.id));

const next1 = nextTask({ projectId: p.id });
console.log('nextTask while s1=todo:', next1?.id, next1?.title);
if (next1?.id !== s1.id) throw new Error('expected s1 first');

claimSubtask(s1.id, 'sess-smoke-1');
completeSubtask(s1.id);
const next2 = nextTask({ projectId: p.id });
console.log('nextTask after s1 done:', next2?.id, next2?.title);
if (next2?.id !== s2.id) throw new Error('expected s2 after s1 done (priority urgent)');

const searchHits = searchSubtasks('depending', p.id);
console.log('subtask FTS hits:', searchHits.map((s) => s.id));

try {
  updateSubtask(s2.id, { depends_on: [s2.id] });
  throw new Error('expected circular dep rejection');
} catch (err) {
  console.log('circular dep correctly rejected:', err instanceof Error ? err.message : err);
}

SECTION('sessions');
const sess = openSession({ session_id: 'sess-smoke-1', project_id: p.id, subtask_id: s1.id, notes: 'opening' });
console.log('session opened', sess.session_id, sess.started_at);
const closed = closeSession('sess-smoke-1', 'wrapping up');
console.log('session closed, duration:', closed?.duration_seconds, 'notes:', closed?.notes);

SECTION('decisions');
const d = logDecision({
  project_id: p.id,
  summary: 'Use SQLite for storage',
  rationale: 'Embedded, zero infra, FTS5 available',
  alternatives_considered: 'Postgres, DuckDB',
  files_touched: ['src/lib/db.ts'],
  tags: ['storage', 'architecture'],
  kind: 'architecture',
});
console.log('decision id', d.id, 'tags', d.tags, 'files', d.files_touched);
console.log('search decisions for "SQLite":', searchDecisions('SQLite', p.id).length);
console.log('list decisions:', listDecisions({ projectId: p.id }).length);

SECTION('dead_ends');
const de = logDeadEnd({
  project_id: p.id,
  attempted_approach: 'Mock the database with a fake',
  failure_reason: 'Production migration diverged from mocks',
  files_involved: ['tests/integration.test.ts'],
});
console.log('dead_end id', de.id, 'files', de.files_involved);
const matches = checkDeadEnds({
  approach: 'mock the database',
  files: ['tests/integration.test.ts'],
  projectId: p.id,
});
console.log('check_dead_ends matches:', matches.map((m) => m.id));

SECTION('notes');
const note = addNote({
  project_id: p.id,
  body: 'Remember: flaky test on Tuesday is the timezone issue, not the rate limiter',
  tags: ['flaky', 'timezone'],
});
console.log('note id', note.id, 'tags', note.tags);
console.log('search notes for "timezone":', searchNotes('timezone', p.id).length);

SECTION('plans');
const v1 = savePlan({ project_id: p.id, plan_md: '# Plan v1\nStep one.' });
const v2 = savePlan({ project_id: p.id, plan_md: '# Plan v2\nStep one\nStep two.' });
console.log('plans saved v1.version=', v1.version, 'v2.version=', v2.version);
console.log('latest plan version:', getLatestPlan(p.id)?.version);
console.log('all versions:', listPlanVersions(p.id).map((pv) => pv.version));

SECTION('context');
upsertContext(p.id, {
  conventions: 'Use TypeScript strict mode.',
  dont_touch: ['vendor/', 'legacy/'],
  test_patterns: 'vitest, in-memory SQLite',
});
const ctx1 = getContext(p.id);
console.log('context after first upsert:', ctx1?.dont_touch, ctx1?.test_patterns);
upsertContext(p.id, { deploy_notes: 'Cron is fine; manual fallback documented.' });
const ctx2 = getContext(p.id);
console.log('context after patch (preserves prior):', ctx2?.dont_touch, ctx2?.deploy_notes);

SECTION('cleanup');
getDb().prepare('DELETE FROM projects WHERE id = ?').run(p.id);
console.log('subtasks after FK cascade:', getDb().prepare('SELECT COUNT(*) AS n FROM subtasks WHERE project_id = ?').get(p.id));
console.log('decisions after FK cascade:', getDb().prepare('SELECT COUNT(*) AS n FROM decisions WHERE project_id = ?').get(p.id));
console.log('plans after FK cascade:', getDb().prepare('SELECT COUNT(*) AS n FROM plans WHERE project_id = ?').get(p.id));

closeDb();
console.log('\nALL OK');
