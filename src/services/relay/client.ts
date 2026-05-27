import WebSocket from 'ws';
import { hostname } from 'node:os';
import { stderr } from 'node:process';
import { readEnvFile } from '../../dashboard/settings-store.js';
import { syncPull } from '../../commands/sync.js';
import type { RelayClientStatus, RelayEnvelope, RelayEventType } from './types.js';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 25_000;
const PULL_DEBOUNCE_MS = 1500;

type Listener = (envelope: RelayEnvelope) => void;

interface RelayEnv {
  url: string | null;
  token: string | null;
  workspace: string | null;
}

function readRelayEnv(): RelayEnv {
  const env = readEnvFile().values;
  const get = (k: string): string | null => env[k] ?? process.env[k] ?? null;
  return {
    url: get('SHINOBI_RELAY_URL'),
    token: get('SHINOBI_RELAY_TOKEN'),
    workspace: get('SHINOBI_RELAY_WORKSPACE'),
  };
}

function generateAgentId(): string {
  const host = hostname().replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${host}-${rand}`;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pullTimer: NodeJS.Timeout | null = null;
  private listeners: Set<Listener> = new Set();
  private pullingNow = false;
  private status: RelayClientStatus;
  private intentionallyClosed = false;

  constructor(private readonly agentId: string = generateAgentId()) {
    this.status = {
      connected: false,
      url: null,
      workspace: null,
      agent_id: agentId,
      last_event_at: null,
      last_event_type: null,
      last_error: null,
      reconnect_attempts: 0,
    };
  }

  getStatus(): RelayClientStatus {
    return { ...this.status };
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    const env = readRelayEnv();
    if (!env.url || !env.workspace) {
      // Relay not configured — silent no-op.
      return;
    }
    this.intentionallyClosed = false;
    this.status.url = env.url;
    this.status.workspace = env.workspace;
    this.connect(env);
  }

  stop(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pullTimer) {
      clearTimeout(this.pullTimer);
      this.pullTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.status.connected = false;
  }

  broadcast(type: RelayEventType, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const env = readRelayEnv();
    if (!env.workspace) return;
    const envelope: RelayEnvelope = {
      type,
      workspace: env.workspace,
      source_agent: this.agentId,
      ts: new Date().toISOString(),
      payload,
    };
    try {
      this.ws.send(JSON.stringify(envelope));
    } catch (err) {
      this.status.last_error = err instanceof Error ? err.message : String(err);
    }
  }

  private connect(env: RelayEnv): void {
    if (!env.url || !env.workspace) return;
    const url = new URL(env.url);
    url.searchParams.set('workspace', env.workspace);
    url.searchParams.set('agent', this.agentId);
    if (env.token) url.searchParams.set('token', env.token);

    try {
      this.ws = new WebSocket(url.toString());
    } catch (err) {
      this.status.last_error = err instanceof Error ? err.message : String(err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.status.connected = true;
      this.status.reconnect_attempts = 0;
      this.status.last_error = null;
      stderr.write(`relay: connected to ${env.url} as ${this.agentId}\n`);
      this.startHeartbeat();
      this.broadcast('presence', { event: 'hello' });
    });

    this.ws.on('message', (raw) => {
      try {
        const envelope = JSON.parse(raw.toString()) as RelayEnvelope;
        if (envelope.source_agent === this.agentId) return; // ignore own echo
        this.status.last_event_at = new Date().toISOString();
        this.status.last_event_type = envelope.type;
        for (const listener of this.listeners) listener(envelope);
        if (envelope.type === 'sync-available') this.scheduleAutoPull();
      } catch (err) {
        this.status.last_error = `parse: ${err instanceof Error ? err.message : String(err)}`;
      }
    });

    this.ws.on('error', (err: Error) => {
      this.status.last_error = err.message;
    });

    this.ws.on('close', () => {
      this.status.connected = false;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (!this.intentionallyClosed) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    const attempt = this.status.reconnect_attempts + 1;
    this.status.reconnect_attempts = attempt;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      const env = readRelayEnv();
      if (env.url && env.workspace) this.connect(env);
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {
          // ignored
        }
      }
    }, HEARTBEAT_MS);
  }

  private scheduleAutoPull(): void {
    if (this.pullTimer) clearTimeout(this.pullTimer);
    this.pullTimer = setTimeout(() => {
      if (this.pullingNow) return;
      this.pullingNow = true;
      try {
        syncPull();
        stderr.write(`relay: auto-pulled DB snapshot after peer sync-available event\n`);
      } catch (err) {
        this.status.last_error = `auto-pull: ${err instanceof Error ? err.message : String(err)}`;
        stderr.write(`relay: auto-pull failed: ${this.status.last_error}\n`);
      } finally {
        this.pullingNow = false;
      }
    }, PULL_DEBOUNCE_MS);
  }
}

let singleton: RelayClient | null = null;

export function getRelayClient(): RelayClient {
  if (!singleton) singleton = new RelayClient();
  return singleton;
}

export function broadcastSyncAvailable(meta: Record<string, unknown> = {}): void {
  if (!singleton) return;
  singleton.broadcast('sync-available', meta);
}
