import { hydrate as hydrateDecision } from '../../models/decisions-helpers.js';
import { hydrate as hydrateDeadEnd } from '../../models/dead_ends-helpers.js';
import { hydrate as hydrateNote } from '../../models/notes-helpers.js';
import { hydrate as hydrateSubtask } from '../../models/subtasks-helpers.js';
import { searchDecisions, type DecisionRow } from '../../models/decisions.js';
import { checkDeadEnds, type DeadEndRow } from '../../models/dead_ends.js';
import { searchNotes, type NoteRow } from '../../models/notes.js';
import { searchSubtasks, type SubtaskRow } from '../../models/subtasks.js';
import { resolveEmbeddingProvider } from '../../services/embedding/factory.js';
import { semanticSearch } from '../../services/embedding/store.js';
import { getNumber, requireString } from './args.js';
import type { ShinobiTool } from './types.js';

export const recallTools: ShinobiTool[] = [
  {
    name: 'recall',
    description:
      'Search across decisions, dead ends, notes, and subtask titles/descriptions for a query string. Uses semantic similarity when SHINOBI_EMBED_PROVIDER is configured; otherwise FTS5-backed fulltext. Use this when you have lost the thread on an old project.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project_id: { type: 'integer' },
        limit_per_kind: { type: 'integer', default: 5 },
        mode: { type: 'string', enum: ['auto', 'semantic', 'fulltext'], default: 'auto' },
        score_threshold: { type: 'number', description: 'Semantic mode only (default 0.45)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const query = requireString(args, 'query');
      const projectId = getNumber(args, 'project_id');
      const limit = getNumber(args, 'limit_per_kind') ?? 5;
      const threshold = getNumber(args, 'score_threshold') ?? 0.45;
      const requestedMode = (args['mode'] as string | undefined) ?? 'auto';

      const provider = await resolveEmbeddingProvider();
      const useSemantic =
        requestedMode === 'semantic' || (requestedMode === 'auto' && provider !== null);

      if (useSemantic && provider) {
        const semanticOpts = (): { projectId?: number; limit: number; provider: typeof provider } => {
          const base: { projectId?: number; limit: number; provider: typeof provider } = {
            limit,
            provider,
          };
          if (projectId !== undefined) base.projectId = projectId;
          return base;
        };

        const [decHits, deHits, noteHits, subHits] = await Promise.all([
          semanticSearch<DecisionRow>('decisions', query, semanticOpts()),
          semanticSearch<DeadEndRow>('dead_ends', query, semanticOpts()),
          semanticSearch<NoteRow>('notes', query, semanticOpts()),
          semanticSearch<SubtaskRow>('subtasks', query, semanticOpts()),
        ]);

        return {
          query,
          mode: 'semantic',
          provider: provider.name,
          score_threshold: threshold,
          decisions: decHits.filter((h) => h.score >= threshold).map((h) => ({ ...hydrateDecision(h.row), score: Number(h.score.toFixed(4)) })),
          dead_ends: deHits.filter((h) => h.score >= threshold).map((h) => ({ ...hydrateDeadEnd(h.row), score: Number(h.score.toFixed(4)) })),
          notes: noteHits.filter((h) => h.score >= threshold).map((h) => ({ ...hydrateNote(h.row), score: Number(h.score.toFixed(4)) })),
          subtasks: subHits.filter((h) => h.score >= threshold).map((h) => ({ ...hydrateSubtask(h.row), score: Number(h.score.toFixed(4)) })),
        };
      }

      return {
        query,
        mode: 'fulltext',
        decisions: searchDecisions(query, projectId, limit),
        dead_ends: checkDeadEnds({ approach: query, ...(projectId !== undefined ? { projectId } : {}), limit }),
        notes: searchNotes(query, projectId, limit),
        subtasks: searchSubtasks(query, projectId, limit),
      };
    },
  },
];
