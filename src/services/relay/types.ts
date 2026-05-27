export type RelayEventType =
  | 'sync-available'
  | 'activity'
  | 'presence';

export interface RelayEnvelope {
  type: RelayEventType;
  workspace: string;
  source_agent: string;
  ts: string;
  payload: Record<string, unknown>;
}

export interface RelayClientStatus {
  connected: boolean;
  url: string | null;
  workspace: string | null;
  agent_id: string;
  last_event_at: string | null;
  last_event_type: RelayEventType | null;
  last_error: string | null;
  reconnect_attempts: number;
}
