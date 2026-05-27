// Generates a weekly Markdown digest summarising what changed across all
// projects in a given window: completed subtasks, new decisions, new
// dead-ends, new plan versions. Defaults: last 7 days, all workspaces.

import { getDb } from '../../lib/db.js';

export interface DigestOptions {
  sinceIso?: string;
  untilIso?: string;
  workspace?: string;
}

export interface DigestSection<T> {
  count: number;
  items: T[];
}

export interface DigestData {
  since: string;
  until: string;
  workspace: string | 'all';
  projects: Array<{
    project_id: number;
    project_title: string;
    workspace: string | null;
    completed_subtasks: Array<{ id: number; title: string; updated_at: string }>;
    new_decisions: Array<{ id: number; summary: string; kind: string; created_at: string }>;
    new_dead_ends: Array<{ id: number; title: string; created_at: string }>;
    new_plan_versions: Array<{ id: number; version: number; created_at: string }>;
  }>;
  totals: {
    completed_subtasks: number;
    new_decisions: number;
    new_dead_ends: number;
    new_plan_versions: number;
    projects_touched: number;
  };
}

function defaultWindow(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    since: since.toISOString().slice(0, 19).replace('T', ' '),
    until: until.toISOString().slice(0, 19).replace('T', ' '),
  };
}

interface ProjectRow {
  id: number;
  title: string;
  workspace: string | null;
}

interface SubtaskRow {
  id: number;
  project_id: number;
  title: string;
  updated_at: string;
}

interface DecisionRow {
  id: number;
  project_id: number;
  summary: string;
  kind: string;
  created_at: string;
}

interface DeadEndRow {
  id: number;
  project_id: number;
  attempted_approach: string;
  created_at: string;
}

interface PlanRow {
  id: number;
  project_id: number;
  version: number;
  created_at: string;
}

export function collectDigestData(options: DigestOptions = {}): DigestData {
  const window = defaultWindow();
  const since = options.sinceIso ?? window.since;
  const until = options.untilIso ?? window.until;
  const db = getDb();

  const projectsSql = options.workspace
    ? 'SELECT id, title, workspace FROM projects WHERE archived_at IS NULL AND workspace = ?'
    : 'SELECT id, title, workspace FROM projects WHERE archived_at IS NULL';
  const projects = (options.workspace
    ? db.prepare<[string], ProjectRow>(projectsSql).all(options.workspace)
    : db.prepare<[], ProjectRow>(projectsSql).all()) as ProjectRow[];

  const subtasks = db
    .prepare<[string, string], SubtaskRow>(
      `SELECT id, project_id, title, updated_at FROM subtasks
       WHERE status = 'done' AND updated_at BETWEEN ? AND ?
       ORDER BY updated_at DESC`,
    )
    .all(since, until);
  const decisions = db
    .prepare<[string, string], DecisionRow>(
      `SELECT id, project_id, summary, kind, created_at FROM decisions
       WHERE created_at BETWEEN ? AND ?
       ORDER BY created_at DESC`,
    )
    .all(since, until);
  const deadEnds = db
    .prepare<[string, string], DeadEndRow>(
      `SELECT id, project_id, attempted_approach, created_at FROM dead_ends
       WHERE created_at BETWEEN ? AND ?
       ORDER BY created_at DESC`,
    )
    .all(since, until);
  const planVersions = db
    .prepare<[string, string], PlanRow>(
      `SELECT id, project_id, version, created_at FROM plans
       WHERE created_at BETWEEN ? AND ?
       ORDER BY created_at DESC`,
    )
    .all(since, until);

  const data: DigestData = {
    since,
    until,
    workspace: options.workspace ?? 'all',
    projects: [],
    totals: {
      completed_subtasks: subtasks.length,
      new_decisions: decisions.length,
      new_dead_ends: deadEnds.length,
      new_plan_versions: planVersions.length,
      projects_touched: 0,
    },
  };

  for (const project of projects) {
    const projSubtasks = subtasks.filter((s) => s.project_id === project.id);
    const projDecisions = decisions.filter((d) => d.project_id === project.id);
    const projDeadEnds = deadEnds.filter((d) => d.project_id === project.id);
    const projPlanVersions = planVersions.filter((p) => p.project_id === project.id);
    if (
      projSubtasks.length === 0 &&
      projDecisions.length === 0 &&
      projDeadEnds.length === 0 &&
      projPlanVersions.length === 0
    ) {
      continue;
    }
    data.projects.push({
      project_id: project.id,
      project_title: project.title,
      workspace: project.workspace,
      completed_subtasks: projSubtasks.map((s) => ({ id: s.id, title: s.title, updated_at: s.updated_at })),
      new_decisions: projDecisions.map((d) => ({ id: d.id, summary: d.summary, kind: d.kind, created_at: d.created_at })),
      new_dead_ends: projDeadEnds.map((d) => ({ id: d.id, title: d.attempted_approach.slice(0, 120), created_at: d.created_at })),
      new_plan_versions: projPlanVersions.map((p) => ({ id: p.id, version: p.version, created_at: p.created_at })),
    });
  }
  data.totals.projects_touched = data.projects.length;
  return data;
}

export function renderDigestMarkdown(data: DigestData): string {
  const lines: string[] = [];
  lines.push(`# Weekly digest — ${data.since.slice(0, 10)} → ${data.until.slice(0, 10)}`);
  lines.push('');
  lines.push(`Workspace: **${data.workspace}**`);
  lines.push('');
  lines.push(
    `**Totals:** ${data.totals.completed_subtasks} subtasks completed · ${data.totals.new_decisions} new decisions · ` +
      `${data.totals.new_dead_ends} dead ends · ${data.totals.new_plan_versions} plan versions · ` +
      `${data.totals.projects_touched} projects touched`,
  );
  lines.push('');
  if (data.projects.length === 0) {
    lines.push('_No activity in this window._');
    return lines.join('\n');
  }
  for (const project of data.projects) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${project.project_title}${project.workspace ? ` (${project.workspace})` : ''}`);
    lines.push('');
    if (project.completed_subtasks.length > 0) {
      lines.push(`### Completed (${project.completed_subtasks.length})`);
      for (const s of project.completed_subtasks) lines.push(`- #${s.id} ${s.title}`);
      lines.push('');
    }
    if (project.new_decisions.length > 0) {
      lines.push(`### New decisions (${project.new_decisions.length})`);
      for (const d of project.new_decisions) lines.push(`- _${d.kind}_ #${d.id} ${d.summary}`);
      lines.push('');
    }
    if (project.new_dead_ends.length > 0) {
      lines.push(`### New dead ends (${project.new_dead_ends.length})`);
      for (const d of project.new_dead_ends) lines.push(`- #${d.id} ${d.title}`);
      lines.push('');
    }
    if (project.new_plan_versions.length > 0) {
      lines.push(`### Plan revisions (${project.new_plan_versions.length})`);
      for (const p of project.new_plan_versions) lines.push(`- v${p.version} (plan #${p.id}) at ${p.created_at}`);
      lines.push('');
    }
  }
  return lines.join('\n').trim() + '\n';
}

export function isoWeekId(date = new Date()): string {
  // Returns "YYYY-WW" using ISO 8601 week numbering.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}
