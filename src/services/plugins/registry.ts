import { stderr } from 'node:process';
import { appendTool, type ShinobiTool } from '../../server/tools/registry.js';
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

export interface PluginRegistry {
  registerTool(def: PluginToolDef): void;
}

type PluginModule = {
  default?: (registry: PluginRegistry, api: ShinobiApi) => void | Promise<void>;
  register?: (registry: PluginRegistry, api: ShinobiApi) => void | Promise<void>;
};

function buildPluginRegistry(pluginName: string, api: ShinobiApi): PluginRegistry {
  return {
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
