import { getDb } from '../lib/db.js';
import { listLoadedPlugins } from './plugins/state.js';

/**
 * Modules = the built-in Development module (projects, tasks, decisions, dead
 * ends, notes, plans, recall, approvals …) plus every loaded plugin. Each can
 * be switched off on its own: its MCP tools leave tools/list and refuse
 * calls, and its dashboard pages disappear. Everything is on by default.
 */

export const DEVELOPMENT = 'development';
/**
 * Always-on core tools every client needs, also on /mcp/home: push
 * notifications and the server health report. Not a switchable module.
 */
export const SYSTEM = 'system';
const SYSTEM_TOOLS = new Set(['notify', 'system_status']);

export interface ModuleInfo {
  id: string;
  name: string;
  kind: 'builtin' | 'plugin';
  enabled: boolean;
  tools: number;
  pages: string[];
  error: string | null;
}

/** "user/shinobi-plugin-music" → "Music", "@shinobi/plugin-fitness" → "Fitness". */
export function moduleDisplayName(pluginName: string): string {
  const base = pluginName.replace(/^user\//, '').replace(/^@[^/]+\//, '').replace(/^shinobi-plugin-/, '').replace(/^plugin-/, '');
  const words = base.split(/[-_]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') : pluginName;
}

export function disabledModules(): Set<string> {
  try {
    const rows = getDb().prepare('SELECT id FROM modules WHERE enabled = 0').all() as { id: string }[];
    return new Set(rows.map((r) => r.id));
  } catch {
    // Database not migrated yet (tests, first boot): everything is enabled.
    return new Set();
  }
}

export function isModuleEnabled(id: string): boolean {
  return !disabledModules().has(id);
}

export function setModuleEnabled(id: string, enabled: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO modules (id, enabled, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .run(id, enabled ? 1 : 0);
}

/** The module a tool belongs to: System, the plugin that registered it, else Development. */
export function moduleOfTool(toolName: string): string {
  if (SYSTEM_TOOLS.has(toolName)) return SYSTEM;
  if (toolName.startsWith('plugin_')) {
    const owner = listLoadedPlugins().find((p) => p.tools_registered.includes(toolName));
    if (owner) return owner.name;
  }
  return DEVELOPMENT;
}

export function isToolEnabled(toolName: string, disabled: Set<string> = disabledModules()): boolean {
  return !disabled.has(moduleOfTool(toolName));
}

export function knownModuleIds(): string[] {
  return [DEVELOPMENT, ...listLoadedPlugins().map((p) => p.name)];
}

export function listModules(builtinToolCount: number): ModuleInfo[] {
  const disabled = disabledModules();
  return [
    { id: DEVELOPMENT, name: 'Development', kind: 'builtin', enabled: !disabled.has(DEVELOPMENT), tools: builtinToolCount, pages: [], error: null },
    ...listLoadedPlugins().map((p) => ({
      id: p.name,
      name: moduleDisplayName(p.name),
      kind: 'plugin' as const,
      enabled: !disabled.has(p.name),
      tools: p.tools_registered.length,
      pages: p.pages_registered,
      error: p.error,
    })),
  ];
}
