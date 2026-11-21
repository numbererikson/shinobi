import { getTool } from '../../server/tools/registry.js';
import { findPlugin } from './state.js';

/**
 * Shared plumbing for running a plugin's own tool on its behalf — from a
 * dashboard page button, a push notification button, or a scheduler tick.
 * A caller may only reach tools the same plugin registered.
 */

export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** The handler of `tool` when `plugin` registered it, else null. */
export function resolveOwnedTool(plugin: string, tool: string): ToolHandler | null {
  const info = findPlugin(plugin);
  if (!info?.tools_registered.includes(tool)) return null;
  return getTool(tool)?.handler ?? null;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
