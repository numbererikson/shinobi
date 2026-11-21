import { randomBytes } from 'node:crypto';
import { consumePushAction, createPushActions, prunePushActions } from '../../models/plugin_push_actions.js';
import { sendPushSafe, type PushPayload, type SafePushResult } from '../push/web-push.js';
import { isModuleEnabled } from '../modules.js';
import { resolveOwnedTool, withTimeout, type ToolHandler } from './invoke.js';

/**
 * Plugin push notifications (registry.notify).
 *
 * A notification goes to every subscribed device. Optional buttons call the
 * plugin's own tools: each button gets an unguessable one-time token, the
 * service worker sends only that token back, and the server runs the mapped
 * tool. Pressing one button retires its siblings, so "Done" and "Snooze" on the
 * same reminder never both run.
 */

export interface PluginNotifyAction {
  label: string;
  /** A tool registered by the same plugin. */
  tool: string;
  args?: Record<string, unknown>;
}

export interface PluginNotification {
  title: string;
  body: string;
  /** Same-origin path opened when the notification itself is tapped, e.g. '/apps/reminders'. */
  url?: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
  actions?: PluginNotifyAction[];
}

export type PushSender = (payload: PushPayload) => Promise<SafePushResult>;

/** Most platforms show at most two notification buttons. */
export const MAX_NOTIFY_ACTIONS = 2;
const ACTION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACTION_TIMEOUT_MS = 10_000;

function capText(value: unknown, field: string, max: number, plugin: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`plugin '${plugin}': notification ${field} must be a non-empty string`);
  }
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function token(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Validate and send a plugin notification. `owns` answers whether a tool
 * belongs to the plugin; `send` is injectable for tests.
 */
export async function sendPluginNotification(
  plugin: string,
  input: PluginNotification,
  owns: (tool: string) => boolean,
  send: PushSender = sendPushSafe,
): Promise<SafePushResult> {
  if (!input || typeof input !== 'object') throw new Error(`plugin '${plugin}': notification must be an object`);
  const title = capText(input.title, 'title', 120, plugin);
  const body = capText(input.body, 'body', 1000, plugin);
  if (input.url !== undefined && (typeof input.url !== 'string' || !input.url.startsWith('/') || input.url.startsWith('//'))) {
    throw new Error(`plugin '${plugin}': notification url must be a same-origin path starting with '/'`);
  }
  if (input.tag !== undefined && typeof input.tag !== 'string') {
    throw new Error(`plugin '${plugin}': notification tag must be a string`);
  }

  const actions = input.actions ?? [];
  if (!Array.isArray(actions) || actions.length > MAX_NOTIFY_ACTIONS) {
    throw new Error(`plugin '${plugin}': a notification takes at most ${MAX_NOTIFY_ACTIONS} actions`);
  }
  const prepared = actions.map((a) => {
    if (!a || typeof a.tool !== 'string' || !owns(a.tool)) {
      throw new Error(`plugin '${plugin}': action tool '${String(a?.tool)}' is not registered by this plugin`);
    }
    if (a.args !== undefined && (typeof a.args !== 'object' || a.args === null || Array.isArray(a.args))) {
      throw new Error(`plugin '${plugin}': action args must be an object`);
    }
    return { token: token(), tool: a.tool, args: a.args ?? {}, label: capText(a.label, 'action label', 40, plugin) };
  });

  if (!isModuleEnabled(plugin)) {
    return { total: 0, succeeded: 0, failed: 0, pruned_endpoints: [], error: 'module disabled' };
  }

  if (prepared.length > 0) {
    prunePushActions();
    createPushActions(token(), plugin, prepared, ACTION_TTL_SECONDS);
  }

  return send({
    title,
    body,
    ...(input.tag !== undefined ? { tag: input.tag.slice(0, 64) } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    actions: prepared.map((a) => ({ action: `plugin:${a.token}`, title: a.label })),
  });
}

export type PushActionResult =
  | { status: 'not_found' }
  | { status: 'forbidden'; error: string }
  | { status: 'ok'; result: unknown }
  | { status: 'failed'; error: string };

/**
 * Run the tool behind a notification button. `resolve` maps (plugin, tool) to
 * the plugin's own handler; it is injectable for tests.
 */
export async function runPluginPushAction(
  actionToken: string,
  resolve: (plugin: string, tool: string) => ToolHandler | null = resolveOwnedTool,
): Promise<PushActionResult> {
  const action = consumePushAction(actionToken);
  if (!action) return { status: 'not_found' };
  if (!isModuleEnabled(action.plugin)) return { status: 'forbidden', error: 'module disabled' };
  const handler = resolve(action.plugin, action.tool);
  if (!handler) {
    return { status: 'forbidden', error: `tool '${action.tool}' does not belong to plugin '${action.plugin}'` };
  }
  try {
    const result = await withTimeout(Promise.resolve().then(() => handler(action.args)), ACTION_TIMEOUT_MS, `tool '${action.tool}'`);
    return { status: 'ok', result };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
