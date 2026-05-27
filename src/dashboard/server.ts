import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { cwd, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createAuthMiddleware,
  dashboardTokenPath,
  isLoopbackHost,
  resolveDashboardToken,
  type AuthMiddlewareOptions,
} from './auth.js';
import { listActivity } from '../models/activity.js';
import { getContext } from '../models/context.js';
import { listDeadEnds } from '../models/dead_ends.js';
import { listDecisions, updateDecisionStatus, type DecisionStatus } from '../models/decisions.js';
import { listNotes } from '../models/notes.js';
import { getLatestPlan, listPlanVersions } from '../models/plans.js';
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  unarchiveProject,
  updateProject,
  type Priority,
  type Status,
} from '../models/projects.js';
import { listSubtasks, getSubtask, setSubtaskAssignee, updateSubtask, type Subtask } from '../models/subtasks.js';
import { getSession, getProjectTimeStats, getTaskTimeStats, listSessions } from '../models/sessions.js';
import { getProjectCostStats, getTaskCostStats } from '../models/session_costs.js';
import { costIngest } from '../commands/cost.js';
import { handleWebhook } from '../services/github/webhook.js';
import { listLinksForProject } from '../models/pr_links.js';
import { detectAvailableProvider } from '../services/embedding/detect.js';
import { listLoadedPlugins } from '../services/plugins/state.js';
import {
  installPackage,
  listInstalled,
  pluginsNpmDir,
  searchMarketplace,
  uninstallPackage,
} from '../services/plugins/marketplace.js';
import {
  flushTelemetry,
  getTelemetrySummary,
  isTelemetryEnabled,
  trackEvent,
} from '../services/telemetry/client.js';
import { listSavedDigests, runDigest } from '../commands/digest.js';
import { startDigestScheduler } from '../services/digest/scheduler.js';
import {
  countUsers,
  createUser,
  findUserByEmail,
  listUsers,
  setRole,
  type UserRole,
} from '../models/users.js';
import {
  addMember,
  listMembers,
  removeMember,
  type ProjectRole,
} from '../models/project_members.js';
import { issueMagicLink, verifyMagicLink } from '../services/auth/magic-link.js';
import {
  acknowledgeAllMentions,
  acknowledgeMention,
  getMentionsForUser,
  recordMentions,
} from '../services/mentions/resolver.js';
import {
  clearSessionCookie,
  effectiveUser,
  setSessionCookie,
} from '../services/auth/session.js';
import {
  approveDraft,
  countDraftsByStatus,
  listDrafts,
  rejectDraft,
} from '../models/decision_drafts.js';
import { syncPull, syncPush } from '../commands/sync.js';
import { loadConfig } from '../lib/config.js';
import { addNote } from '../models/notes.js';
import { recordActivity } from '../models/activity.js';
import { createDraft } from '../models/decision_drafts.js';
import { extractDecisions } from '../services/extraction/decision-extractor.js';
import { transcribeAudio } from '../services/transcription/whisper.js';
import { createHash } from 'node:crypto';
import { KNOWN_SETTINGS, listRedactedSettings, writeEnvPatch } from './settings-store.js';
import {
  deleteSubscription,
  listSubscriptions,
  upsertSubscription,
} from '../models/push_subscriptions.js';
import {
  cancelApproval,
  getApproval,
  listApprovals,
  respondToApproval,
  type ApprovalStatus,
} from '../models/approvals.js';
import { ensureVapidConfigured, sendPushToAll } from '../services/push/web-push.js';
import { broadcastSyncAvailable, getRelayClient } from '../services/relay/client.js';

export interface StartDashboardOptions {
  port?: number;
  host?: string;
  /**
   * Override auth. When omitted, auth is auto-enabled for non-loopback hosts
   * and disabled for 127.0.0.1 / localhost / ::1.
   */
  auth?: AuthMiddlewareOptions;
}

const STATUS_VALUES = ['todo', 'in_progress', 'done'] as const;
const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
const DECISION_STATUS_VALUES = ['open', 'fix_now', 'fix_later', 'wontfix', 'fixed', 'false_positive'] as const;

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

const __filename = fileURLToPath(import.meta.url);
const SPA_DIR = resolve(dirname(__filename), '..', '..', 'dist', 'dashboard-spa');
const SPA_INDEX_PATH = resolve(SPA_DIR, 'index.html');

let cachedSpaIndex: string | null = null;
function loadSpaIndex(): string | null {
  if (cachedSpaIndex !== null) return cachedSpaIndex;
  if (!existsSync(SPA_INDEX_PATH)) return null;
  cachedSpaIndex = readFileSync(SPA_INDEX_PATH, 'utf-8');
  return cachedSpaIndex;
}

function buildApp(auth?: AuthMiddlewareOptions): Hono {
  const app = new Hono();

  if (auth?.enabled) {
    app.use('*', createAuthMiddleware(auth));
  }

  // Track dashboard hits (opt-in, no-op when SHINOBI_TELEMETRY=off).
  app.use('*', async (c, next) => {
    await next();
    if (!isTelemetryEnabled()) return;
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/assets/') || path === '/health' || path === '/sw.js' || path.startsWith('/icon-')) return;
    // Bucket /projects/:id/... → /projects/:tab so we don't leak project IDs.
    let bucket = path;
    const match = /^\/projects\/\d+(\/[a-z-]+)?$/.exec(path);
    if (match) bucket = `/projects${match[1] ?? ''}`;
    trackEvent('view_hit', { path: bucket, status: c.res.status });
  });

  // SPA static assets (Vite-built JS/CSS bundles).
  // serveStatic resolves `root`/`path` relative to process.cwd(), which breaks
  // when the dashboard is launched from any directory other than the package
  // root. Convert paths to be relative to the cwd at call time so assets load
  // regardless of where the user invoked `shinobi dashboard`.
  const relSpaDir = relative(cwd(), SPA_DIR).replace(/\\/g, '/') || '.';
  app.use('/assets/*', serveStatic({ root: relSpaDir }));
  app.use('/manifest.webmanifest', serveStatic({ path: `${relSpaDir}/manifest.webmanifest` }));
  app.use('/sw.js', serveStatic({ path: `${relSpaDir}/sw.js` }));
  app.use('/icon-192.svg', serveStatic({ path: `${relSpaDir}/icon-192.svg` }));
  app.use('/icon-192.png', serveStatic({ path: `${relSpaDir}/icon-192.png` }));
  app.use('/icon-512.png', serveStatic({ path: `${relSpaDir}/icon-512.png` }));
  app.use('/apple-touch-icon.png', serveStatic({ path: `${relSpaDir}/apple-touch-icon.png` }));

  // SPA serves all GET routes (/, /projects/:id, /projects/:id/<tab>, /sessions, /sessions/:id, ...).
  // The catch-all at the bottom handles them; specific JSON / API routes registered
  // below are matched before the catch-all.

  app.post('/api/decision-drafts/:id/approve', async (c) => {
    const id = Number(c.req.param('id'));
    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      // empty body is fine — use draft fields as-is
    }
    try {
      const result = approveDraft(id, body);
      if (!result) return c.json({ ok: false, error: 'draft not found' }, 404);
      return c.json({ ok: true, decision_id: result.decisionId, draft: result.draft });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post('/api/decision-drafts/:id/reject', (c) => {
    const id = Number(c.req.param('id'));
    try {
      const draft = rejectDraft(id);
      if (!draft) return c.json({ ok: false, error: 'draft not found' }, 404);
      return c.json({ ok: true, draft });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.patch('/api/subtasks/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<Partial<Subtask>>();
    if (typeof body.status === 'string') {
      if (!isOneOf(STATUS_VALUES, body.status)) {
        return c.json({ ok: false, error: 'invalid status' }, 400);
      }
      const updated = updateSubtask(id, { status: body.status as Status });
      return c.json({ ok: updated !== null, subtask: updated });
    }
    return c.json({ ok: false, error: 'no recognized fields' }, 400);
  });

  app.patch('/api/decisions/:id/status', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json()) as { status?: string; fixed_in_commit_sha?: string };
    if (!body.status) return c.json({ ok: false, error: 'status required' }, 400);
    if (!isOneOf(DECISION_STATUS_VALUES, body.status)) {
      return c.json({ ok: false, error: 'invalid status' }, 400);
    }
    const updated = updateDecisionStatus(id, body.status as DecisionStatus, body.fixed_in_commit_sha);
    return c.json({ ok: updated !== null, decision: updated });
  });

  app.get('/api/projects', (c) => {
    const sort = c.req.query('sort');
    const includeArchived = c.req.query('include_archived') === 'true';
    const workspace = c.req.query('workspace');
    const opts: Parameters<typeof listProjects>[0] = { includeArchived };
    if (sort === 'active' || sort === 'priority' || sort === 'created') opts.sort = sort;
    if (workspace) opts.workspace = workspace;
    return c.json(listProjects(opts));
  });

  app.get('/api/projects/:id/snapshot', (c) => {
    const id = Number(c.req.param('id'));
    const project = getProject(id);
    if (!project) return c.json({ error: 'not found' }, 404);
    return c.json({
      project,
      subtasks: listSubtasks({ projectId: id }),
      decisions: listDecisions({ projectId: id, limit: 500 }),
      dead_ends: listDeadEnds({ projectId: id, limit: 500 }),
      notes: listNotes({ projectId: id, limit: 500 }),
      activity: listActivity({ projectId: id, limit: 500 }),
      sessions: listSessions(id, 500),
      context: getContext(id),
      latest_plan: getLatestPlan(id),
      plan_history: listPlanVersions(id),
      draft_counts: countDraftsByStatus(id),
    });
  });

  app.get('/api/projects/:id/decision-drafts', (c) => {
    const id = Number(c.req.param('id'));
    const project = getProject(id);
    if (!project) return c.json({ error: 'not found' }, 404);
    return c.json({
      drafts: listDrafts({ projectId: id, limit: 500 }),
      counts: countDraftsByStatus(id),
    });
  });

  app.get('/api/sessions', (c) => {
    const limit = Number(c.req.query('limit') ?? '200');
    return c.json(listSessions(undefined, limit));
  });

  app.get('/api/sessions/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    const session = getSession(sessionId);
    if (!session) return c.json({ error: 'not found' }, 404);
    return c.json({
      session,
      activity: listActivity({ sessionId, limit: 500 }),
    });
  });

  // Health endpoint is intentionally unauthenticated for probes.
  app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

  app.post('/api/projects', async (c) => {
    const body = (await c.req.json()) as { title?: string };
    if (!body.title) return c.json({ error: 'title required' }, 400);
    const project = createProject({ title: body.title });
    return c.json({ project }, 201);
  });

  app.patch('/api/projects/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json()) as Record<string, unknown>;
    if ('status' in body && !isOneOf(STATUS_VALUES, body['status'])) {
      return c.json({ ok: false, error: 'invalid status' }, 400);
    }
    if ('priority' in body && !isOneOf(PRIORITY_VALUES, body['priority'])) {
      return c.json({ ok: false, error: 'invalid priority' }, 400);
    }
    const updated = updateProject(id, body as { status?: Status; priority?: Priority });
    return c.json({ ok: updated !== null, project: updated });
  });

  app.post('/api/projects/:id/archive', (c) => {
    const id = Number(c.req.param('id'));
    return c.json({ project: archiveProject(id) });
  });

  app.post('/api/projects/:id/unarchive', (c) => {
    const id = Number(c.req.param('id'));
    return c.json({ project: unarchiveProject(id) });
  });

  app.delete('/api/projects/:id', (c) => {
    const id = Number(c.req.param('id'));
    return c.json({ deleted: deleteProject(id) });
  });

  app.get('/api/tasks/:id', (c) => {
    const id = Number(c.req.param('id'));
    const subtask = getSubtask(id);
    return subtask ? c.json({ subtask }) : c.json({ error: 'not found' }, 404);
  });

  // ---- Sync (cross-machine DB snapshot) ----

  app.get('/api/sync/status', (c) => {
    const config = loadConfig();
    return c.json({
      configured: Boolean(config.sync),
      sync: config.sync ?? null,
    });
  });

  app.post('/api/sync/push', async (c) => {
    try {
      const started = Date.now();
      await syncPush();
      const config = loadConfig();
      return c.json({
        ok: true,
        action: 'push',
        elapsed_ms: Date.now() - started,
        sync: config.sync ?? null,
      });
    } catch (err) {
      return c.json(
        { ok: false, action: 'push', error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  app.post('/api/sync/pull', (c) => {
    try {
      const started = Date.now();
      syncPull();
      const config = loadConfig();
      return c.json({
        ok: true,
        action: 'pull',
        elapsed_ms: Date.now() - started,
        sync: config.sync ?? null,
      });
    } catch (err) {
      return c.json(
        { ok: false, action: 'pull', error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  // ---- Voice capture: audio → Whisper → text + actions ----

  app.post('/api/audio/transcribe', async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get('audio');
      if (!(file instanceof File)) {
        return c.json({ ok: false, error: 'audio file required' }, 400);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const result = await transcribeAudio(buf, file.name || 'recording.webm', file.type || 'audio/webm');
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  app.post('/api/voice/save-note', async (c) => {
    try {
      const body = (await c.req.json()) as { project_id?: number; text?: string; tags?: string[]; session_id?: string };
      if (!body.text || body.text.trim() === '') {
        return c.json({ ok: false, error: 'text required' }, 400);
      }
      const note = addNote({
        project_id: typeof body.project_id === 'number' ? body.project_id : null,
        body: body.text,
        tags: Array.isArray(body.tags) ? body.tags : ['voice'],
        claude_session_id: body.session_id ?? null,
      });
      recordActivity({
        project_id: note.project_id,
        session_id: note.claude_session_id,
        action_type: 'voice_note',
        action_details: body.text.slice(0, 200),
        entity_type: 'note',
        entity_id: note.id,
      });
      return c.json({ ok: true, note });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  app.post('/api/voice/meeting/process', async (c) => {
    // One-shot meeting pipeline: upload audio → Whisper transcribe → save
    // as a note tagged "meeting" → run decision extractor → return all
    // draft IDs so the user can review on the project Drafts tab.
    try {
      const form = await c.req.formData();
      const file = form.get('audio');
      const projectIdRaw = form.get('project_id');
      const sessionId = form.get('session_id');
      const titleRaw = form.get('title');
      if (!(file instanceof File)) return c.json({ ok: false, error: 'audio file required' }, 400);
      const projectId = typeof projectIdRaw === 'string' && projectIdRaw.length > 0 ? Number(projectIdRaw) : null;
      if (projectId === null || !Number.isFinite(projectId)) {
        return c.json({ ok: false, error: 'project_id required' }, 400);
      }

      const buf = Buffer.from(await file.arrayBuffer());
      const sizeBytes = buf.length;
      const transcription = await transcribeAudio(buf, file.name || 'meeting.webm', file.type || 'audio/webm');
      const transcript = transcription.text;
      if (transcript.length === 0) {
        return c.json({ ok: false, error: 'whisper returned empty transcript' }, 502);
      }

      const title = typeof titleRaw === 'string' && titleRaw.length > 0 ? titleRaw : `Meeting ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const noteBody = `# ${title}\n\n${transcript}`;
      const note = addNote({
        project_id: projectId,
        body: noteBody,
        tags: ['meeting', 'voice'],
        claude_session_id: typeof sessionId === 'string' ? sessionId : null,
      });
      recordActivity({
        project_id: projectId,
        session_id: typeof sessionId === 'string' ? sessionId : null,
        action_type: 'meeting_transcribed',
        action_details: `${title} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB, ${transcript.length} chars)`,
        entity_type: 'note',
        entity_id: note.id,
      });

      const extracted = await extractDecisions(transcript);
      const sourceHash = createHash('sha256').update(transcript).digest('hex').slice(0, 32);
      const draftIds = extracted.decisions.map((d) =>
        createDraft({
          project_id: projectId,
          session_id: typeof sessionId === 'string' ? sessionId : null,
          kind: d.kind,
          summary: d.summary,
          rationale: d.rationale,
          alternatives_considered: d.alternatives_considered,
          files_touched: d.files_touched,
          source: 'voice',
          extractor_model: `${extracted.provider}:${extracted.model}`,
          source_text_hash: sourceHash,
        }).id,
      );
      if (draftIds.length > 0) {
        recordActivity({
          project_id: projectId,
          session_id: typeof sessionId === 'string' ? sessionId : null,
          action_type: 'meeting_decisions_extracted',
          action_details: `${draftIds.length} draft(s) via ${extracted.provider}:${extracted.model}`,
          entity_type: 'project',
          entity_id: projectId,
        });
      }

      return c.json({
        ok: true,
        note_id: note.id,
        title,
        transcript_chars: transcript.length,
        audio_size_bytes: sizeBytes,
        audio_duration_seconds: transcription.duration_seconds,
        transcription_provider: transcription.provider,
        transcription_model: transcription.model,
        extractor_provider: extracted.provider,
        extractor_model: extracted.model,
        drafts_extracted: draftIds.length,
        draft_ids: draftIds,
      });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.post('/api/voice/extract-decisions', async (c) => {
    try {
      const body = (await c.req.json()) as { project_id?: number; text?: string; session_id?: string };
      if (!body.project_id || !body.text || body.text.trim() === '') {
        return c.json({ ok: false, error: 'project_id + text required' }, 400);
      }
      const result = await extractDecisions(body.text);
      const sourceHash = createHash('sha256').update(body.text).digest('hex').slice(0, 32);
      const persistedIds = result.decisions.map((d) =>
        createDraft({
          project_id: body.project_id!,
          session_id: body.session_id ?? null,
          kind: d.kind,
          summary: d.summary,
          rationale: d.rationale,
          alternatives_considered: d.alternatives_considered,
          files_touched: d.files_touched,
          source: 'voice',
          extractor_model: `${result.provider}:${result.model}`,
          source_text_hash: sourceHash,
        }).id,
      );
      recordActivity({
        project_id: body.project_id,
        session_id: body.session_id ?? null,
        action_type: 'voice_extract_decisions',
        action_details: `${persistedIds.length} draft(s) via ${result.provider}:${result.model}`,
        entity_type: 'project',
        entity_id: body.project_id,
      });
      return c.json({
        ok: true,
        provider: result.provider,
        model: result.model,
        drafts_extracted: result.decisions.length,
        persisted_draft_ids: persistedIds,
      });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  // ---- Web Push subscriptions ----

  app.get('/api/push/vapid-key', (c) => {
    try {
      const { publicKey } = ensureVapidConfigured();
      return c.json({ public_key: publicKey });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get('/api/push/subscriptions', (c) => {
    return c.json(listSubscriptions());
  });

  app.post('/api/push/subscribe', async (c) => {
    let body: {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      device_label?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return c.json({ ok: false, error: 'endpoint, keys.p256dh, keys.auth required' }, 400);
    }
    const ua = c.req.header('User-Agent') ?? null;
    const sub = upsertSubscription({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      device_label: body.device_label ?? null,
      user_agent: ua,
    });
    return c.json({ ok: true, subscription: sub });
  });

  app.delete('/api/push/subscriptions/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const removed = deleteSubscription(id);
    return c.json({ ok: removed });
  });

  app.post('/api/push/test', async (c) => {
    try {
      const result = await sendPushToAll({
        title: 'Shinobi test push',
        body: 'If you can see this, web push is configured correctly.',
        tag: 'shinobi-test',
        url: '/push',
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ---- Approvals ----

  app.get('/api/approvals', (c) => {
    const statusParam = c.req.query('status');
    const validStatuses: ApprovalStatus[] = ['pending', 'responded', 'expired', 'cancelled'];
    const status = statusParam && validStatuses.includes(statusParam as ApprovalStatus)
      ? (statusParam as ApprovalStatus)
      : undefined;
    return c.json(listApprovals(status ? { status } : {}));
  });

  app.post('/api/approvals/:id/respond', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    let body: { value?: string; note?: string; responded_by?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.value) return c.json({ ok: false, error: 'value required' }, 400);
    const approval = getApproval(id);
    if (!approval) return c.json({ ok: false, error: 'not found' }, 404);
    if (approval.status !== 'pending') {
      return c.json({ ok: false, error: `already ${approval.status}` }, 409);
    }
    const updated = respondToApproval(id, {
      value: body.value,
      note: body.note ?? null,
      responded_by: body.responded_by ?? 'dashboard',
    });
    return c.json({ ok: true, approval: updated });
  });

  app.post('/api/approvals/:id/cancel', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const approval = getApproval(id);
    if (!approval) return c.json({ ok: false, error: 'not found' }, 404);
    if (approval.status !== 'pending') {
      return c.json({ ok: false, error: `already ${approval.status}` }, 409);
    }
    const updated = cancelApproval(id);
    return c.json({ ok: true, approval: updated });
  });

  // ---- Time stats (per subtask + per project) ----

  app.get('/api/tasks/:id/time-stats', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json(getTaskTimeStats(id));
  });

  app.get('/api/projects/:id/time-stats', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json(getProjectTimeStats(id));
  });

  // ---- Cost stats (AI token spend per subtask / project) ----

  app.get('/api/tasks/:id/cost-stats', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json(getTaskCostStats(id));
  });

  app.get('/api/projects/:id/cost-stats', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json(getProjectCostStats(id));
  });

  app.post('/api/cost/ingest', async (c) => {
    let body: { source?: string; since_hours?: number; project?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // optional body
    }
    const result = costIngest({
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.since_hours !== undefined ? { sinceHours: body.since_hours } : {}),
      ...(body.project !== undefined ? { projectFilter: body.project } : {}),
      quiet: true,
    });
    return c.json({ ok: true, ...result });
  });

  // ---- Plugin marketplace ----

  app.get('/api/plugins', (c) => {
    return c.json({
      loaded: listLoadedPlugins(),
      installed: listInstalled(),
      install_prefix: pluginsNpmDir(),
    });
  });

  app.post('/api/plugins/search', async (c) => {
    let body: { query?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // optional body
    }
    const query = (body.query ?? '').trim();
    if (query.length === 0) return c.json({ results: [] });
    try {
      const results = await searchMarketplace(query);
      return c.json({ results });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.post('/api/plugins/install', async (c) => {
    let body: { pkg?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.pkg) return c.json({ ok: false, error: 'pkg required' }, 400);
    const result = await installPackage(body.pkg);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.delete('/api/plugins/:pkg{.+}', async (c) => {
    const pkg = decodeURIComponent(c.req.param('pkg'));
    const result = await uninstallPackage(pkg);
    return c.json(result, result.ok ? 200 : 400);
  });

  // ---- Auth (multi-user mode; transparent in single-user installs) ----

  app.get('/api/auth/me', (c) => {
    const u = effectiveUser(c);
    if (!u) return c.json({ ok: false, authenticated: false }, 401);
    if ('transparent' in u) {
      return c.json({ ok: true, authenticated: true, transparent: true, role: u.role });
    }
    return c.json({ ok: true, authenticated: true, user: u });
  });

  app.post('/api/auth/magic-link', async (c) => {
    let body: { email?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.email) return c.json({ ok: false, error: 'email required' }, 400);
    const user = findUserByEmail(body.email);
    if (!user) {
      // Soft-fail to avoid user enumeration; still log on server side.
      return c.json({ ok: true, sent: true, note: 'if the email matches a registered user, a link is now available' });
    }
    try {
      const issued = issueMagicLink(body.email);
      const verifyUrl = `${new URL(c.req.url).origin}/login?token=${issued.token}`;
      return c.json({
        ok: true,
        sent: true,
        // The dashboard does not send email itself yet. The operator can copy
        // this URL from the response and forward it manually (or via an
        // external mailer poller).
        magic_link: verifyUrl,
        expires_at: issued.expires_at,
      });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post('/api/auth/verify', async (c) => {
    let body: { token?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.token) return c.json({ ok: false, error: 'token required' }, 400);
    const result = verifyMagicLink(body.token);
    if (!result.ok) return c.json(result, 401);
    setSessionCookie(c, result.user.id);
    return c.json({ ok: true, user: result.user });
  });

  app.post('/api/auth/logout', (c) => {
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/auth/users', (c) => {
    return c.json({ users: listUsers(), count: countUsers() });
  });

  app.post('/api/auth/users', async (c) => {
    let body: { email?: string; name?: string; role?: UserRole };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.email) return c.json({ ok: false, error: 'email required' }, 400);
    const existing = findUserByEmail(body.email);
    if (existing) {
      const updated = body.role ? setRole(existing.id, body.role) : existing;
      return c.json({ ok: true, user: updated, created: false });
    }
    const createInput: Parameters<typeof createUser>[0] = { email: body.email };
    if (body.name !== undefined) createInput.name = body.name;
    if (body.role !== undefined) createInput.role = body.role;
    const u = createUser(createInput);
    return c.json({ ok: true, user: u, created: true });
  });

  // Per-project membership management.
  app.get('/api/projects/:id/members', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json({ members: listMembers(id) });
  });

  app.post('/api/projects/:id/members', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    let body: { user_id?: number; email?: string; role?: ProjectRole };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    let userId = body.user_id;
    if (!userId && body.email) {
      const u = findUserByEmail(body.email);
      if (!u) return c.json({ ok: false, error: 'user not found; create them via /api/auth/users first' }, 404);
      userId = u.id;
    }
    if (!userId) return c.json({ ok: false, error: 'user_id or email required' }, 400);
    const memberInput: Parameters<typeof addMember>[0] = { project_id: id, user_id: userId };
    if (body.role !== undefined) memberInput.role = body.role;
    const m = addMember(memberInput);
    return c.json({ ok: true, member: m });
  });

  app.delete('/api/projects/:id/members/:userId', (c) => {
    const id = Number(c.req.param('id'));
    const userId = Number(c.req.param('userId'));
    if (!Number.isFinite(id) || !Number.isFinite(userId)) return c.json({ ok: false, error: 'invalid id' }, 400);
    return c.json({ ok: removeMember(id, userId) });
  });

  // ---- Assignments + mentions ----

  app.patch('/api/subtasks/:id/assignee', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    let body: { user_id?: number | null };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    const userId = body.user_id ?? null;
    setSubtaskAssignee(id, userId);
    return c.json({ ok: true, subtask_id: id, assignee_user_id: userId });
  });

  app.get('/api/users/:userId/mentions', (c) => {
    const userId = Number(c.req.param('userId'));
    if (!Number.isFinite(userId)) return c.json({ error: 'invalid user id' }, 400);
    return c.json(getMentionsForUser(userId));
  });

  app.post('/api/mentions/:id/ack', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const u = effectiveUser(c);
    const userId = u && 'id' in u ? u.id : null;
    if (userId === null) return c.json({ ok: false, error: 'login required' }, 401);
    return c.json({ ok: acknowledgeMention(id, userId) });
  });

  app.post('/api/mentions/ack-all', (c) => {
    const u = effectiveUser(c);
    const userId = u && 'id' in u ? u.id : null;
    if (userId === null) return c.json({ ok: false, error: 'login required' }, 401);
    const count = acknowledgeAllMentions(userId);
    return c.json({ ok: true, acknowledged: count });
  });

  app.post('/api/mentions/scan', async (c) => {
    // Manual rescan endpoint: re-parses a decision/subtask/note body and
    // re-records its mentions. Useful after a body edit.
    let body: { entity_type?: 'decision' | 'subtask' | 'note'; entity_id?: number; text?: string; project_id?: number | null };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.entity_type || !body.entity_id || !body.text) {
      return c.json({ ok: false, error: 'entity_type, entity_id, text required' }, 400);
    }
    const u = effectiveUser(c);
    const byUser = u && 'id' in u ? u.id : null;
    const recorded = recordMentions(body.text, {
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      project_id: body.project_id ?? null,
      mentioned_by_user_id: byUser,
    });
    return c.json({ ok: true, mentioned: recorded });
  });

  // ---- Weekly digest ----

  app.get('/api/digests', (c) => {
    return c.json({ files: listSavedDigests() });
  });

  app.post('/api/digests/generate', async (c) => {
    let body: { workspace?: string; since?: string; until?: string; no_write?: boolean; telegram?: boolean } = {};
    try {
      body = await c.req.json();
    } catch {
      // optional body
    }
    const opts: Parameters<typeof runDigest>[0] = { quiet: true };
    if (body.workspace !== undefined) opts.workspace = body.workspace;
    if (body.since !== undefined) opts.sinceIso = body.since;
    if (body.until !== undefined) opts.untilIso = body.until;
    if (body.no_write !== undefined) opts.noWrite = body.no_write;
    if (body.telegram !== undefined) opts.telegram = body.telegram;
    try {
      const r = await runDigest(opts);
      return c.json({ ok: true, ...r });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ---- Telemetry (opt-in, anonymous) ----

  app.get('/api/telemetry/summary', (c) => {
    return c.json(getTelemetrySummary());
  });

  app.post('/api/telemetry/flush', async (c) => {
    const result = await flushTelemetry();
    return c.json(result, result.ok ? 200 : 502);
  });

  // ---- Embedding provider auto-detection ----

  app.get('/api/embedding/detect', async (c) => {
    try {
      const result = await detectAvailableProvider();
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ---- GitHub webhook + PR links ----

  app.post('/api/github/webhook', async (c) => {
    const event = c.req.header('X-GitHub-Event') ?? '';
    const delivery = c.req.header('X-GitHub-Delivery') ?? '';
    const signature = c.req.header('X-Hub-Signature-256') ?? null;
    const raw = await c.req.arrayBuffer();
    const body = Buffer.from(raw);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    const outcome = handleWebhook({ event, delivery, signature, body, parsed });
    return c.json(outcome, outcome.status as 200 | 400 | 401 | 503);
  });

  app.get('/api/projects/:id/pr-links', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json(listLinksForProject(id));
  });

  // ---- Multi-agent relay ----

  app.get('/api/relay/status', (c) => {
    return c.json(getRelayClient().getStatus());
  });

  app.post('/api/relay/broadcast-sync', (c) => {
    try {
      broadcastSyncAvailable({ source: 'dashboard-manual' });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ---- Settings (~/.shinobi/.env CRUD) ----

  app.get('/api/settings', (c) => {
    return c.json({
      specs: KNOWN_SETTINGS,
      values: listRedactedSettings(),
    });
  });

  app.post('/api/settings', async (c) => {
    let body: { patch?: Record<string, string | null | undefined> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    if (!body.patch || typeof body.patch !== 'object') {
      return c.json({ ok: false, error: 'patch object required' }, 400);
    }
    try {
      const result = writeEnvPatch(body.patch);
      return c.json({ ok: true, ...result, values: listRedactedSettings() });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // SPA fallback: any GET that didn't match an earlier route serves the
  // React SPA's index.html. React Router takes over client-side routing.
  // Skips /api/* (would already 404 via Hono, but be explicit).
  app.get('*', (c) => {
    const path = c.req.path;
    if (path.startsWith('/api/') || path.startsWith('/assets/')) {
      return c.notFound();
    }
    const spa = loadSpaIndex();
    if (spa) return c.html(spa);
    return c.text('SPA not built yet — run `npm run build:spa`', 503);
  });

  return app;
}

export async function startDashboard(options: StartDashboardOptions = {}): Promise<ServerType> {
  const port = options.port ?? Number(process.env['SHINOBI_DASHBOARD_PORT'] ?? 8765);
  const host = options.host ?? process.env['SHINOBI_DASHBOARD_HOST'] ?? '127.0.0.1';

  // Auth resolution order:
  //   1. Explicit options.auth wins (used by tests + programmatic embedders).
  //   2. SHINOBI_DASHBOARD_AUTH=off → force off (use ONLY when fronted by
  //      another auth layer, e.g. Cloudflare Access).
  //   3. SHINOBI_DASHBOARD_AUTH=on OR SHINOBI_DASHBOARD_TOKEN set → force on
  //      (needed when fronted by a tunnel that still hits loopback).
  //   4. Loopback bind → off; non-loopback → on.
  let auth: AuthMiddlewareOptions;
  const authEnv = (process.env['SHINOBI_DASHBOARD_AUTH'] ?? '').toLowerCase();
  const hasTokenEnv = (process.env['SHINOBI_DASHBOARD_TOKEN'] ?? '').length > 0;
  if (options.auth) {
    auth = options.auth;
  } else if (authEnv === 'off' || authEnv === 'false' || authEnv === '0') {
    auth = { enabled: false, token: null, tokenPath: dashboardTokenPath() };
  } else if (authEnv === 'on' || authEnv === 'true' || authEnv === '1' || hasTokenEnv) {
    const resolved = resolveDashboardToken();
    auth = { enabled: true, token: resolved.token, tokenPath: resolved.path };
  } else if (isLoopbackHost(host)) {
    auth = { enabled: false, token: null, tokenPath: dashboardTokenPath() };
  } else {
    const resolved = resolveDashboardToken();
    auth = { enabled: true, token: resolved.token, tokenPath: resolved.path };
  }

  const app = buildApp(auth);
  const server = serve({ fetch: app.fetch, port, hostname: host });
  stdout.write(`shinobi dashboard: listening on http://${host}:${port}\n`);
  if (auth.enabled && auth.token) {
    const reason = isLoopbackHost(host) ? 'forced via env' : 'non-loopback bind';
    stdout.write(`shinobi dashboard: auth ON (${reason})\n`);
    stdout.write(`  token file: ${auth.tokenPath ?? dashboardTokenPath()}\n`);
    stdout.write(`  open once:  http://${host}:${port}/?token=${auth.token}\n`);
  } else {
    stdout.write(`shinobi dashboard: auth OFF (loopback bind, safe for local dev)\n`);
  }
  stderr.write(`shinobi dashboard: ready\n`);

  // Best-effort: start the multi-agent relay client if configured. The client
  // is a no-op when SHINOBI_RELAY_URL / SHINOBI_RELAY_WORKSPACE are unset.
  try {
    getRelayClient().start();
  } catch (err) {
    stderr.write(`relay: start failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Best-effort: kick off the weekly digest scheduler (no-op when
  // SHINOBI_DIGEST_AUTO is unset/off).
  try {
    startDigestScheduler();
  } catch (err) {
    stderr.write(`digest scheduler: start failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  return server;
}

export { buildApp };
