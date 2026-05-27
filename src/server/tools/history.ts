import { listActivity } from '../../models/activity.js';
import { listSessions } from '../../models/sessions.js';
import { getNumber, getString } from './args.js';
import type { ShinobiTool } from './types.js';

export const historyTools: ShinobiTool[] = [
  {
    name: 'history',
    description: 'Return activity timeline (claim/complete/log_decision/log_dead_end/save_plan/...) ordered newest-first. Optionally scoped to a project, entity, or session.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        entity_type: { type: 'string', enum: ['project', 'subtask', 'decision', 'dead_end', 'note', 'plan', 'context', 'commit'] },
        entity_id: { type: 'integer' },
        session_id: { type: 'string' },
        action_type: { type: 'string' },
        include_sessions: { type: 'boolean', default: false },
        limit: { type: 'integer', default: 100 },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const projectId = getNumber(args, 'project_id');
      const entityId = getNumber(args, 'entity_id');
      const options: Parameters<typeof listActivity>[0] = {
        limit: getNumber(args, 'limit') ?? 100,
      };
      if (projectId !== undefined) options.projectId = projectId;
      if (entityId !== undefined) options.entityId = entityId;
      const entityType = getString(args, 'entity_type');
      if (entityType) options.entityType = entityType;
      const sessionId = getString(args, 'session_id');
      if (sessionId) options.sessionId = sessionId;
      const actionType = getString(args, 'action_type');
      if (actionType) options.actionType = actionType;
      const activity = listActivity(options);
      if (args['include_sessions'] === true) {
        return {
          activity,
          sessions: listSessions(projectId, getNumber(args, 'limit') ?? 100),
        };
      }
      return activity;
    },
  },
];
