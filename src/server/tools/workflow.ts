import { listActivity, recordActivity } from '../../models/activity.js';
import { getContext } from '../../models/context.js';
import { checkDeadEnds, logDeadEnd } from '../../models/dead_ends.js';
import { decisionsForFile, listDecisions, logDecision, type DecisionKind } from '../../models/decisions.js';
import { addNote } from '../../models/notes.js';
import { getLatestPlan, listPlanVersions, savePlan } from '../../models/plans.js';
import { getProject } from '../../models/projects.js';
import { bulkCreateSubtasks, claimSubtask, completeSubtask, getSubtask, nextTask, type CreateSubtaskInput } from '../../models/subtasks.js';
import { updateRowEmbedding } from '../../services/embedding/store.js';
import { persistSummary, summarizeProject } from '../../services/extraction/session-summarizer.js';
import { getBoolean, getNumber, getNumberArray, getString, getStringArray, requireNumber, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

const DECISION_KINDS = ['architecture', 'library', 'pattern', 'tradeoff', 'workaround', 'other'] as const;

function objectArray(args: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const raw = args[name];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`Argument '${name}' must be an array of objects`);
  return raw.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Argument '${name}[${index}]' must be an object`);
    }
    return item as Record<string, unknown>;
  });
}

function optionalStringArray(row: Record<string, unknown>, name: string): string[] | undefined {
  const value = row[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`Argument '${name}' must be an array of strings`);
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error(`Argument '${name}' must contain strings only`);
    return item;
  });
}

function optionalString(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Argument '${name}' must be a string`);
  return value;
}

function requiredString(row: Record<string, unknown>, name: string): string {
  const value = optionalString(row, name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

export const workflowTools: ShinobiTool[] = [
  {
    name: 'agent_bootstrap',
    description:
      'Start an agent work session for a project. Returns project context, latest plan, selected/next task, open decisions, relevant dead ends, recent activity, and file-specific decisions. Optionally claims the task.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        task_id: { type: 'integer', description: 'Specific task to work on. Omit to use next_task.' },
        query: { type: 'string', description: 'Optional work description used for dead-end matching.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Optional files expected to be touched.' },
        session_id: { type: 'string' },
        claim: { type: 'boolean', default: false, description: 'When true, claim the selected task for session_id.' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const projectId = requireNumber(args, 'project_id');
      const sessionId = getString(args, 'session_id');
      const limit = getNumber(args, 'limit') ?? 10;
      const files = getStringArray(args, 'files') ?? [];
      const project = getProject(projectId);
      if (!project) throw new Error(`project not found: ${projectId}`);

      const explicitTaskId = getNumber(args, 'task_id');
      const selectedTask = explicitTaskId !== undefined ? getSubtask(explicitTaskId) : nextTask({ projectId });
      if (explicitTaskId !== undefined && !selectedTask) {
        throw new Error(`task not found: ${explicitTaskId}`);
      }
      if (selectedTask && selectedTask.project_id !== null && selectedTask.project_id !== projectId) {
        throw new Error(`task ${selectedTask.id} does not belong to project ${projectId}`);
      }

      let task = selectedTask;
      const shouldClaim = getBoolean(args, 'claim') === true;
      if (shouldClaim) {
        if (!task) throw new Error('cannot claim: no selected or next task');
        if (!sessionId) throw new Error('session_id is required when claim=true');
        const claimedTask = claimSubtask(task.id, sessionId);
        if (!claimedTask) throw new Error(`failed to claim task: ${task.id}`);
        task = claimedTask;
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'agent_bootstrap_claim',
          action_details: task?.title ?? `task ${selectedTask?.id}`,
          entity_type: 'subtask',
          entity_id: task?.id ?? selectedTask?.id ?? null,
        });
      } else {
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'agent_bootstrap',
          action_details: task ? task.title : 'no task selected',
          entity_type: task ? 'subtask' : 'project',
          entity_id: task?.id ?? projectId,
        });
      }

      const query =
        getString(args, 'query') ??
        (task ? `${task.title}\n${task.description ?? ''}`.trim() : project.title);

      const fileDecisions = files.map((file) => ({
        file,
        decisions: decisionsForFile(file, limit),
      }));

      return {
        project,
        session_id: sessionId ?? null,
        task,
        claimed: shouldClaim && task !== null,
        recent_summary: project.recent_summary_md
          ? {
              md: project.recent_summary_md,
              generated_at: project.recent_summary_at,
              provider: project.recent_summary_provider,
            }
          : null,
        context: getContext(projectId),
        latest_plan: getLatestPlan(projectId),
        plan_history: listPlanVersions(projectId).slice(0, limit),
        open_decisions: listDecisions({ projectId, status: 'open', limit }),
        relevant_dead_ends: checkDeadEnds({ projectId, approach: query, files, limit }),
        file_decisions: fileDecisions,
        recent_activity: listActivity({ projectId, limit }),
        next_action: task
          ? 'Work the selected task. Read recent_summary for last-session context, check relevant_dead_ends and file_decisions before editing, then complete or update the task at closeout.'
          : 'No available task was selected. Create a task or pass task_id/query for focused work.',
      };
    },
  },
  {
    name: 'session_closeout',
    description:
      'Finish an agent work session in one call. Records summary, changed files, completed tasks, decisions, dead ends, optional plan snapshot, and follow-up tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        session_id: { type: 'string' },
        summary: { type: 'string' },
        completed_task_ids: { type: 'array', items: { type: 'integer' } },
        changed_files: { type: 'array', items: { type: 'string' } },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              rationale: { type: 'string' },
              kind: { type: 'string', enum: [...DECISION_KINDS] },
              alternatives_considered: { type: 'string' },
              files_touched: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['summary', 'rationale'],
          },
        },
        dead_ends: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              attempted_approach: { type: 'string' },
              failure_reason: { type: 'string' },
              files_involved: { type: 'array', items: { type: 'string' } },
              never_retry: { type: 'boolean' },
            },
            required: ['attempted_approach', 'failure_reason'],
          },
        },
        next_tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              due_date: { type: 'string' },
            },
            required: ['title'],
          },
        },
        plan_md: { type: 'string' },
      },
      required: ['project_id', 'summary'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const projectId = requireNumber(args, 'project_id');
      const project = getProject(projectId);
      if (!project) throw new Error(`project not found: ${projectId}`);

      const sessionId = getString(args, 'session_id');
      const summary = requireString(args, 'summary');
      const changedFiles = getStringArray(args, 'changed_files') ?? [];
      const completedTaskIds = getNumberArray(args, 'completed_task_ids') ?? [];
      const completedTasks = completedTaskIds.map((id) => {
        const task = getSubtask(id);
        if (!task) throw new Error(`task not found: ${id}`);
        if (task.project_id !== null && task.project_id !== projectId) {
          throw new Error(`task ${id} does not belong to project ${projectId}`);
        }
        const completed = completeSubtask(id);
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'complete_task',
          action_details: summary,
          entity_type: 'subtask',
          entity_id: id,
        });
        return completed;
      });

      const note = addNote({
        project_id: projectId,
        body: summary,
        tags: ['session-closeout'],
        files_touched: changedFiles,
        claude_session_id: sessionId,
      });
      await updateRowEmbedding('notes', note.id, note.body);
      recordActivity({
        project_id: projectId,
        session_id: sessionId,
        action_type: 'session_closeout',
        action_details: summary.slice(0, 200),
        entity_type: 'note',
        entity_id: note.id,
      });

      const decisions = [];
      for (const row of objectArray(args, 'decisions')) {
        const kind = optionalString(row, 'kind');
        if (kind && !DECISION_KINDS.includes(kind as DecisionKind)) {
          throw new Error(`invalid decision kind: ${kind}`);
        }
        const decision = logDecision({
          project_id: projectId,
          summary: requiredString(row, 'summary'),
          rationale: requiredString(row, 'rationale'),
          alternatives_considered: optionalString(row, 'alternatives_considered'),
          files_touched: optionalStringArray(row, 'files_touched') ?? changedFiles,
          tags: optionalStringArray(row, 'tags'),
          kind: kind as DecisionKind | undefined,
          claude_session_id: sessionId,
        });
        await updateRowEmbedding(
          'decisions',
          decision.id,
          [decision.summary, decision.rationale, decision.alternatives_considered].filter(Boolean).join('\n'),
        );
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'log_decision',
          action_details: decision.summary,
          entity_type: 'decision',
          entity_id: decision.id,
        });
        decisions.push(decision);
      }

      const deadEnds = [];
      for (const row of objectArray(args, 'dead_ends')) {
        const dead = logDeadEnd({
          project_id: projectId,
          attempted_approach: requiredString(row, 'attempted_approach'),
          failure_reason: requiredString(row, 'failure_reason'),
          files_involved: optionalStringArray(row, 'files_involved') ?? changedFiles,
          never_retry: row['never_retry'] === true,
          claude_session_id: sessionId,
        });
        await updateRowEmbedding('dead_ends', dead.id, `${dead.attempted_approach}\n${dead.failure_reason}`);
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'log_dead_end',
          action_details: dead.attempted_approach.slice(0, 200),
          entity_type: 'dead_end',
          entity_id: dead.id,
        });
        deadEnds.push(dead);
      }

      const nextTaskInputs: CreateSubtaskInput[] = objectArray(args, 'next_tasks').map((row, index) => ({
        project_id: projectId,
        title: requiredString(row, 'title'),
        description: optionalString(row, 'description'),
        priority: optionalString(row, 'priority') as CreateSubtaskInput['priority'],
        due_date: optionalString(row, 'due_date'),
        sort_order: index,
      }));
      const nextTasks = bulkCreateSubtasks(nextTaskInputs);
      for (const task of nextTasks) {
        await updateRowEmbedding('subtasks', task.id, [task.title, task.description].filter(Boolean).join('\n'));
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'create_task',
          action_details: task.title,
          entity_type: 'subtask',
          entity_id: task.id,
        });
      }

      const planText = getString(args, 'plan_md');
      const plan = planText
        ? savePlan({ project_id: projectId, plan_md: planText, claude_session_id: sessionId })
        : null;
      if (plan) {
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'save_plan',
          action_details: `v${plan.version} (${plan.plan_md.length} chars)`,
          entity_type: 'plan',
          entity_id: plan.id,
        });
      }

      // Best-effort summary compression on closeout. Never blocks closeout.
      let compressed: { provider: string; model: string; chars: number } | null = null;
      try {
        const summaryResult = await summarizeProject({ projectId });
        persistSummary(projectId, summaryResult.summary, `${summaryResult.provider}:${summaryResult.model}`);
        compressed = {
          provider: summaryResult.provider,
          model: summaryResult.model,
          chars: summaryResult.summary.length,
        };
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'compress_session_summary',
          action_details: `auto via session_closeout (${compressed.chars} chars, ${compressed.provider}:${compressed.model})`,
          entity_type: 'project',
          entity_id: projectId,
        });
      } catch (err) {
        // LLM unconfigured or transient failure — log to stderr but don't fail closeout.
        process.stderr.write(
          `session_closeout: summary skipped: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }

      return {
        project,
        session_id: sessionId ?? null,
        note,
        completed_tasks: completedTasks,
        decisions,
        dead_ends: deadEnds,
        next_tasks: nextTasks,
        plan,
        compressed_summary: compressed,
      };
    },
  },
  {
    name: 'file_context',
    description:
      'Return guardrail context for files an agent is about to inspect or edit: project context annotations, decisions for each file, relevant dead ends, and recent activity.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        files: { type: 'array', items: { type: 'string' } },
        query: { type: 'string', description: 'Optional planned work description for dead-end matching.' },
        session_id: { type: 'string' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['project_id', 'files'],
      additionalProperties: false,
    },
    handler: (args) => {
      const projectId = requireNumber(args, 'project_id');
      const project = getProject(projectId);
      if (!project) throw new Error(`project not found: ${projectId}`);
      const files = getStringArray(args, 'files') ?? [];
      if (files.length === 0) throw new Error("Argument 'files' must contain at least one path");
      const limit = getNumber(args, 'limit') ?? 10;
      const sessionId = getString(args, 'session_id');
      const context = getContext(projectId);
      const annotations = context?.file_annotations ?? null;
      const query = getString(args, 'query') ?? files.join('\n');

      const file_context = files.map((file) => ({
        file,
        annotation: annotations?.[file] ?? null,
        decisions: decisionsForFile(file, limit),
      }));

      const relevantDeadEnds = checkDeadEnds({
        projectId,
        approach: query,
        files,
        limit,
      });

      const recentActivity = listActivity({ projectId, limit }).filter((activity) => {
        const haystack = [
          activity.action_details,
          activity.ref_url,
          activity.entity_type ? `${activity.entity_type}#${activity.entity_id ?? ''}` : null,
        ]
          .filter((value): value is string => typeof value === 'string')
          .join('\n');
        return files.some((file) => haystack.includes(file));
      });

      recordActivity({
        project_id: projectId,
        session_id: sessionId,
        action_type: 'file_context',
        action_details: files.join(', ').slice(0, 200),
        entity_type: 'project',
        entity_id: projectId,
      });

      return {
        project,
        files,
        context,
        file_context,
        relevant_dead_ends: relevantDeadEnds,
        recent_file_activity: recentActivity,
        next_action:
          'Review annotations, decisions, and dead ends before editing these files. Log a decision or dead end if this work reveals new durable context.',
      };
    },
  },
];
