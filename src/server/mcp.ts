import { realpathSync } from 'node:fs';
import { argv, exit, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { applyPendingMigrations } from '../lib/migrations.js';
import { loadDiscoveredPlugins } from '../services/plugins/registry.js';
import { allTools, getTool, registerBuiltins } from './tools/index.js';
import { disabledModules, isToolEnabled, moduleOfTool } from '../services/modules.js';
import { trackEvent } from '../services/telemetry/client.js';

export interface ServerInfo {
  name: string;
  version: string;
}

const DEFAULT_INFO: ServerInfo = { name: 'shinobi', version: '0.0.1' };

/**
 * One-time runtime bootstrap shared by every transport (stdio + HTTP):
 * migrations, built-in tool registration, plugin discovery. Safe to call
 * more than once — registerBuiltins guards itself and migrations are
 * checksum-gated.
 */
export async function initToolRuntime(): Promise<void> {
  applyPendingMigrations();
  registerBuiltins();
  await loadDiscoveredPlugins();
}

/**
 * Builds a configured MCP Server wired to the shared tool registry.
 * Transport-agnostic: callers connect it to stdio (startMcpServer) or to a
 * per-request streamable HTTP transport (server/http.ts).
 */
export interface McpServerOptions {
  /** Modules whose tools this endpoint never offers (e.g. /mcp/home hides 'development'). */
  excludeModules?: string[];
}

/** Tools an endpoint offers: enabled modules only, minus the endpoint's excluded modules. */
export function visibleTools(opts: McpServerOptions = {}): ReturnType<typeof allTools> {
  const disabled = disabledModules();
  const excluded = new Set(opts.excludeModules ?? []);
  return allTools().filter((tool) => isToolEnabled(tool.name, disabled) && !excluded.has(moduleOfTool(tool.name)));
}

export function buildMcpServer(info: ServerInfo = DEFAULT_INFO, opts: McpServerOptions = {}): Server {
  const server = new Server(info, { capabilities: { tools: {} } });
  const excluded = new Set(opts.excludeModules ?? []);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // Tools of switched-off modules (Settings → Modules) and of modules this
    // endpoint excludes are not offered.
    tools: visibleTools(opts).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = getTool(toolName);

    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    if (excluded.has(moduleOfTool(toolName))) {
      return {
        content: [{ type: 'text', text: `Tool ${toolName} is not available on this endpoint. Use /mcp for development tools.` }],
        isError: true,
      };
    }
    if (!isToolEnabled(toolName)) {
      return {
        content: [{ type: 'text', text: `Tool ${toolName} belongs to module '${moduleOfTool(toolName)}', which is switched off (dashboard → Settings → Modules).` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args);
      trackEvent('tool_called', { tool: toolName, ok: true });
      const text =
        typeof result === 'string'
          ? result
          : JSON.stringify(result, (_key, value) => (value === undefined ? null : value), 2);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      trackEvent('tool_called', { tool: toolName, ok: false });
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error in ${toolName}: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(info: ServerInfo = DEFAULT_INFO): Promise<void> {
  await initToolRuntime();
  const server = buildMcpServer(info);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  stderr.write(`shinobi mcp: server ready (${allTools().length} tools)\n`);
}

function isMainModule(): boolean {
  try {
    const entryPath = argv[1];
    if (!entryPath) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  startMcpServer().catch((err: unknown) => {
    stderr.write(`shinobi mcp: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    exit(1);
  });
}
