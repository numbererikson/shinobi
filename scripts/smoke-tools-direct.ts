import { applyPendingMigrations } from '../src/lib/migrations.js';
import { closeDb, getDb } from '../src/lib/db.js';
import { allTools, getTool, registerBuiltins } from '../src/server/tools/index.js';

applyPendingMigrations();
registerBuiltins();

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return await tool.handler(args);
}

const SECTION = (title: string): void => console.log(`\n=== ${title} ===`);

SECTION(`tool count`);
const tools = allTools();
console.log(`registered: ${tools.length}`);
console.log(`names: ${tools.map((t) => t.name).join(', ')}`);

SECTION('project CRUD');
const created = (await call('create_project', {
  title: 'Tool smoke project',
  description: 'Round-trip the registry',
  priority: 'high',
  target_path: 'src/',
})) as { id: number; title: string };
console.log('created', created.id, created.title);

const listed = (await call('list_projects', {})) as unknown[];
console.log('list count', listed.length);

const fetched = (await call('get_project', { project_id: created.id })) as { id: number; status: string };
console.log('get returns', fetched.id, fetched.status);

await call('update_project', { project_id: created.id, status: 'in_progress', priority: 'urgent' });
const refreshed = (await call('get_project', { project_id: created.id })) as { status: string; priority: string };
console.log('after update', refreshed.status, refreshed.priority);

SECTION('subtask flow');
const t1 = (await call('create_task', {
  project_id: created.id,
  title: 'Build the MCP server',
  priority: 'high',
  sort_order: 1,
})) as { id: number };
const t2 = (await call('create_task', {
  project_id: created.id,
  title: 'Ship npm package',
  priority: 'urgent',
  sort_order: 2,
  depends_on: [t1.id],
})) as { id: number };
console.log('subtasks', t1.id, t2.id);

const bulk = (await call('bulk_create_tasks', {
  project_id: created.id,
  tasks: [
    { title: 'Write docs', priority: 'medium' },
    { title: 'Record screencast', priority: 'low' },
  ],
})) as Array<{ id: number; title: string }>;
console.log('bulk created', bulk.map((b) => b.id));

const next1 = (await call('next_task', { project_id: created.id })) as {
  task: { id: number; title: string } | null;
  dead_end_warnings: unknown[];
};
console.log('next while t1 todo:', next1.task?.id, next1.task?.title);
if (next1.task?.id !== t1.id) throw new Error('expected t1 first by sort_order');

await call('claim_task', { subtask_id: t1.id, session_id: 'sess-mcp-smoke' });
await call('complete_task', { subtask_id: t1.id, session_id: 'sess-mcp-smoke' });
const next2 = (await call('next_task', { project_id: created.id })) as {
  task: { id: number } | null;
};
console.log('next after t1 done:', next2.task?.id);
if (next2.task?.id !== t2.id) throw new Error('expected t2 after t1 done');

const boot = (await call('agent_bootstrap', {
  project_id: created.id,
  task_id: t2.id,
  query: 'ship npm package',
  files: ['src/lib/db.ts'],
  session_id: 'sess-mcp-smoke',
  claim: true,
})) as {
  project: { id: number };
  task: { id: number; status: string } | null;
  claimed: boolean;
  summary_stale: boolean;
  summary_stale_hint: string | null;
  open_decisions: unknown[];
  recent_activity: unknown[];
};
console.log('bootstrap task:', boot.task?.id, 'claimed:', boot.claimed, 'summary_stale:', boot.summary_stale);
if (boot.project.id !== created.id || boot.task?.id !== t2.id || boot.claimed !== true) {
  throw new Error('agent_bootstrap did not return/claim the selected task');
}
if (boot.summary_stale !== true || typeof boot.summary_stale_hint !== 'string') {
  throw new Error('agent_bootstrap should flag a stale summary on a project with activity and no summary');
}

const fileCtx = (await call('file_context', {
  project_id: created.id,
  files: ['src/lib/db.ts'],
  query: 'work on sqlite storage',
  session_id: 'sess-mcp-smoke',
})) as {
  files: string[];
  file_context: Array<{ file: string; decisions: unknown[] }>;
};
console.log('file_context files:', fileCtx.files.length);
if (fileCtx.file_context.length !== 1 || fileCtx.file_context[0]?.file !== 'src/lib/db.ts') {
  throw new Error('file_context did not return expected file guardrail context');
}

SECTION('decisions + dead_ends + recall');
const dec = (await call('log_decision', {
  project_id: created.id,
  summary: 'Use better-sqlite3 over node:sqlite',
  rationale: 'Synchronous API matches MCP request lifecycle; native binding has prebuilts',
  files_touched: ['src/lib/db.ts'],
  tags: ['storage'],
  kind: 'library',
})) as { id: number };
console.log('decision id', dec.id);

SECTION('cross-device file path matching');
const decAbs = (await call('log_decision', {
  project_id: created.id,
  summary: 'Decision logged from a Windows laptop',
  rationale: 'files_touched arrives with an absolute laragon path; must match repo-relative lookups',
  files_touched: ['c:\\laragon\\www\\someapp\\app\\config\\routes.php'],
  kind: 'pattern',
})) as { id: number; files_touched: string[] | null };
if (decAbs.files_touched?.[0] !== 'app/config/routes.php') {
  throw new Error(`expected normalized files_touched, got ${JSON.stringify(decAbs.files_touched)}`);
}
const byRelative = (await call('decisions_for_file', {
  file_path: 'app/config/routes.php',
})) as Array<{ id: number }>;
if (!byRelative.some((d) => d.id === decAbs.id)) {
  throw new Error('decisions_for_file missed Windows-logged decision via repo-relative path');
}
const byOtherAbsolute = (await call('decisions_for_file', {
  file_path: '/home/user/someapp/app/config/routes.php',
})) as Array<{ id: number }>;
if (!byOtherAbsolute.some((d) => d.id === decAbs.id)) {
  throw new Error('decisions_for_file missed decision via cloud absolute path');
}
console.log('cross-device path match OK (windows write → relative + unix lookup)');

await call('log_dead_end', {
  project_id: created.id,
  attempted_approach: 'Mock SQLite with an in-memory fake',
  failure_reason: 'Fake diverged from real FTS5 semantics; tests passed but prod broke',
  files_involved: ['src/lib/db.ts'],
});

const check = (await call('check_dead_ends', {
  approach: 'mock SQLite for tests',
  files: ['src/lib/db.ts'],
  project_id: created.id,
})) as { count: number; verdict: string };
console.log('check_dead_ends', check.verdict, 'count', check.count);

const recall = (await call('recall', { query: 'sqlite', project_id: created.id })) as {
  decisions: unknown[];
  dead_ends: unknown[];
  notes: unknown[];
  subtasks: unknown[];
};
console.log('recall hits:', {
  decisions: recall.decisions.length,
  dead_ends: recall.dead_ends.length,
  notes: recall.notes.length,
  subtasks: recall.subtasks.length,
});

SECTION('notes + context + plans');
await call('add_note', {
  project_id: created.id,
  body: 'Remember to set foreign_keys=ON, default off in SQLite',
  tags: ['gotcha'],
});
const notes = (await call('list_notes', { project_id: created.id })) as unknown[];
console.log('notes count', notes.length);

await call('update_context', {
  project_id: created.id,
  conventions: 'Functional TS, no classes',
  dont_touch: ['migrations/0001_initial_schema.sql once applied'],
});
const ctx = (await call('get_context', { project_id: created.id })) as { conventions: string };
console.log('context conventions', ctx.conventions);

await call('save_plan', { project_id: created.id, plan_md: '# Plan v1\nDo it' });
await call('save_plan', { project_id: created.id, plan_md: '# Plan v2\nDo it better' });
const plan = (await call('get_plan', { project_id: created.id, include_history: true })) as {
  plan: { version: number };
  history: Array<{ version: number }>;
};
console.log('latest plan version', plan.plan.version, 'history versions', plan.history.map((h) => h.version));

const closeout = (await call('session_closeout', {
  project_id: created.id,
  session_id: 'sess-mcp-smoke',
  summary: 'Smoke session closeout summary',
  changed_files: ['src/server/tools/workflow.ts'],
  completed_task_ids: [bulk[0]!.id],
  decisions: [
    {
      summary: 'Closeout can create decisions',
      rationale: 'The session closeout tool should preserve architectural memory in the same call that records the session summary.',
      kind: 'pattern',
      tags: ['smoke'],
    },
  ],
  dead_ends: [
    {
      attempted_approach: 'Leave session summary only in chat',
      failure_reason: 'The next agent cannot reliably recover it from MCP recall.',
    },
  ],
  next_tasks: [
    {
      title: 'Follow up from closeout',
      priority: 'low',
      description: 'Created by session_closeout smoke test',
    },
  ],
})) as {
  note: { id: number };
  completed_tasks: Array<{ id: number } | null>;
  decisions: Array<{ id: number }>;
  dead_ends: Array<{ id: number }>;
  next_tasks: Array<{ id: number }>;
  compressed_summary: { provider: string } | null;
  summary_skip_reason: string | null;
  summary_fallback_persisted: boolean;
};
console.log(
  'closeout note:', closeout.note.id,
  'next tasks:', closeout.next_tasks.length,
  'summary:', closeout.compressed_summary ? closeout.compressed_summary.provider : `skipped (${closeout.summary_skip_reason})`,
);
if (
  closeout.completed_tasks.length !== 1 ||
  closeout.decisions.length !== 1 ||
  closeout.dead_ends.length !== 1 ||
  closeout.next_tasks.length !== 1
) {
  throw new Error('session_closeout did not create expected records');
}
if ((closeout.compressed_summary === null) === (closeout.summary_skip_reason === null)) {
  throw new Error('session_closeout must report either a compressed summary or a skip reason');
}
const afterCloseout = (await call('get_project', { project_id: created.id })) as {
  recent_summary_md: string | null;
  recent_summary_provider: string | null;
};
if (!afterCloseout.recent_summary_md) {
  throw new Error('recent_summary_md must be populated after closeout (LLM or agent fallback)');
}
if (closeout.summary_skip_reason !== null) {
  if (
    closeout.summary_fallback_persisted !== true ||
    afterCloseout.recent_summary_md !== 'Smoke session closeout summary' ||
    afterCloseout.recent_summary_provider !== 'agent:closeout'
  ) {
    throw new Error('without an LLM provider, closeout must persist the agent summary as recent_summary_md');
  }
}

SECTION('cleanup');
const del = (await call('delete_project', { project_id: created.id })) as { deleted: boolean };
console.log('deleted', del.deleted);
console.log(
  'remaining subtasks:',
  getDb().prepare('SELECT COUNT(*) AS n FROM subtasks WHERE project_id = ?').get(created.id),
);

closeDb();
console.log('\nALL OK');
