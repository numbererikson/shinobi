import { recordActivity } from '../../models/activity.js';
import type { Priority } from '../../models/projects.js';
import { bulkCreateSubtasks, updateSubtask } from '../../models/subtasks.js';
import { planFindings, type Finding } from '../../services/findings/plan.js';
import { getBoolean, getNumber } from './args.js';
import type { ShinobiTool } from './types.js';

function coerceFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('findings must be a non-empty array');
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`findings[${i}] must be an object`);
    }
    const o = item as Record<string, unknown>;
    if (typeof o['title'] !== 'string' || o['title'] === '') {
      throw new Error(`findings[${i}].title is required`);
    }
    const finding: Finding = { title: o['title'] };
    if (typeof o['severity'] === 'string') finding.severity = o['severity'];
    if (typeof o['file'] === 'string') finding.file = o['file'];
    if (typeof o['description'] === 'string') finding.description = o['description'];
    if (typeof o['remediation'] === 'string') finding.remediation = o['remediation'];
    return finding;
  });
}

export const findingsTools: ShinobiTool[] = [
  {
    name: 'ingest_findings',
    description:
      'Turn a list of audit / linter / code-review findings into a subtask graph the swarm can drain. Severity maps to priority (critical→urgent, high→high, medium→medium, low/info→low). Findings on the same file are chained (depends_on) so they run sequentially — agents never edit one file in parallel — while different files stay independent and fan out. Closes the loop: an AI review generates findings, the swarm fixes them, the dashboard reports done.',
    inputSchema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          description: 'The findings to turn into tasks.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short remediation title (required).' },
              severity: { type: 'string', description: 'critical | high | medium | low | info. Maps to priority.' },
              file: { type: 'string', description: 'Repo-relative file the finding touches (drives same-file chaining + files_touched).' },
              description: { type: 'string' },
              remediation: { type: 'string', description: 'Suggested fix; appended to the task description.' },
            },
            required: ['title'],
            additionalProperties: true,
          },
        },
        project_id: { type: 'integer', description: 'Project to create the tasks under.' },
        chain_same_file: {
          type: 'boolean',
          default: true,
          description: 'Chain findings on the same file so they run sequentially. Default true.',
        },
        session_id: { type: 'string' },
      },
      required: ['findings'],
      additionalProperties: false,
    },
    handler: (args) => {
      const findings = coerceFindings(args['findings']);
      const projectId = getNumber(args, 'project_id');
      const chainSameFile = getBoolean(args, 'chain_same_file') ?? true;

      const planOpts: Parameters<typeof planFindings>[1] = { chainSameFile };
      if (projectId !== undefined) planOpts.projectId = projectId;
      const planned = planFindings(findings, planOpts);

      const created = bulkCreateSubtasks(planned.map((p) => p.input));

      // Wire same-file dependency edges + files_touched now that ids exist.
      let chained = 0;
      created.forEach((task, i) => {
        const plan = planned[i]!;
        const patch: { files_touched?: string[]; depends_on?: number[] } = {};
        if (plan.file) patch.files_touched = [plan.file];
        if (plan.dependsOnIndex !== null) {
          patch.depends_on = [created[plan.dependsOnIndex]!.id];
          chained += 1;
        }
        if (Object.keys(patch).length > 0) updateSubtask(task.id, patch);
      });

      const byPriority: Record<Priority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
      for (const p of planned) byPriority[p.input.priority ?? 'medium'] += 1;

      recordActivity({
        project_id: projectId ?? null,
        session_id: typeof args['session_id'] === 'string' ? (args['session_id'] as string) : null,
        action_type: 'ingest_findings',
        action_details: `${created.length} findings → tasks (${chained} chained same-file)`,
        entity_type: 'project',
        entity_id: projectId ?? null,
      });

      return {
        created: created.length,
        task_ids: created.map((t) => t.id),
        by_priority: byPriority,
        same_file_chained: chained,
      };
    },
  },
];
