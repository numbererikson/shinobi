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
import { trackEvent } from '../services/telemetry/client.js';

export interface ServerInfo {
  name: string;
  version: string;
}

const DEFAULT_INFO: ServerInfo = { name: 'shinobi', version: '0.0.1' };

export async function startMcpServer(info: ServerInfo = DEFAULT_INFO): Promise<void> {
  applyPendingMigrations();
  registerBuiltins();
  await loadDiscoveredPlugins();

  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools().map((tool) => ({
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
