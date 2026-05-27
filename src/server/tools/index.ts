import { approvalTools } from './approval.js';
import { contextTools } from './context.js';
import { deadEndTools } from './dead_ends.js';
import { decisionTools } from './decisions.js';
import { extractionTools } from './extraction.js';
import { gitTools } from './git.js';
import { historyTools } from './history.js';
import { noteTools } from './notes.js';
import { planTools } from './plans.js';
import { pluginTools } from './plugin.js';
import { projectTools } from './projects.js';
import { recallTools } from './recall.js';
import { allTools, appendTool, getTool, resetTools, toolNames } from './registry.js';
import { subtaskTools } from './subtasks.js';
import type { ShinobiTool } from './types.js';
import { workflowTools } from './workflow.js';

let registered = false;

export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  for (const tool of [
    ...projectTools,
    ...subtaskTools,
    ...decisionTools,
    ...deadEndTools,
    ...noteTools,
    ...planTools,
    ...contextTools,
    ...recallTools,
    ...historyTools,
    ...gitTools,
    ...extractionTools,
    ...workflowTools,
    ...pluginTools,
    ...approvalTools,
  ]) {
    appendTool(tool);
  }
}

export { allTools, appendTool, getTool, resetTools, toolNames };
export type { ShinobiTool };
