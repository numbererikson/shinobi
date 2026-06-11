import type { Hono } from 'hono';

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { buildMcpServer, type ServerInfo } from './mcp.js';

/**
 * Mounts the MCP streamable HTTP endpoint at /mcp on an existing Hono app.
 *
 * Stateless mode: each POST gets a fresh Server + transport pair over the
 * shared tool registry, so requests carry no session affinity and the
 * endpoint works behind load balancers and across dashboard restarts.
 * Callers must run initToolRuntime() once before the first request comes in
 * (startDashboard does this when the endpoint is enabled).
 *
 * Auth note: routes registered here sit behind the dashboard-wide auth
 * middleware when it is enabled. MCP clients authenticate with
 * `Authorization: Bearer <token>` — the same token the dashboard uses.
 */
export function registerMcpRoutes(app: Hono, info?: ServerInfo): void {
  app.post('/mcp', async (c) => {
    const server = buildMcpServer(info);
    const transport = new WebStandardStreamableHTTPServerTransport({
      // No sessionIdGenerator → stateless mode.
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // JSON-response mode buffers the body before resolving, so closing
      // here cannot cancel an in-flight stream.
      void transport.close();
      void server.close();
    }
  });

  // Stateless server: there is no SSE stream to resume and no session to
  // delete. Respond with a JSON-RPC error per the streamable HTTP spec.
  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed: stateless endpoint, use POST' },
        id: null,
      },
      405,
    ),
  );
}
