import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { platform } from 'node:process';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(PROJECT_ROOT, 'dist', 'server', 'mcp.js');

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
}

class StdioClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private waiters = new Map<number, (msg: Record<string, unknown>) => void>();
  private nextId = 1;

  constructor() {
    this.child = spawn(process.execPath, [ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      cwd: PROJECT_ROOT,
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf-8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding('utf-8');
    this.child.stderr.on('data', (chunk: string) => {
      process.stderr.write(`[server] ${chunk}`);
    });
    this.child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`[server exited code=${code} signal=${signal}]\n`);
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        const id = msg['id'];
        if (typeof id === 'number') {
          const waiter = this.waiters.get(id);
          if (waiter) {
            this.waiters.delete(id);
            waiter(msg);
          }
        }
      } catch (err) {
        process.stderr.write(`[client] parse error: ${(err as Error).message}\n  line: ${line}\n`);
      }
    }
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise<T>((resolveFn, rejectFn) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(id);
        rejectFn(new Error(`request timeout: ${method}`));
      }, 5000);
      this.waiters.set(id, (msg) => {
        clearTimeout(timeout);
        if ('error' in msg) {
          rejectFn(new Error(`server error: ${JSON.stringify(msg['error'])}`));
        } else {
          resolveFn(msg['result'] as T);
        }
      });
      this.child.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    const req: JsonRpcRequest = { jsonrpc: '2.0', method, params };
    this.child.stdin.write(`${JSON.stringify(req)}\n`);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

async function main(): Promise<void> {
  void platform;
  const client = new StdioClient();

  console.log('-> initialize');
  const init = (await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'shinobi-smoke', version: '0.0.0' },
  })) as { protocolVersion: string; serverInfo: { name: string; version: string } };
  console.log(`<- protocolVersion=${init.protocolVersion} server=${init.serverInfo.name}@${init.serverInfo.version}`);
  client.notify('notifications/initialized');

  console.log('\n-> tools/list');
  const tools = (await client.request('tools/list', {})) as { tools: Array<{ name: string }> };
  console.log(`<- ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).slice(0, 6).join(', ')}, ...`);
  if (tools.tools.length < 30) {
    throw new Error(`expected at least 30 tools, got ${tools.tools.length}`);
  }

  console.log('\n-> tools/call create_project');
  const created = (await client.request('tools/call', {
    name: 'create_project',
    arguments: { title: 'MCP stdio smoke', priority: 'medium' },
  })) as { content: Array<{ type: string; text: string }> };
  const project = JSON.parse(created.content[0]!.text) as { id: number; title: string };
  console.log(`<- created project id=${project.id} title="${project.title}"`);

  console.log('\n-> tools/call list_projects');
  const listed = (await client.request('tools/call', {
    name: 'list_projects',
    arguments: {},
  })) as { content: Array<{ type: string; text: string }> };
  const projects = JSON.parse(listed.content[0]!.text) as unknown[];
  console.log(`<- ${projects.length} project(s)`);

  console.log('\n-> tools/call check_dead_ends (empty DB, no matches expected)');
  const check = (await client.request('tools/call', {
    name: 'check_dead_ends',
    arguments: { approach: 'mock the database in tests' },
  })) as { content: Array<{ type: string; text: string }> };
  const verdict = JSON.parse(check.content[0]!.text) as { verdict: string };
  console.log(`<- verdict=${verdict.verdict}`);

  console.log('\n-> tools/call delete_project (cleanup)');
  await client.request('tools/call', { name: 'delete_project', arguments: { project_id: project.id } });
  console.log('<- deleted');

  client.close();
  console.log('\nMCP STDIO OK');
}

main().catch((err: unknown) => {
  process.stderr.write(`smoke-mcp-stdio: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
