import { stderr } from 'node:process';
import { appendTool, type ShinobiTool } from '../../server/tools/registry.js';
import {
  deletePluginState,
  getPluginState,
  setPluginState,
  updatePluginState,
} from '../../models/plugin_state.js';
import { createApi, type ShinobiApi } from './api.js';
import { discoverPlugins } from './discovery.js';
import { findPlugin, recordPlugin } from './state.js';

const PLUGIN_TOOL_NAME = /^plugin_[a-z][a-z0-9_]*$/;

export interface PluginToolDef {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: Record<string, unknown>, api: ShinobiApi) => unknown | Promise<unknown>;
}

/**
 * Durable key/value state handed to a plugin, scoped to that plugin's name so
 * one plugin can never touch another's keys. Values are JSON-serializable.
 * `update` is an atomic read-modify-write for the common get→mutate→set pattern.
 */
export interface PluginStateStore {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  update<T>(key: string, mutator: (current: T | null) => T): T;
}

export interface PluginRegistry {
  registerTool(def: PluginToolDef): void;
  /** Durable, SQLite-backed state scoped to this plugin. */
  state: PluginStateStore;
}

/** Build a state handle bound to a single plugin's namespace. */
export function scopedPluginState(pluginName: string): PluginStateStore {
  return {
    get: (key) => getPluginState(pluginName, key),
    set: (key, value) => setPluginState(pluginName, key, value),
    delete: (key) => deletePluginState(pluginName, key),
    update: (key, mutator) => updatePluginState(pluginName, key, mutator),
  };
}

type PluginModule = {
  default?: (registry: PluginRegistry, api: ShinobiApi) => void | Promise<void>;
  register?: (registry: PluginRegistry, api: ShinobiApi) => void | Promise<void>;
};

function buildPluginRegistry(pluginName: string, api: ShinobiApi): PluginRegistry {
  return {
    state: scopedPluginState(pluginName),
    registerTool(def) {
      if (!PLUGIN_TOOL_NAME.test(def.name)) {
        throw new Error(
          `plugin '${pluginName}': tool name '${def.name}' must match /^plugin_[a-z][a-z0-9_]*$/`,
        );
      }
      const tool: ShinobiTool = {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: (args) => def.handler(args, api),
      };
      appendTool(tool);
      const info = findPlugin(pluginName);
      if (info) info.tools_registered.push(def.name);
    },
  };
}

/**
 * In-process registry for tests and smoke harnesses. Unlike the discovery path
 * it collects tools locally (instead of mutating the global MCP tool registry),
 * validates names the same way, and exposes scoped, real SQLite-backed state.
 */
export function createInProcessRegistry(
  pluginName: string,
  api: ShinobiApi = createApi(),
): { registry: PluginRegistry; tools: Map<string, PluginToolDef>; call: (name: string, args?: Record<string, unknown>) => Promise<unknown> } {
  const tools = new Map<string, PluginToolDef>();
  const registry: PluginRegistry = {
    state: scopedPluginState(pluginName),
    registerTool(def) {
      if (!PLUGIN_TOOL_NAME.test(def.name)) {
        throw new Error(
          `plugin '${pluginName}': tool name '${def.name}' must match /^plugin_[a-z][a-z0-9_]*$/`,
        );
      }
      if (tools.has(def.name)) {
        throw new Error(`plugin '${pluginName}': duplicate tool '${def.name}'`);
      }
      tools.set(def.name, def);
    },
  };
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const def = tools.get(name);
    if (!def) throw new Error(`no tool '${name}'`);
    return await def.handler(args, api);
  };
  return { registry, tools, call };
}

export async function loadDiscoveredPlugins(): Promise<void> {
  const api = createApi();
  const found = await discoverPlugins();

  for (const candidate of found) {
    recordPlugin({
      name: candidate.name,
      source: candidate.source,
      module_path: candidate.module_path,
      tools_registered: [],
      error: null,
    });

    let mod: PluginModule;
    try {
      mod = (await import(candidate.module_path)) as PluginModule;
    } catch (err) {
      const info = findPlugin(candidate.name);
      if (info) info.error = `import failed: ${err instanceof Error ? err.message : String(err)}`;
      stderr.write(`shinobi plugin: failed to import ${candidate.name}: ${info?.error}\n`);
      continue;
    }

    const register = mod.default ?? mod.register;
    if (typeof register !== 'function') {
      const info = findPlugin(candidate.name);
      if (info) info.error = 'no default/register export';
      continue;
    }

    try {
      await register(buildPluginRegistry(candidate.name, api), api);
    } catch (err) {
      const info = findPlugin(candidate.name);
      if (info) info.error = `register threw: ${err instanceof Error ? err.message : String(err)}`;
      stderr.write(`shinobi plugin: register failed for ${candidate.name}: ${info?.error}\n`);
    }
  }
}
