import { recordActivity } from '../../models/activity.js';
import {
  decisionsForFile,
  listDecisions,
  logDecision,
  updateDecisionStatus,
  type DecisionKind,
  type DecisionStatus,
} from '../../models/decisions.js';
import { updateRowEmbedding } from '../../services/embedding/store.js';
import {
  getNumber,
  getString,
  getStringArray,
  requireNumber,
  requireString,
} from './args.js';
import type { ShinobiTool } from './types.js';

const KIND_ENUM = ['architecture', 'library', 'pattern', 'tradeoff', 'workaround', 'other'] as const;
const STATUS_ENUM = ['open', 'fix_now', 'fix_later', 'wontfix', 'fixed', 'false_positive'] as const;

export const decisionTools: ShinobiTool[] = [
  {
    name: 'log_decision',
    description: 'Record a decision in the durable decision log. Architectural choices, library picks, tradeoffs, workarounds. Embeds summary+rationale for semantic recall when SHINOBI_EMBED_PROVIDER is configured.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        subtask_id: { type: 'integer' },
        summary: { type: 'string', description: 'Short one-liner' },
        rationale: { type: 'string', description: 'Full reasoning' },
        alternatives_considered: { type: 'string' },
        files_touched: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: [...KIND_ENUM], default: 'other' },
        session_id: { type: 'string' },
      },
      required: ['project_id', 'summary', 'rationale'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const decision = logDecision({
        project_id: requireNumber(args, 'project_id'),
        subtask_id: getNumber(args, 'subtask_id') ?? null,
        summary: requireString(args, 'summary'),
        rationale: requireString(args, 'rationale'),
        alternatives_considered: getString(args, 'alternatives_considered'),
        files_touched: getStringArray(args, 'files_touched'),
        tags: getStringArray(args, 'tags'),
        kind: getString(args, 'kind') as DecisionKind | undefined,
        claude_session_id: getString(args, 'session_id'),
      });
      const embedText = [decision.summary, decision.rationale, decision.alternatives_considered]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join('\n');
      const embedded = await updateRowEmbedding('decisions', decision.id, embedText);
      recordActivity({
        project_id: decision.project_id,
        session_id: decision.claude_session_id,
        action_type: 'log_decision',
        action_details: decision.summary,
        entity_type: 'decision',
        entity_id: decision.id,
      });
      return { ...decision, embedded: embedded !== null, embedding_provider: embedded?.provider ?? null };
    },
  },
  {
    name: 'decisions_for_file',
    description: 'Return every decision whose files_touched contains the given path. Useful when opening a file you have not touched in months.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        limit: { type: 'integer', default: 50 },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
    handler: (args) => decisionsForFile(requireString(args, 'file_path'), getNumber(args, 'limit') ?? 50),
  },
  {
    name: 'update_decision_status',
    description: 'Move a decision through its lifecycle (open / fix_now / fix_later / wontfix / fixed / false_positive). Stamps decided_at automatically on closing states.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: { type: 'integer' },
        status: { type: 'string', enum: [...STATUS_ENUM] },
        fixed_in_commit_sha: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['decision_id', 'status'],
      additionalProperties: false,
    },
    handler: (args) => {
      const decisionId = requireNumber(args, 'decision_id');
      const status = requireString(args, 'status') as DecisionStatus;
      const updated = updateDecisionStatus(decisionId, status, getString(args, 'fixed_in_commit_sha'));
      if (updated) {
        recordActivity({
          project_id: updated.project_id,
          session_id: getString(args, 'session_id'),
          action_type: 'decision_status_changed',
          action_details: `${status}`,
          entity_type: 'decision',
          entity_id: updated.id,
        });
      }
      return updated;
    },
  },
];

void listDecisions;
