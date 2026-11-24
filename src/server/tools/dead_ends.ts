import { recordActivity } from '../../models/activity.js';
import {
  checkDeadEnds,
  logDeadEnd,
  setDeadEndObsolete,
  type DeadEnd,
  type DeadEndRow,
} from '../../models/dead_ends.js';
import { resolveEmbeddingProvider } from '../../services/embedding/factory.js';
import { semanticSearch, updateRowEmbedding } from '../../services/embedding/store.js';
import { parseJsonOrNull } from '../../lib/json.js';
import {
  getBoolean,
  getNumber,
  getString,
  getStringArray,
  requireNumber,
  requireString,
} from './args.js';
import type { ShinobiTool } from './types.js';

function hydrate(row: DeadEndRow): DeadEnd {
  return {
    ...row,
    files_involved: parseJsonOrNull<string[]>(row.files_involved),
    never_retry: row.never_retry === 1,
  };
}

export const deadEndTools: ShinobiTool[] = [
  {
    name: 'log_dead_end',
    description: 'Log an approach that demonstrably failed so future sessions do not re-try. Embeds approach+failure_reason for semantic match when SHINOBI_EMBED_PROVIDER is configured.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        attempted_approach: { type: 'string' },
        failure_reason: { type: 'string' },
        files_involved: { type: 'array', items: { type: 'string' } },
        never_retry: { type: 'boolean', default: false },
        session_id: { type: 'string' },
      },
      required: ['project_id', 'attempted_approach', 'failure_reason'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const dead = logDeadEnd({
        project_id: requireNumber(args, 'project_id'),
        attempted_approach: requireString(args, 'attempted_approach'),
        failure_reason: requireString(args, 'failure_reason'),
        files_involved: getStringArray(args, 'files_involved'),
        never_retry: getBoolean(args, 'never_retry') ?? false,
        claude_session_id: getString(args, 'session_id'),
      });
      const embedText = `${dead.attempted_approach}\n${dead.failure_reason}`;
      const embedded = await updateRowEmbedding('dead_ends', dead.id, embedText);
      recordActivity({
        project_id: dead.project_id,
        session_id: dead.claude_session_id,
        action_type: 'log_dead_end',
        action_details: dead.attempted_approach.slice(0, 200),
        entity_type: 'dead_end',
        entity_id: dead.id,
      });
      return { ...dead, embedded: embedded !== null, embedding_provider: embedded?.provider ?? null };
    },
  },
  {
    name: 'check_dead_ends',
    description: 'Preventive search BEFORE implementing an approach. Pass a description and optional file paths. Uses semantic similarity when SHINOBI_EMBED_PROVIDER is configured; otherwise FTS5 + filename overlap. Returns matching past failures.',
    inputSchema: {
      type: 'object',
      properties: {
        approach: { type: 'string', description: 'Plain English description of the planned approach' },
        files: { type: 'array', items: { type: 'string' } },
        project_id: { type: 'integer' },
        limit: { type: 'integer', default: 10 },
        score_threshold: { type: 'number', description: 'Semantic mode only: minimum cosine score (default 0.55)' },
        include_obsolete: { type: 'boolean', description: 'Also return dead ends marked obsolete (default false).' },
      },
      required: ['approach'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const approach = requireString(args, 'approach');
      const files = getStringArray(args, 'files');
      const projectId = getNumber(args, 'project_id');
      const limit = getNumber(args, 'limit') ?? 10;
      const threshold = getNumber(args, 'score_threshold') ?? 0.55;
      const includeObsolete = getBoolean(args, 'include_obsolete') === true;

      const provider = await resolveEmbeddingProvider();
      if (provider) {
        const semanticOpts: { projectId?: number; limit: number } = { limit };
        if (projectId !== undefined) semanticOpts.projectId = projectId;
        const semantic = await semanticSearch<DeadEndRow>('dead_ends', approach, semanticOpts);
        const matches = semantic
          .filter((hit) => hit.score >= threshold && (includeObsolete || hit.row.obsolete_at === null))
          .map((hit) => ({ ...hydrate(hit.row), score: Number(hit.score.toFixed(4)) }));
        if (matches.length > 0) {
          return {
            matches,
            count: matches.length,
            mode: 'semantic',
            provider: provider.name,
            verdict: 'matches_found',
          };
        }
      }

      const fallbackOpts: { approach: string; files?: string[]; projectId?: number; limit: number; includeObsolete: boolean } = {
        approach,
        limit,
        includeObsolete,
      };
      if (files) fallbackOpts.files = files;
      if (projectId !== undefined) fallbackOpts.projectId = projectId;
      const matches = checkDeadEnds(fallbackOpts);
      return {
        matches,
        count: matches.length,
        mode: provider ? 'semantic_fallback_fulltext' : 'fulltext',
        verdict: matches.length === 0 ? 'no_known_dead_ends' : 'matches_found',
      };
    },
  },
  {
    name: 'update_dead_end',
    description:
      'Mark a dead end as obsolete when it no longer applies (e.g. the dependency was upgraded or the bug fixed upstream), with the reason; ' +
      'or make it active again. Obsolete dead ends keep their history but drop out of check_dead_ends and the Claude Code hooks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        obsolete: { type: 'boolean', description: 'true = no longer applies; false = applies again' },
        reason: { type: 'string', description: 'Why it no longer applies (required when obsolete is true)' },
      },
      required: ['id', 'obsolete'],
      additionalProperties: false,
    },
    handler: (args) => {
      const id = requireNumber(args, 'id');
      const obsolete = getBoolean(args, 'obsolete') === true;
      const reason = getString(args, 'reason');
      if (obsolete && !reason?.trim()) throw new Error('reason is required when marking a dead end obsolete');
      const updated = setDeadEndObsolete(id, obsolete, reason?.trim() ?? null);
      if (!updated) throw new Error(`dead end ${id} not found`);
      recordActivity({
        project_id: updated.project_id,
        session_id: null,
        action_type: obsolete ? 'dead_end_obsolete' : 'dead_end_reactivated',
        action_details: obsolete ? `#${id}: ${reason}`.slice(0, 200) : `#${id}`,
        entity_type: 'dead_end',
        entity_id: id,
      });
      return updated;
    },
  },
];
