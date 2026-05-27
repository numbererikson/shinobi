import { recordActivity } from '../../models/activity.js';
import { checkDeadEnds } from '../../models/dead_ends.js';
import type { Priority, Status } from '../../models/projects.js';
import {
  bulkCreateSubtasks,
  claimSubtask,
  completeSubtask,
  createSubtask,
  deleteSubtask,
  getSubtask,
  listSubtasks,
  nextTask,
  updateSubtask,
  type CreateSubtaskInput,
} from '../../models/subtasks.js';
import { updateRowEmbedding } from '../../services/embedding/store.js';
import {
  getNumber,
  getNumberArray,
  getString,
  getStringArray,
  requireNumber,
  requireString,
} from './args.js';
import type { ShinobiTool } from './types.js';

const STATUS_ENUM = ['todo', 'in_progress', 'done'] as const;
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent'] as const;

function buildEmbedText(title: string, description: string | null): string {
  return description ? `${title}\n${description}` : title;
}

function coerceCreateInput(raw: Record<string, unknown>, index = 0): CreateSubtaskInput {
  return {
    project_id: getNumber(raw, 'project_id') ?? null,
    title: requireString(raw, 'title'),
    description: getString(raw, 'description'),
    depends_on: getNumberArray(raw, 'depends_on'),
    sort_order: getNumber(raw, 'sort_order') ?? index,
    status: getString(raw, 'status') as Status | undefined,
    priority: getString(raw, 'priority') as Priority | undefined,
    due_date: getString(raw, 'due_date'),
  };
}

export const subtaskTools: ShinobiTool[] = [
  {
    name: 'list_tasks',
    description: 'List subtasks. Filter by project_id, status, or claude session id.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        session_id: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: (args) =>
      listSubtasks({
        projectId: getNumber(args, 'project_id'),
        status: getString(args, 'status') as Status | undefined,
        sessionId: getString(args, 'session_id'),
      }),
  },
  {
    name: 'get_task',
    description: 'Get a single subtask by id.',
    inputSchema: {
      type: 'object',
      properties: { subtask_id: { type: 'integer' } },
      required: ['subtask_id'],
      additionalProperties: false,
    },
    handler: (args) => getSubtask(requireNumber(args, 'subtask_id')),
  },
  {
    name: 'create_task',
    description: 'Create a subtask. project_id is optional (null = unrouted inbox task). Title+description are embedded for semantic recall when SHINOBI_EMBED_PROVIDER is configured.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        depends_on: { type: 'array', items: { type: 'integer' } },
        sort_order: { type: 'integer' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        priority: { type: 'string', enum: [...PRIORITY_ENUM] },
        due_date: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const subtask = createSubtask(coerceCreateInput(args));
      await updateRowEmbedding('subtasks', subtask.id, buildEmbedText(subtask.title, subtask.description));
      recordActivity({
        project_id: subtask.project_id,
        session_id: getString(args, 'session_id'),
        action_type: 'create_task',
        action_details: subtask.title,
        entity_type: 'subtask',
        entity_id: subtask.id,
      });
      return subtask;
    },
  },
  {
    name: 'bulk_create_tasks',
    description: 'Create multiple subtasks in a single transaction. Useful when seeding a project plan.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              depends_on: { type: 'array', items: { type: 'integer' } },
              sort_order: { type: 'integer' },
              priority: { type: 'string', enum: [...PRIORITY_ENUM] },
              due_date: { type: 'string' },
            },
            required: ['title'],
          },
        },
        session_id: { type: 'string' },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const sharedProject = getNumber(args, 'project_id');
      const tasksRaw = args['tasks'];
      if (!Array.isArray(tasksRaw)) throw new Error("Argument 'tasks' must be an array");
      const inputs: CreateSubtaskInput[] = tasksRaw.map((raw, index) => {
        if (typeof raw !== 'object' || raw === null) {
          throw new Error(`tasks[${index}] must be an object`);
        }
        const row = raw as Record<string, unknown>;
        const projectId = getNumber(row, 'project_id') ?? sharedProject ?? null;
        return {
          project_id: projectId,
          title: requireString(row, 'title'),
          description: getString(row, 'description'),
          depends_on: getNumberArray(row, 'depends_on'),
          sort_order: getNumber(row, 'sort_order') ?? index,
          status: getString(row, 'status') as Status | undefined,
          priority: getString(row, 'priority') as Priority | undefined,
          due_date: getString(row, 'due_date'),
        };
      });
      const created = bulkCreateSubtasks(inputs);
      for (const subtask of created) {
        await updateRowEmbedding('subtasks', subtask.id, buildEmbedText(subtask.title, subtask.description));
        recordActivity({
          project_id: subtask.project_id,
          session_id: getString(args, 'session_id'),
          action_type: 'create_task',
          action_details: subtask.title,
          entity_type: 'subtask',
          entity_id: subtask.id,
        });
      }
      return created;
    },
  },
  {
    name: 'update_subtask',
    description: 'Patch a subtask. Rejects circular dependencies. Use status="todo" to reset an in-progress task.',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'integer' },
        project_id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        depends_on: { type: 'array', items: { type: 'integer' } },
        sort_order: { type: 'integer' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        priority: { type: 'string', enum: [...PRIORITY_ENUM] },
        due_date: { type: 'string' },
        files_touched: { type: 'array', items: { type: 'string' } },
        session_id: { type: 'string' },
      },
      required: ['subtask_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const id = requireNumber(args, 'subtask_id');
      const patch: Record<string, unknown> = {};
      for (const key of ['project_id', 'title', 'description', 'sort_order', 'status', 'priority', 'due_date']) {
        if (key in args) patch[key] = args[key];
      }
      if ('depends_on' in args) patch['depends_on'] = getNumberArray(args, 'depends_on');
      if ('files_touched' in args) patch['files_touched'] = getStringArray(args, 'files_touched');
      const updated = updateSubtask(id, patch);
      if (updated) {
        if ('title' in args || 'description' in args) {
          await updateRowEmbedding('subtasks', updated.id, buildEmbedText(updated.title, updated.description));
        }
        recordActivity({
          project_id: updated.project_id,
          session_id: getString(args, 'session_id'),
          action_type: 'update_subtask',
          action_details: `status=${updated.status} priority=${updated.priority}`,
          entity_type: 'subtask',
          entity_id: updated.id,
        });
      }
      return updated;
    },
  },
  {
    name: 'delete_subtask',
    description: 'Permanently delete a subtask.',
    inputSchema: {
      type: 'object',
      properties: { subtask_id: { type: 'integer' }, session_id: { type: 'string' } },
      required: ['subtask_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'subtask_id');
      const existing = getSubtask(id);
      const deleted = deleteSubtask(id);
      if (deleted && existing) {
        recordActivity({
          project_id: existing.project_id,
          session_id: getString(args, 'session_id'),
          action_type: 'delete_subtask',
          action_details: existing.title,
          entity_type: 'subtask',
          entity_id: id,
        });
      }
      return { deleted };
    },
  },
  {
    name: 'claim_task',
    description: 'Mark a subtask as in_progress and link the current session. Call BEFORE starting work so resume knows where you left off.',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'integer' },
        session_id: { type: 'string' },
      },
      required: ['subtask_id', 'session_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'subtask_id');
      const sessionId = requireString(args, 'session_id');
      const claimed = claimSubtask(id, sessionId);
      if (claimed) {
        recordActivity({
          project_id: claimed.project_id,
          session_id: sessionId,
          action_type: 'claim_task',
          action_details: claimed.title,
          entity_type: 'subtask',
          entity_id: id,
        });
      }
      return { claimed: claimed !== null, subtask_id: id, session_id: sessionId, subtask: claimed };
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a subtask as done. Optionally pass a summary that will be attached to the linked session.',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'integer' },
        session_id: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['subtask_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'subtask_id');
      const completed = completeSubtask(id);
      if (completed) {
        recordActivity({
          project_id: completed.project_id,
          session_id: getString(args, 'session_id'),
          action_type: 'complete_task',
          action_details: getString(args, 'summary') ?? completed.title,
          entity_type: 'subtask',
          entity_id: id,
        });
      }
      return { completed: completed !== null, subtask_id: id, subtask: completed };
    },
  },
  {
    name: 'next_task',
    description: 'Pick the highest-priority todo subtask whose dependencies are met. Optionally scoped to a project. Also returns matched dead-end warnings (semantic when SHINOBI_EMBED_PROVIDER is configured).',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const projectId = getNumber(args, 'project_id');
      const task = nextTask({ projectId });
      if (!task) return { task: null, dead_end_warnings: [] };
      const approach = `${task.title}\n${task.description ?? ''}`.trim();
      const warnings = checkDeadEnds({
        approach,
        projectId,
        limit: 5,
      });
      return { task, dead_end_warnings: warnings };
    },
  },
];
