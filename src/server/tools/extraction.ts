import { createHash } from 'node:crypto';
import { recordActivity } from '../../models/activity.js';
import { createDraft } from '../../models/decision_drafts.js';
import { getProject } from '../../models/projects.js';
import { extractDecisions } from '../../services/extraction/decision-extractor.js';
import { persistSummary, summarizeProject } from '../../services/extraction/session-summarizer.js';
import { getBoolean, getNumber, getString, requireNumber, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

export const extractionTools: ShinobiTool[] = [
  {
    name: 'extract_decisions',
    description:
      'Extract decision drafts from a conversation transcript via LLM (Groq Llama 3.3 by default, free tier). Drafts land in the decision_drafts table with status=pending — the user reviews them in the dashboard and approves to create real decisions via log_decision. Use at session boundaries when you want auto-capture of decisions you may have forgotten to log explicitly. Requires SHINOBI_LLM_PROVIDER + GROQ_API_KEY (or OPENAI_API_KEY).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        text: {
          type: 'string',
          description:
            'Conversation transcript or session log. Truncated to last ~24k chars if larger. Include enough context that decisions are identifiable.',
        },
        session_id: { type: 'string' },
        auto_persist: {
          type: 'boolean',
          default: true,
          description:
            'When true (default), drafts persist to decision_drafts table for human review. When false, drafts are returned to the caller but NOT persisted — useful when the caller wants to inspect before storing.',
        },
        max_drafts: {
          type: 'integer',
          default: 50,
          description: 'Cap on number of drafts persisted (safety net against extractor over-generation).',
        },
      },
      required: ['project_id', 'text'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const projectId = requireNumber(args, 'project_id');
      const text = requireString(args, 'text');
      const sessionId = getString(args, 'session_id') ?? null;
      const autoPersist = args['auto_persist'] !== false;
      const maxDrafts = getNumber(args, 'max_drafts') ?? 50;

      const result = await extractDecisions(text);

      const drafts = result.decisions.slice(0, maxDrafts);
      const sourceHash = createHash('sha256').update(text).digest('hex').slice(0, 32);

      let persisted: number[] = [];
      if (autoPersist && drafts.length > 0) {
        persisted = drafts.map((d) =>
          createDraft({
            project_id: projectId,
            session_id: sessionId,
            kind: d.kind,
            summary: d.summary,
            rationale: d.rationale,
            alternatives_considered: d.alternatives_considered,
            files_touched: d.files_touched,
            source: 'extraction',
            extractor_model: `${result.provider}:${result.model}`,
            source_text_hash: sourceHash,
          }).id,
        );
        recordActivity({
          project_id: projectId,
          session_id: sessionId,
          action_type: 'extract_decisions',
          action_details: `${drafts.length} draft(s) persisted via ${result.provider}:${result.model}`,
          entity_type: 'project',
          entity_id: projectId,
        });
      }

      return {
        provider: result.provider,
        model: result.model,
        truncated: result.truncated,
        raw_length: result.raw_length,
        drafts_extracted: result.decisions.length,
        drafts_persisted: persisted.length,
        persisted_draft_ids: persisted,
        drafts,
      };
    },
  },
  {
    name: 'compress_session_summary',
    description:
      "Compress a project's recent activity + decisions + dead ends into a terse 3-paragraph markdown summary via LLM (Groq Llama 3.3 by default, free tier). When persist=true (default), stores on projects.recent_summary_md so next agent_bootstrap surfaces it as signal instead of raw 270-row noise. Requires SHINOBI_LLM_PROVIDER + GROQ_API_KEY (or OPENAI_API_KEY).",
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        activity_limit: { type: 'integer', default: 50 },
        decisions_limit: { type: 'integer', default: 12 },
        dead_ends_limit: { type: 'integer', default: 8 },
        open_subtasks_limit: { type: 'integer', default: 8 },
        persist: {
          type: 'boolean',
          default: true,
          description: 'Persist to projects.recent_summary_md. Set false to inspect output without saving.',
        },
        session_id: { type: 'string' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const projectId = requireNumber(args, 'project_id');
      const project = getProject(projectId);
      if (!project) throw new Error(`project not found: ${projectId}`);

      const input: Parameters<typeof summarizeProject>[0] = { projectId };
      const a = getNumber(args, 'activity_limit');
      if (a !== undefined) input.activityLimit = a;
      const d = getNumber(args, 'decisions_limit');
      if (d !== undefined) input.decisionsLimit = d;
      const de = getNumber(args, 'dead_ends_limit');
      if (de !== undefined) input.deadEndsLimit = de;
      const os = getNumber(args, 'open_subtasks_limit');
      if (os !== undefined) input.openSubtasksLimit = os;

      const result = await summarizeProject(input);
      const persist = getBoolean(args, 'persist') !== false;
      const providerLabel = `${result.provider}:${result.model}`;
      if (persist) {
        persistSummary(projectId, result.summary, providerLabel);
        recordActivity({
          project_id: projectId,
          session_id: getString(args, 'session_id') ?? null,
          action_type: 'compress_session_summary',
          action_details: `${result.summary.length} chars, ${providerLabel}`,
          entity_type: 'project',
          entity_id: projectId,
        });
      }

      return {
        project_id: projectId,
        provider: result.provider,
        model: result.model,
        input_chars: result.input_chars,
        truncated: result.truncated,
        summary_chars: result.summary.length,
        summary: result.summary,
        persisted: persist,
      };
    },
  },
];
