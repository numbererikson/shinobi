import { recordActivity } from '../../models/activity.js';
import {
  getLatestPlan,
  getPlanByVersion,
  listPlanVersions,
  savePlan,
} from '../../models/plans.js';
import { getBoolean, getNumber, getString, requireNumber, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

export const planTools: ShinobiTool[] = [
  {
    name: 'save_plan',
    description: 'Persist an approved plan as a new versioned snapshot. Auto-increments version per project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        plan_md: { type: 'string', description: 'Plan body in Markdown' },
        session_id: { type: 'string' },
      },
      required: ['project_id', 'plan_md'],
      additionalProperties: false,
    },
    handler: (args) => {
      const projectId = requireNumber(args, 'project_id');
      const sessionId = getString(args, 'session_id');
      const plan = savePlan({
        project_id: projectId,
        plan_md: requireString(args, 'plan_md'),
        claude_session_id: sessionId,
      });
      recordActivity({
        project_id: projectId,
        session_id: sessionId,
        action_type: 'save_plan',
        action_details: `v${plan.version} (${plan.plan_md.length} chars)`,
        entity_type: 'plan',
        entity_id: plan.id,
      });
      return plan;
    },
  },
  {
    name: 'get_plan',
    description: 'Return the latest plan for a project, or a specific version. Optionally include version history.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        version: { type: 'integer', description: 'Specific version, omit for latest' },
        include_history: { type: 'boolean', default: false },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const projectId = requireNumber(args, 'project_id');
      const version = getNumber(args, 'version');
      const plan = version !== undefined ? getPlanByVersion(projectId, version) : getLatestPlan(projectId);
      const result: { project_id: number; plan: typeof plan; history?: unknown } = {
        project_id: projectId,
        plan,
      };
      if (getBoolean(args, 'include_history')) {
        result.history = listPlanVersions(projectId);
      }
      return result;
    },
  },
];
