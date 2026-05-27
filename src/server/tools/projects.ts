import { recordActivity } from '../../models/activity.js';
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  unarchiveProject,
  updateProject,
  type Priority,
  type Status,
} from '../../models/projects.js';
import { getBoolean, getString, requireNumber, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

const STATUS_ENUM = ['todo', 'in_progress', 'done'] as const;
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent'] as const;

export const projectTools: ShinobiTool[] = [
  {
    name: 'list_projects',
    description: 'List Shinobi projects with progress. Filter by status, workspace, or include archived.',
    inputSchema: {
      type: 'object',
      properties: {
        include_archived: { type: 'boolean', default: false },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        workspace: { type: 'string', description: 'Filter to one codebase (e.g. shinobi / shinobiapps / sitesnap)' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const opts: Parameters<typeof listProjects>[0] = {};
      const includeArchived = getBoolean(args, 'include_archived');
      if (includeArchived !== undefined) opts.includeArchived = includeArchived;
      const status = getString(args, 'status');
      if (status) opts.status = status as Status;
      const workspace = getString(args, 'workspace');
      if (workspace) opts.workspace = workspace;
      return listProjects(opts);
    },
  },
  {
    name: 'get_project',
    description: 'Get a single project by id, including its summary fields.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => getProject(requireNumber(args, 'project_id')),
  },
  {
    name: 'create_project',
    description: 'Create a new project. Tag with workspace (e.g. shinobi / shinobiapps / sitesnap) so cross-codebase work stays organised.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        priority: { type: 'string', enum: [...PRIORITY_ENUM] },
        project_type: { type: 'string' },
        target_path: { type: 'string', description: 'Path relative to the workspace root (e.g. app/baseKRIZAN/Security/)' },
        workspace: { type: 'string', description: 'Codebase name (free-form): shinobi / shinobiapps / sitesnap / ...' },
        due_date: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: (args) => {
      const project = createProject({
        title: requireString(args, 'title'),
        description: getString(args, 'description'),
        status: getString(args, 'status') as Status | undefined,
        priority: getString(args, 'priority') as Priority | undefined,
        project_type: getString(args, 'project_type'),
        target_path: getString(args, 'target_path'),
        workspace: getString(args, 'workspace'),
        due_date: getString(args, 'due_date'),
      });
      recordActivity({
        project_id: project.id,
        session_id: getString(args, 'session_id'),
        action_type: 'create_project',
        action_details: project.title,
        entity_type: 'project',
        entity_id: project.id,
      });
      return project;
    },
  },
  {
    name: 'update_project',
    description: 'Patch a project. Only fields present in the patch are modified.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        priority: { type: 'string', enum: [...PRIORITY_ENUM] },
        project_type: { type: 'string' },
        target_path: { type: 'string' },
        workspace: { type: 'string' },
        due_date: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'project_id');
      const patch: Record<string, unknown> = {};
      for (const key of ['title', 'description', 'status', 'priority', 'project_type', 'target_path', 'workspace', 'due_date']) {
        if (key in args) patch[key] = args[key];
      }
      const updated = updateProject(id, patch);
      if (updated) {
        recordActivity({
          project_id: id,
          session_id: getString(args, 'session_id'),
          action_type: 'update_project',
          action_details: Object.keys(patch).join(','),
          entity_type: 'project',
          entity_id: id,
        });
      }
      return updated;
    },
  },
  {
    name: 'archive_project',
    description: 'Mark a project as archived (sets archived_at timestamp).',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer' }, session_id: { type: 'string' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'project_id');
      const archived = archiveProject(id);
      recordActivity({
        project_id: id,
        session_id: getString(args, 'session_id'),
        action_type: 'archive_project',
        entity_type: 'project',
        entity_id: id,
      });
      return archived;
    },
  },
  {
    name: 'unarchive_project',
    description: 'Restore an archived project (clears archived_at).',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer' }, session_id: { type: 'string' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'project_id');
      const unarchived = unarchiveProject(id);
      recordActivity({
        project_id: id,
        session_id: getString(args, 'session_id'),
        action_type: 'unarchive_project',
        entity_type: 'project',
        entity_id: id,
      });
      return unarchived;
    },
  },
  {
    name: 'delete_project',
    description: 'Permanently delete a project (cascades to subtasks, decisions, plans, etc.).',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer' }, session_id: { type: 'string' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'project_id');
      const project = getProject(id);
      const deleted = deleteProject(id);
      if (deleted && project) {
        recordActivity({
          project_id: null,
          session_id: getString(args, 'session_id'),
          action_type: 'delete_project',
          action_details: project.title,
          entity_type: 'project',
          entity_id: id,
        });
      }
      return { deleted };
    },
  },
];
