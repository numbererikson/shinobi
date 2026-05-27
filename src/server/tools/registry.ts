import type { ShinobiTool } from './types.js';

const tools: ShinobiTool[] = [];
const byName: Map<string, ShinobiTool> = new Map();

export function appendTool(tool: ShinobiTool): void {
  if (byName.has(tool.name)) {
    throw new Error(`tool name collision: ${tool.name}`);
  }
  tools.push(tool);
  byName.set(tool.name, tool);
}

export function allTools(): ShinobiTool[] {
  return tools.slice();
}

export function getTool(name: string): ShinobiTool | undefined {
  return byName.get(name);
}

export function toolNames(): string[] {
  return [...byName.keys()];
}

export function resetTools(): void {
  tools.length = 0;
  byName.clear();
}

export type { ShinobiTool } from './types.js';
