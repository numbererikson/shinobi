// Shinobi relay — minimal Cloudflare Worker + Durable Object that broadcasts
// sync events between multiple agents working on the same workspace.
//
// Protocol:
//   - Each agent connects via WebSocket: /ws?workspace=<id>&agent=<id>&token=<secret>
//   - Token must match the SHINOBI_RELAY_TOKEN secret set on the Worker.
//   - Workspace string routes to a Durable Object instance (idFromName).
//   - Anything an agent sends is broadcast to every OTHER connected agent in
//     the same workspace, plus echoed once over HTTP POST /event.
//   - Server only re-broadcasts; it stores no state beyond presence.

export interface Env {
  WORKSPACES: DurableObjectNamespace;
  SHINOBI_RELAY_TOKEN?: string;
}

interface PresenceEntry {
  agent: string;
  joined_at: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({ ok: true, name: 'shinobi-relay', ts: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.pathname === '/ws') {
      return handleWebsocket(request, env, url);
    }
    if (url.pathname === '/event' && request.method === 'POST') {
      return handleHttpEvent(request, env, url);
    }
    return new Response('not found', { status: 404 });
  },
};

function checkToken(env: Env, provided: string | null): boolean {
  if (!env.SHINOBI_RELAY_TOKEN) return true; // no token configured = open relay (dev only)
  return provided === env.SHINOBI_RELAY_TOKEN;
}

async function handleWebsocket(request: Request, env: Env, url: URL): Promise<Response> {
  const upgrade = request.headers.get('Upgrade');
  if (upgrade !== 'websocket') {
    return new Response('expected websocket upgrade', { status: 426 });
  }
  const workspace = url.searchParams.get('workspace');
  const agent = url.searchParams.get('agent');
  const token = url.searchParams.get('token');
  if (!workspace || !agent) {
    return new Response('workspace and agent params required', { status: 400 });
  }
  if (!checkToken(env, token)) {
    return new Response('invalid token', { status: 401 });
  }
  const id = env.WORKSPACES.idFromName(workspace);
  const stub = env.WORKSPACES.get(id);
  return stub.fetch(request);
}

async function handleHttpEvent(request: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? request.headers.get('x-shinobi-token');
  if (!checkToken(env, token)) {
    return new Response('invalid token', { status: 401 });
  }
  const workspace = url.searchParams.get('workspace');
  if (!workspace) return new Response('workspace required', { status: 400 });
  const id = env.WORKSPACES.idFromName(workspace);
  const stub = env.WORKSPACES.get(id);
  return stub.fetch(request);
}

export class WorkspaceRelay {
  private sessions: Map<WebSocket, PresenceEntry> = new Map();

  constructor(_state: DurableObjectState, _env: Env) {
    // Stateless beyond live connections; no storage needed.
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.handleWsConnect(request, url);
    if (url.pathname === '/event' && request.method === 'POST') {
      const body = await request.text();
      this.broadcast(body, null);
      return new Response(JSON.stringify({ ok: true, sent_to: this.sessions.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }

  private async handleWsConnect(_request: Request, url: URL): Promise<Response> {
    const agent = url.searchParams.get('agent') ?? 'anonymous';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const entry: PresenceEntry = { agent, joined_at: new Date().toISOString() };
    this.sessions.set(server, entry);

    // Announce presence to the new joiner (list of currently connected peers).
    const peers = [...this.sessions.values()].filter((p) => p.agent !== agent).map((p) => p.agent);
    server.send(
      JSON.stringify({
        type: 'presence',
        workspace: url.searchParams.get('workspace'),
        source_agent: '__relay__',
        ts: new Date().toISOString(),
        payload: { event: 'roster', peers },
      }),
    );

    server.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      this.broadcast(raw, server);
    });

    const cleanup = (): void => {
      this.sessions.delete(server);
      this.broadcast(
        JSON.stringify({
          type: 'presence',
          workspace: url.searchParams.get('workspace'),
          source_agent: '__relay__',
          ts: new Date().toISOString(),
          payload: { event: 'leave', agent },
        }),
        null,
      );
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(message: string, except: WebSocket | null): void {
    for (const [ws] of this.sessions) {
      if (ws === except) continue;
      try {
        ws.send(message);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }
}
