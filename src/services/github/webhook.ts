// GitHub webhook handler. Validates HMAC-SHA256 (X-Hub-Signature-256),
// dispatches by X-GitHub-Event header, and updates pr_links + subtasks
// + decisions accordingly.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { recordActivity } from '../../models/activity.js';
import { logDecision } from '../../models/decisions.js';
import { getByRepoPr, markPrState, upsertPrLink } from '../../models/pr_links.js';
import { getSubtask, updateSubtask } from '../../models/subtasks.js';
import { readEnvFile } from '../../dashboard/settings-store.js';

const TAG_RE = /\[SHI-(\d+)\]/i;
const DECISION_RE = /\/shinobi\s+decision\s+([a-zA-Z_-]+)\s*:\s*([\s\S]+)/i;

export interface WebhookContext {
  event: string;
  delivery: string;
  signature: string | null;
  body: Buffer;
  parsed: unknown;
}

export interface WebhookOutcome {
  ok: boolean;
  status: number;
  action?: string;
  detail?: string;
  error?: string;
}

function readSecret(): string | null {
  const env = readEnvFile().values;
  return env['SHINOBI_GITHUB_WEBHOOK_SECRET'] ?? process.env['SHINOBI_GITHUB_WEBHOOK_SECRET'] ?? null;
}

export function verifySignature(secret: string, body: Buffer, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  const computed = createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(provided, 'utf-8');
  const b = Buffer.from(computed, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractSubtaskTag(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = TAG_RE.exec(text);
  return m ? Number(m[1]) : null;
}

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    merged: boolean;
    closed_at: string | null;
    merged_at: string | null;
  };
  repository: { full_name: string };
}

interface IssueCommentPayload {
  action: string;
  comment: { body: string; html_url: string; user: { login: string } };
  issue: { number: number; pull_request?: { html_url: string } };
  repository: { full_name: string };
}

export function handleWebhook(ctx: WebhookContext): WebhookOutcome {
  const secret = readSecret();
  if (!secret) {
    return { ok: false, status: 503, error: 'SHINOBI_GITHUB_WEBHOOK_SECRET not configured' };
  }
  if (!verifySignature(secret, ctx.body, ctx.signature)) {
    return { ok: false, status: 401, error: 'invalid signature' };
  }

  if (ctx.event === 'ping') return { ok: true, status: 200, action: 'pong' };
  if (ctx.event === 'pull_request') return handlePullRequest(ctx.parsed as PullRequestPayload);
  if (ctx.event === 'issue_comment') return handleIssueComment(ctx.parsed as IssueCommentPayload);

  return { ok: true, status: 200, action: 'ignored', detail: `event=${ctx.event}` };
}

function handlePullRequest(payload: PullRequestPayload): WebhookOutcome {
  const pr = payload.pull_request;
  const repo = payload.repository.full_name;
  const tag =
    extractSubtaskTag(pr.title) ??
    extractSubtaskTag(pr.body) ??
    null;

  if (payload.action === 'opened' || payload.action === 'reopened' || payload.action === 'edited') {
    if (!tag) return { ok: true, status: 200, action: 'no_tag' };
    const subtask = getSubtask(tag);
    if (!subtask) return { ok: true, status: 200, action: 'subtask_not_found', detail: `[SHI-${tag}]` };
    upsertPrLink({
      subtask_id: tag,
      project_id: subtask.project_id ?? null,
      repo,
      pr_number: pr.number,
      pr_url: pr.html_url,
      title: pr.title,
      state: 'open',
    });
    recordActivity({
      project_id: subtask.project_id ?? null,
      session_id: null,
      action_type: 'pr_opened',
      action_details: `${repo}#${pr.number}: ${pr.title}`,
      entity_type: 'pull_request',
      entity_id: pr.number,
      ref_url: pr.html_url,
    });
    return { ok: true, status: 200, action: 'linked', detail: `[SHI-${tag}] ↔ ${repo}#${pr.number}` };
  }

  if (payload.action === 'closed') {
    const newState: 'merged' | 'closed' = pr.merged ? 'merged' : 'closed';
    const link = markPrState({
      repo,
      pr_number: pr.number,
      state: newState,
      closed_at: pr.closed_at,
      merged_at: pr.merged_at,
    });
    if (!link) return { ok: true, status: 200, action: 'unknown_pr' };
    if (newState === 'merged') {
      // Auto-complete the linked subtask.
      updateSubtask(link.subtask_id, { status: 'done' });
      recordActivity({
        project_id: link.project_id,
        session_id: null,
        action_type: 'subtask_auto_completed',
        action_details: `merged ${repo}#${pr.number}: ${pr.title}`,
        entity_type: 'subtask',
        entity_id: link.subtask_id,
        ref_url: pr.html_url,
      });
      return { ok: true, status: 200, action: 'auto_completed', detail: `subtask #${link.subtask_id} → done` };
    }
    recordActivity({
      project_id: link.project_id,
      session_id: null,
      action_type: 'pr_closed_without_merge',
      action_details: `closed without merge: ${repo}#${pr.number}`,
      entity_type: 'pull_request',
      entity_id: pr.number,
      ref_url: pr.html_url,
    });
    return { ok: true, status: 200, action: 'closed_no_merge' };
  }

  return { ok: true, status: 200, action: 'ignored_pr_action', detail: payload.action };
}

function handleIssueComment(payload: IssueCommentPayload): WebhookOutcome {
  if (payload.action !== 'created') return { ok: true, status: 200, action: 'ignored_comment_action' };
  if (!payload.issue.pull_request) return { ok: true, status: 200, action: 'comment_on_issue_not_pr' };

  const match = DECISION_RE.exec(payload.comment.body);
  if (!match) return { ok: true, status: 200, action: 'no_decision_syntax' };

  const kind = match[1]!.toLowerCase();
  const body = match[2]!.trim();

  const repo = payload.repository.full_name;
  const link = getByRepoPr(repo, payload.issue.number);
  if (!link) return { ok: true, status: 200, action: 'no_linked_pr' };
  if (link.project_id === null) return { ok: true, status: 200, action: 'pr_has_no_project' };

  const validKinds = ['architecture', 'library', 'pattern', 'tradeoff', 'workaround', 'other'] as const;
  const normalizedKind: (typeof validKinds)[number] = (validKinds as readonly string[]).includes(kind)
    ? (kind as (typeof validKinds)[number])
    : 'other';

  const summary = body.split('\n')[0]!.slice(0, 200);
  const rationale = body.length > summary.length ? body : summary;
  const decision = logDecision({
    project_id: link.project_id,
    subtask_id: link.subtask_id,
    summary,
    rationale,
    kind: normalizedKind,
  });
  recordActivity({
    project_id: link.project_id,
    session_id: null,
    action_type: 'decision_from_pr_comment',
    action_details: `${repo}#${link.pr_number} by ${payload.comment.user.login}: ${summary.slice(0, 120)}`,
    entity_type: 'decision',
    entity_id: decision.id,
    ref_url: payload.comment.html_url,
  });
  return { ok: true, status: 200, action: 'decision_logged', detail: `decision #${decision.id} (${normalizedKind})` };
}
