import { linkCommit, recordActivity } from '../../models/activity.js';
import { projectsMatchingTargetPath } from '../../models/projects.js';
import {
  getNumber,
  getString,
  getStringArray,
  requireString,
} from './args.js';
import type { ShinobiTool } from './types.js';

export const gitTools: ShinobiTool[] = [
  {
    name: 'link_commit',
    description:
      "Link a git commit to a subtask (when commit message contains [SHI-N] tag) or attribute to projects via target_path match. Records to the activity timeline so 'history' shows commits next to claims/completions.",
    inputSchema: {
      type: 'object',
      properties: {
        commit_sha: { type: 'string', description: 'Full or short SHA' },
        message: { type: 'string' },
        files: { type: 'array', items: { type: 'string' }, description: 'Paths touched by the commit; used for target_path attribution when no [N] tag matches' },
        subtask_id: { type: 'integer', description: 'Explicit subtask binding (use this when you already know the [N])' },
        project_id: { type: 'integer', description: 'Explicit project binding (overrides path-based attribution)' },
        ref_url: { type: 'string', description: 'Optional permalink to the commit (e.g. GitHub URL)' },
        session_id: { type: 'string' },
      },
      required: ['commit_sha'],
      additionalProperties: false,
    },
    handler: (args) => {
      const commitSha = requireString(args, 'commit_sha');
      const message = getString(args, 'message');
      const files = getStringArray(args, 'files') ?? [];
      const explicitSubtask = getNumber(args, 'subtask_id');
      const explicitProject = getNumber(args, 'project_id');
      const refUrl = getString(args, 'ref_url') ?? commitSha;
      const sessionId = getString(args, 'session_id');

      if (explicitSubtask !== undefined) {
        const linked = linkCommit({
          project_id: explicitProject ?? null,
          subtask_id: explicitSubtask,
          commit_sha: commitSha,
          ref_url: refUrl,
          message: message ?? commitSha,
          session_id: sessionId,
        });
        return { mode: 'explicit_subtask', linked: [linked] };
      }

      const tagMatch = message ? /\[SHI-(\d+)\]/i.exec(message) : null;
      if (tagMatch) {
        const subtaskId = Number(tagMatch[1]);
        const linked = linkCommit({
          project_id: explicitProject ?? null,
          subtask_id: subtaskId,
          commit_sha: commitSha,
          ref_url: refUrl,
          message: message ?? commitSha,
          session_id: sessionId,
        });
        return { mode: 'tag_matched', tag: tagMatch[0], linked: [linked] };
      }

      if (explicitProject !== undefined) {
        const activity = recordActivity({
          project_id: explicitProject,
          session_id: sessionId,
          action_type: 'commit_path_matched',
          action_details: message ?? commitSha,
          entity_type: 'commit',
          ref_url: refUrl,
        });
        return { mode: 'explicit_project', linked: [activity] };
      }

      const matchedProjects = new Set<number>();
      for (const path of files) {
        for (const project of projectsMatchingTargetPath(path)) {
          matchedProjects.add(project.id);
        }
      }

      if (matchedProjects.size === 0) {
        return { mode: 'unattributed', linked: [] };
      }

      const linked = [...matchedProjects].map((projectId) =>
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'commit_path_matched',
          action_details: message ?? commitSha,
          entity_type: 'commit',
          ref_url: refUrl,
        }),
      );
      return { mode: 'path_attributed', projects: [...matchedProjects], linked };
    },
  },
];
