import { recordActivity } from '../../models/activity.js';
import { getContext, upsertContext } from '../../models/context.js';
import { getObject, getString, getStringArray, requireNumber } from './args.js';
import type { ShinobiTool } from './types.js';

export const contextTools: ShinobiTool[] = [
  {
    name: 'get_context',
    description: 'Get a project living context: conventions, dont_touch, test_patterns, deploy_notes, file_annotations. Returns null when no context row exists yet.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'integer' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => getContext(requireNumber(args, 'project_id')),
  },
  {
    name: 'update_context',
    description: "Patch a project's context. Only fields present in the patch are modified — others preserve their prior value.",
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        conventions: { type: 'string' },
        dont_touch: { type: 'array', items: { type: 'string' } },
        test_patterns: { type: 'string' },
        deploy_notes: { type: 'string' },
        file_annotations: { type: 'object', additionalProperties: { type: 'string' } },
        last_validated_commit: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'project_id');
      const patch: Record<string, unknown> = {};
      if ('conventions' in args) patch['conventions'] = getString(args, 'conventions') ?? null;
      if ('dont_touch' in args) patch['dont_touch'] = getStringArray(args, 'dont_touch') ?? null;
      if ('test_patterns' in args) patch['test_patterns'] = getString(args, 'test_patterns') ?? null;
      if ('deploy_notes' in args) patch['deploy_notes'] = getString(args, 'deploy_notes') ?? null;
      if ('file_annotations' in args) {
        const annotations = getObject(args, 'file_annotations');
        const coerced: Record<string, string> | null = annotations
          ? Object.fromEntries(
              Object.entries(annotations).map(([k, v]) => {
                if (typeof v !== 'string') {
                  throw new Error('file_annotations values must be strings');
                }
                return [k, v];
              }),
            )
          : null;
        patch['file_annotations'] = coerced;
      }
      if ('last_validated_commit' in args)
        patch['last_validated_commit'] = getString(args, 'last_validated_commit') ?? null;
      const updated = upsertContext(id, patch);
      recordActivity({
        project_id: id,
        session_id: getString(args, 'session_id'),
        action_type: 'update_context',
        action_details: Object.keys(patch).join(','),
        entity_type: 'context',
        entity_id: id,
      });
      return updated;
    },
  },
];
