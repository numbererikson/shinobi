// Smoke test for the MCP streamable HTTP endpoint (/mcp):
//   1. unauthenticated POST → 401 (auth middleware covers the MCP route)
//   2. initialize handshake → serverInfo
//   3. tools/list → ≥30 tools
//   4. create_project / delete_project round trip
// Mirrors smoke-mcp-stdio.ts but over HTTP with bearer auth, the same way a
// remote Claude Code / Cursor client connects.

import type { AddressInfo } from 'node:net';

import { startDashboard } from '../src/dashboard/server.js';

const TOKEN = 'smoke-mcp-http-token';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

async function rpc(
  url: string,
  method: string,
  params: unknown,
  id: number,
  token: string | null = TOKEN,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

async function rpcResult<T>(url: string, method: string, params: unknown, id: number): Promise<T> {
  const res = await rpc(url, method, params, id);
  if (res.status !== 200) {
    throw new Error(`${method}: expected 200, got ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as JsonRpcResponse;
  if (body.error) throw new Error(`${method}: server error: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  const first = result.content[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
}

async function main(): Promise<void> {
  const server = await startDashboard({
    host: '127.0.0.1',
    port: 0,
    mcp: true,
    auth: { enabled: true, token: TOKEN },
  });
  if (!server.address()) {
    await new Promise<void>((resolveFn) => server.once('listening', resolveFn));
  }
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/mcp`;

  console.log('-> POST without token (expect 401)');
  const unauthorized = await rpc(url, 'tools/list', {}, 1, null);
  if (unauthorized.status !== 401) {
    throw new Error(`expected 401 without token, got ${unauthorized.status}`);
  }
  console.log('<- 401 OK');

  console.log('\n-> initialize');
  const init = await rpcResult<{ protocolVersion: string; serverInfo: { name: string; version: string } }>(
    url,
    'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'shinobi-smoke-http', version: '0.0.0' },
    },
    2,
  );
  console.log(`<- protocolVersion=${init.protocolVersion} server=${init.serverInfo.name}@${init.serverInfo.version}`);

  console.log('\n-> tools/list');
  const tools = await rpcResult<{ tools: Array<{ name: string }> }>(url, 'tools/list', {}, 3);
  console.log(`<- ${tools.tools.length} tools`);
  if (tools.tools.length < 30) {
    throw new Error(`expected at least 30 tools, got ${tools.tools.length}`);
  }

  console.log('\n-> tools/call create_project');
  const created = await rpcResult<{ content: Array<{ type: string; text: string }> }>(
    url,
    'tools/call',
    { name: 'create_project', arguments: { title: 'MCP HTTP smoke', priority: 'medium' } },
    4,
  );
  const project = JSON.parse(toolText(created)) as { id: number; title: string };
  console.log(`<- created project id=${project.id} title="${project.title}"`);

  console.log('\n-> tools/call delete_project (cleanup)');
  await rpcResult(url, 'tools/call', { name: 'delete_project', arguments: { project_id: project.id } }, 5);
  console.log('<- deleted');

  console.log('\n-> GET /mcp (expect 405, stateless endpoint)');
  const get = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (get.status !== 405) throw new Error(`expected 405 on GET, got ${get.status}`);
  console.log('<- 405 OK');

  server.close();
  console.log('\nMCP HTTP OK');
  // The relay client / digest scheduler may hold the loop open; exit explicitly.
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`smoke-mcp-http: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
