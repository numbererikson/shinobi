// Audit→remediation: turn a list of findings (from a security review, linter, or
// code review) into a subtask graph the swarm can drain. The clever bit is the
// dependency edges: findings on the SAME file are chained (depends_on) so they
// run sequentially — no two agents edit the same file in parallel, so agent
// branches don't conflict — while findings on different files stay independent
// and fan out across the swarm.

import { normalizeFilePath } from '../../lib/paths.js';
import type { Priority } from '../../models/projects.js';
import type { CreateSubtaskInput } from '../../models/subtasks.js';

export interface Finding {
  title: string;
  severity?: string;
  file?: string;
  description?: string;
  remediation?: string;
}

export interface PlannedTask {
  input: CreateSubtaskInput;
  /** Normalized repo-relative file the finding touches, or null. */
  file: string | null;
  /** Index of the prior same-file task this one must wait for, or null. */
  dependsOnIndex: number | null;
}

const SEVERITY_PRIORITY: Record<string, Priority> = {
  critical: 'urgent',
  high: 'high',
  medium: 'medium',
  moderate: 'medium',
  low: 'low',
  info: 'low',
  informational: 'low',
};

/** Map a finding severity to a task priority. Unknown / missing → medium. */
export function severityToPriority(severity: string | undefined): Priority {
  if (!severity) return 'medium';
  return SEVERITY_PRIORITY[severity.trim().toLowerCase()] ?? 'medium';
}

export interface PlanOptions {
  projectId?: number;
  /** Chain findings on the same file so they run sequentially. Default true. */
  chainSameFile?: boolean;
}

export function planFindings(findings: Finding[], opts: PlanOptions = {}): PlannedTask[] {
  const chain = opts.chainSameFile !== false;
  const lastIndexForFile = new Map<string, number>();
  const planned: PlannedTask[] = [];

  findings.forEach((finding, i) => {
    const file = finding.file ? normalizeFilePath(finding.file) : null;
    const priority = severityToPriority(finding.severity);
    const title = finding.severity ? `[${finding.severity.trim().toLowerCase()}] ${finding.title}` : finding.title;

    const descParts: string[] = [];
    if (finding.description) descParts.push(finding.description);
    if (finding.remediation) descParts.push(`Remediation: ${finding.remediation}`);
    if (file) descParts.push(`File: ${file}`);

    const input: CreateSubtaskInput = { title, priority, sort_order: i };
    if (opts.projectId !== undefined) input.project_id = opts.projectId;
    if (descParts.length > 0) input.description = descParts.join('\n\n');

    let dependsOnIndex: number | null = null;
    if (chain && file && lastIndexForFile.has(file)) {
      dependsOnIndex = lastIndexForFile.get(file)!;
    }
    if (file) lastIndexForFile.set(file, i);

    planned.push({ input, file, dependsOnIndex });
  });

  return planned;
}
