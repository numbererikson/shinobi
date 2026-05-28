import type {
  ActivityRow,
  Decision,
  DecisionDraft,
  DecisionStatus,
  DraftCounts,
  Plan,
  PlanVersion,
  Project,
  Session,
  Subtask,
  SyncActionResponse,
  SyncStatusResponse,
  Context as ContextRow,
  DeadEnd,
  Note,
} from './types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function listProjects(opts?: { sort?: 'active' | 'priority' | 'created'; include_archived?: boolean }): Promise<Project[]> {
  const params = new URLSearchParams();
  if (opts?.sort) params.set('sort', opts.sort);
  if (opts?.include_archived) params.set('include_archived', 'true');
  const qs = params.toString();
  return jsonFetch<Project[]>(`/api/projects${qs ? `?${qs}` : ''}`);
}

export interface ProjectSnapshot {
  project: Project;
  subtasks: Subtask[];
  decisions: Decision[];
  dead_ends: DeadEnd[];
  notes: Note[];
  activity: ActivityRow[];
  sessions: Session[];
  context: ContextRow | null;
  latest_plan: Plan | null;
  plan_history: PlanVersion[];
  draft_counts: DraftCounts;
}

export function getProjectSnapshot(id: number): Promise<ProjectSnapshot> {
  return jsonFetch<ProjectSnapshot>(`/api/projects/${id}/snapshot`);
}

export interface RecallResult {
  query: string;
  projects: Project[];
  subtasks: Subtask[];
  decisions: Decision[];
  dead_ends: DeadEnd[];
  notes: Note[];
}

export function recall(query: string, limit = 8): Promise<RecallResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return jsonFetch<RecallResult>(`/api/recall?${params.toString()}`);
}

export function patchSubtask(id: number, patch: Partial<Pick<Subtask, 'status'>>): Promise<{ ok: boolean; subtask: Subtask | null }> {
  return jsonFetch(`/api/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function patchDecisionStatus(id: number, status: DecisionStatus): Promise<{ ok: boolean; decision: Decision | null }> {
  return jsonFetch(`/api/decisions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export function getDecisionDrafts(projectId: number): Promise<{ drafts: DecisionDraft[]; counts: DraftCounts }> {
  return jsonFetch(`/api/projects/${projectId}/decision-drafts`);
}

export function approveDraft(id: number): Promise<{ ok: boolean; decision_id: number; draft: DecisionDraft }> {
  return jsonFetch(`/api/decision-drafts/${id}/approve`, { method: 'POST', body: '{}' });
}

export function rejectDraft(id: number): Promise<{ ok: boolean; draft: DecisionDraft }> {
  return jsonFetch(`/api/decision-drafts/${id}/reject`, { method: 'POST', body: '{}' });
}

export function listAllSessions(limit = 200): Promise<Session[]> {
  return jsonFetch<Session[]>(`/api/sessions?limit=${limit}`);
}

export function getSessionDetail(sessionId: string): Promise<{ session: Session; activity: ActivityRow[] }> {
  return jsonFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export interface SettingSpec {
  key: string;
  label: string;
  description: string;
  group: 'storage' | 'dashboard' | 'embedding' | 'llm' | 'recall' | 'sync';
  secret?: boolean;
  enumValues?: string[];
  placeholder?: string;
  requiresRestart?: boolean;
}

export interface RedactedSetting {
  key: string;
  value: string | null;
  is_set: boolean;
  is_secret: boolean;
}

export interface SettingsResponse {
  specs: SettingSpec[];
  values: RedactedSetting[];
}

export interface WriteSettingsResponse {
  ok: boolean;
  written?: number;
  cleared?: number;
  backup_path?: string | null;
  env_path?: string;
  values?: RedactedSetting[];
  error?: string;
}

export function getSettings(): Promise<SettingsResponse> {
  return jsonFetch<SettingsResponse>('/api/settings');
}

export function patchSettings(patch: Record<string, string | null>): Promise<WriteSettingsResponse> {
  return jsonFetch<WriteSettingsResponse>('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ patch }),
  });
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  user_agent: string | null;
  created_at: string;
  last_sent_at: string | null;
  last_error: string | null;
}

export interface Approval {
  id: number;
  project_id: number | null;
  session_id: string | null;
  prompt: string;
  options: string[];
  status: 'pending' | 'responded' | 'expired' | 'cancelled';
  response_value: string | null;
  response_note: string | null;
  responded_at: string | null;
  responded_by: string | null;
  expires_at: string | null;
  created_at: string;
}

export function getVapidPublicKey(): Promise<{ public_key: string }> {
  return jsonFetch('/api/push/vapid-key');
}

export function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  return jsonFetch('/api/push/subscriptions');
}

export function postPushSubscription(input: { endpoint: string; keys: { p256dh: string; auth: string }; device_label?: string }): Promise<{ ok: boolean; subscription: PushSubscriptionRow }> {
  return jsonFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify(input) });
}

export function deletePushSubscription(id: number): Promise<{ ok: boolean }> {
  return jsonFetch(`/api/push/subscriptions/${id}`, { method: 'DELETE' });
}

export function sendTestPush(): Promise<{ ok: boolean; total: number; succeeded: number; failed: number; pruned_endpoints: string[] }> {
  return jsonFetch('/api/push/test', { method: 'POST' });
}

export function listApprovalsApi(status?: 'pending' | 'responded' | 'expired' | 'cancelled'): Promise<Approval[]> {
  const qs = status ? `?status=${status}` : '';
  return jsonFetch<Approval[]>(`/api/approvals${qs}`);
}

export function respondToApprovalApi(id: number, value: string, note?: string): Promise<{ ok: boolean; approval: Approval }> {
  return jsonFetch(`/api/approvals/${id}/respond`, { method: 'POST', body: JSON.stringify({ value, note }) });
}

export function cancelApprovalApi(id: number): Promise<{ ok: boolean; approval: Approval }> {
  return jsonFetch(`/api/approvals/${id}/cancel`, { method: 'POST', body: '{}' });
}

export function getSyncStatus(): Promise<SyncStatusResponse> {
  return jsonFetch<SyncStatusResponse>('/api/sync/status');
}

export function syncPush(): Promise<SyncActionResponse> {
  return jsonFetch<SyncActionResponse>('/api/sync/push', { method: 'POST' });
}

export function syncPull(): Promise<SyncActionResponse> {
  return jsonFetch<SyncActionResponse>('/api/sync/pull', { method: 'POST' });
}

export interface TaskTimeStats {
  subtask_id: number;
  total_seconds: number;
  total_minutes: number;
  session_count: number;
  open_sessions: number;
  first_session_at: string | null;
  last_session_at: string | null;
}

export interface ProjectTimeStats {
  project_id: number;
  total_seconds: number;
  total_minutes: number;
  session_count: number;
  per_subtask: TaskTimeStats[];
}

export function getTaskTimeStats(id: number): Promise<TaskTimeStats> {
  return jsonFetch<TaskTimeStats>(`/api/tasks/${id}/time-stats`);
}

export function getProjectTimeStats(id: number): Promise<ProjectTimeStats> {
  return jsonFetch<ProjectTimeStats>(`/api/projects/${id}/time-stats`);
}

export interface TaskCostStats {
  subtask_id: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  session_count: number;
  by_model: Array<{ model: string; cost_usd: number; sessions: number }>;
}

export interface ProjectCostStats {
  project_id: number;
  total_cost_usd: number;
  session_count: number;
  per_subtask: TaskCostStats[];
}

export function getTaskCostStats(id: number): Promise<TaskCostStats> {
  return jsonFetch<TaskCostStats>(`/api/tasks/${id}/cost-stats`);
}

export function getProjectCostStats(id: number): Promise<ProjectCostStats> {
  return jsonFetch<ProjectCostStats>(`/api/projects/${id}/cost-stats`);
}

export interface CostIngestResult {
  ok: boolean;
  scanned: number;
  parsed: number;
  upserted: number;
  total_cost_usd: number;
  errors: Array<{ path: string; error: string }>;
}

export function costIngest(opts: { source?: string; since_hours?: number; project?: string } = {}): Promise<CostIngestResult> {
  return jsonFetch<CostIngestResult>('/api/cost/ingest', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export interface LoadedPlugin {
  name: string;
  source: 'user' | 'npm';
  module_path: string;
  tools_registered: string[];
  error: string | null;
}

export interface InstalledPlugin {
  name: string;
  version: string;
  description: string;
  module_path: string;
}

export interface PluginsResponse {
  loaded: LoadedPlugin[];
  installed: InstalledPlugin[];
  install_prefix: string;
}

export interface MarketplaceHit {
  name: string;
  description: string;
  version: string;
  author: string | null;
  date: string | null;
  links: { npm?: string; homepage?: string; repository?: string };
  installed: boolean;
}

export function listPlugins(): Promise<PluginsResponse> {
  return jsonFetch<PluginsResponse>('/api/plugins');
}

export function searchPluginMarketplace(query: string): Promise<{ results: MarketplaceHit[] }> {
  return jsonFetch('/api/plugins/search', { method: 'POST', body: JSON.stringify({ query }) });
}

export function installPlugin(pkg: string): Promise<{ ok: boolean; pkg: string; stdout: string; stderr: string }> {
  return jsonFetch('/api/plugins/install', { method: 'POST', body: JSON.stringify({ pkg }) });
}

export function uninstallPlugin(pkg: string): Promise<{ ok: boolean; pkg: string; stdout: string; stderr: string }> {
  return jsonFetch(`/api/plugins/${encodeURIComponent(pkg)}`, { method: 'DELETE' });
}

export interface TelemetrySummary {
  enabled: boolean;
  total_events: number;
  unsent_events: number;
  last_recorded_at: string | null;
  last_sent_at: string | null;
  endpoint_configured: boolean;
  by_event_type: Array<{ event_type: string; count: number }>;
  last_7d_count: number;
}

export function getTelemetrySummary(): Promise<TelemetrySummary> {
  return jsonFetch<TelemetrySummary>('/api/telemetry/summary');
}

export function flushTelemetry(): Promise<{ ok: boolean; attempted: number; sent: number; endpoint: string | null; error?: string }> {
  return jsonFetch('/api/telemetry/flush', { method: 'POST', body: '{}' });
}

export interface RelayStatus {
  connected: boolean;
  url: string | null;
  workspace: string | null;
  agent_id: string;
  last_event_at: string | null;
  last_event_type: 'sync-available' | 'activity' | 'presence' | null;
  last_error: string | null;
  reconnect_attempts: number;
}

export function getRelayStatus(): Promise<RelayStatus> {
  return jsonFetch<RelayStatus>('/api/relay/status');
}

export function relayBroadcastSync(): Promise<{ ok: boolean; error?: string }> {
  return jsonFetch('/api/relay/broadcast-sync', { method: 'POST', body: '{}' });
}
