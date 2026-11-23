import { stderr } from 'node:process';
import { appendTool, type ShinobiTool } from '../../server/tools/registry.js';
import {
  deletePluginState,
  getPluginState,
  setPluginState,
  updatePluginState,
} from '../../models/plugin_state.js';
import type { SafePushResult } from '../push/web-push.js';
import { createApi, type ShinobiApi } from './api.js';
import { discoverPlugins } from './discovery.js';
import { resolveOwnedTool } from './invoke.js';
import {
  runPluginPushAction,
  sendPluginNotification,
  type PluginNotification,
  type PushActionResult,
  type PushSender,
} from './notify.js';
import { findPlugin, recordPlugin } from './state.js';
import { registerPluginPage, type PluginPageDef } from './pages.js';
import { registerPluginSchedule, validateScheduleDef, type PluginScheduleDef } from './schedules.js';
import { registerBriefSection, validateBriefSection, type BriefSectionDef } from '../brief/brief.js';

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
  /**
   * Add a page to the dashboard (sidebar → Apps). The page is data: `render`
   * returns blocks the dashboard draws; buttons call this plugin's own tools.
   * Plugins written for older hosts should check `typeof registry.registerPage`.
   */
  registerPage(def: PluginPageDef): void;
  /**
   * Run `def.run` on a cron schedule. Ticks only in the dashboard process; each
   * slot runs at most once. Plugins written for older hosts should check
   * `typeof registry.schedule`.
   */
  schedule(def: PluginScheduleDef): void;
  /**
   * Push a notification to every subscribed device. Up to two buttons, each
   * calling one of this plugin's own tools when pressed. Never throws on
   * delivery failure; invalid input throws.
   */
  notify(notification: PluginNotification): Promise<SafePushResult>;
  /**
   * Add a short section to the daily morning brief (plain text lines, e.g.
   * today's reminders). Return null to stay out of a given day's brief.
   * Plugins written for older hosts should check `typeof registry.brief`.
   */
  brief(def: BriefSectionDef): void;
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
    registerPage(def) {
      registerPluginPage(pluginName, def);
    },
    schedule(def) {
      registerPluginSchedule(pluginName, def, api);
    },
    notify(notification) {
      return sendPluginNotification(pluginName, notification, (tool) => resolveOwnedTool(pluginName, tool) !== null);
    },
    brief(def) {
      registerBriefSection(pluginName, def, api);
    },
  };
}

export interface InProcessRegistryOptions {
  /** Replaces web push delivery, e.g. to capture payloads in tests. */
  send?: PushSender;
}

/**
 * In-process registry for tests and smoke harnesses. Unlike the discovery path
 * it collects tools, pages and schedules locally (instead of mutating the global
 * registries), validates them the same way, and exposes scoped, real
 * SQLite-backed state. `runSchedule` fires a schedule on demand and
 * `runPushAction` presses a notification button by its token.
 */
export function createInProcessRegistry(
  pluginName: string,
  api: ShinobiApi = createApi(),
  options: InProcessRegistryOptions = {},
): {
  registry: PluginRegistry;
  tools: Map<string, PluginToolDef>;
  pages: Map<string, PluginPageDef>;
  schedules: Map<string, PluginScheduleDef>;
  briefs: Map<string, BriefSectionDef>;
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  runSchedule: (id: string) => Promise<unknown>;
  runPushAction: (token: string) => Promise<PushActionResult>;
} {
  const tools = new Map<string, PluginToolDef>();
  const pages = new Map<string, PluginPageDef>();
  const schedules = new Map<string, PluginScheduleDef>();
  const briefs = new Map<string, BriefSectionDef>();
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
    registerPage(def) {
      if (pages.has(def.id)) throw new Error(`plugin '${pluginName}': duplicate page '${def.id}'`);
      pages.set(def.id, def);
    },
    schedule(def) {
      validateScheduleDef(pluginName, def);
      if (schedules.has(def.id)) throw new Error(`plugin '${pluginName}': duplicate schedule '${def.id}'`);
      schedules.set(def.id, def);
    },
    notify(notification) {
      return sendPluginNotification(pluginName, notification, (tool) => tools.has(tool), options.send);
    },
    brief(def) {
      validateBriefSection(pluginName, def);
      if (briefs.has(def.id)) throw new Error(`plugin '${pluginName}': duplicate brief section '${def.id}'`);
      briefs.set(def.id, def);
    },
  };
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const def = tools.get(name);
    if (!def) throw new Error(`no tool '${name}'`);
    return await def.handler(args, api);
  };
  const runSchedule = async (id: string): Promise<unknown> => {
    const def = schedules.get(id);
    if (!def) throw new Error(`no schedule '${id}'`);
    return await def.run(api);
  };
  const runPushAction = (token: string): Promise<PushActionResult> =>
    runPluginPushAction(token, (plugin, tool) => {
      const def = plugin === pluginName ? tools.get(tool) : undefined;
      return def ? (args) => def.handler(args, api) : null;
    });
  return { registry, tools, pages, schedules, briefs, call, runSchedule, runPushAction };
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
      pages_registered: [],
      schedules_registered: [],
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
