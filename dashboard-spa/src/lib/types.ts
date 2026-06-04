export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type DecisionKind = 'architecture' | 'library' | 'pattern' | 'tradeoff' | 'workaround' | 'other';
export type DecisionStatus = 'open' | 'fix_now' | 'fix_later' | 'wontfix' | 'fixed' | 'false_positive';
export type DraftStatus = 'pending' | 'approved' | 'rejected';

export interface Project {
  id: number;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  project_type: string | null;
  target_path: string | null;
  workspace: string | null;
  archived_at: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  recent_summary_md: string | null;
  recent_summary_at: string | null;
  recent_summary_provider: string | null;
  subtasks_total: number;
  subtasks_done: number;
}

export interface Subtask {
  id: number;
  project_id: number | null;
  title: string;
  description: string | null;
  depends_on: number[] | null;
  sort_order: number;
  status: Status;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  claude_session_id: string | null;
  last_claimed_at: string | null;
  files_touched: string[] | null;
}

export interface Decision {
  id: number;
  project_id: number;
  subtask_id: number | null;
  kind: DecisionKind;
  summary: string;
  rationale: string;
  alternatives_considered: string | null;
  files_touched: string[] | null;
  tags: string[] | null;
  status: DecisionStatus;
  decided_at: string | null;
  claude_session_id: string | null;
  created_at: string;
}

export interface DeadEnd {
  id: number;
  project_id: number;
  attempted_approach: string;
  failure_reason: string;
  files_involved: string[] | null;
  never_retry: boolean;
  claude_session_id: string | null;
  created_at: string;
}

export interface Note {
  id: number;
  project_id: number | null;
  body: string;
  tags: string[] | null;
  files_touched: string[] | null;
  audio_path: string | null;
  claude_session_id: string | null;
  created_at: string;
}

export interface Plan {
  id: number;
  project_id: number;
  version: number;
  plan_md: string;
  claude_session_id: string | null;
  created_at: string;
}

export interface PlanVersion {
  id: number;
  version: number;
  claude_session_id: string | null;
  created_at: string;
  plan_md_length: number;
}

export interface Context {
  project_id: number;
  conventions: string | null;
  dont_touch: string[] | null;
  test_patterns: string | null;
  deploy_notes: string | null;
  file_annotations: Record<string, string> | null;
  last_validated_commit: string | null;
  updated_at: string;
}

export interface ActivityRow {
  id: number;
  project_id: number | null;
  session_id: string | null;
  action_type: string;
  action_details: string | null;
  entity_type: string | null;
  entity_id: number | null;
  ref_url: string | null;
  ref_status: string | null;
  created_at: string;
}

export interface Session {
  session_id: string;
  project_id: number | null;
  subtask_id: number | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tool_calls_count: number;
  files_touched_count: number;
  notes: string | null;
}

export interface DecisionDraft {
  id: number;
  project_id: number;
  session_id: string | null;
  kind: DecisionKind;
  summary: string;
  rationale: string;
  alternatives_considered: string | null;
  files_touched: string[] | null;
  status: DraftStatus;
  approved_decision_id: number | null;
  source: string;
  extractor_model: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface DraftCounts {
  pending: number;
  approved: number;
  rejected: number;
}

export interface SyncConfig {
  repo_path: string;
  branch: string;
  last_push_at: string | null;
  last_pull_at: string | null;
}

export interface SyncStatusResponse {
  configured: boolean;
  sync: SyncConfig | null;
}

export interface SyncActionResponse {
  ok: boolean;
  action?: 'push' | 'pull';
  elapsed_ms?: number;
  sync?: SyncConfig;
  error?: string;
}
