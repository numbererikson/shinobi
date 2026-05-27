import { recordActivity } from '../../models/activity.js';
import { addNote, listNotes } from '../../models/notes.js';
import { updateRowEmbedding } from '../../services/embedding/store.js';
import {
  getNumber,
  getString,
  getStringArray,
  requireString,
} from './args.js';
import type { ShinobiTool } from './types.js';

export const noteTools: ShinobiTool[] = [
  {
    name: 'add_note',
    description: 'Add a free-form note. Used for things that do not fit decision/dead_end/task. Body is fulltext-searched by recall(), and embedded for semantic recall when SHINOBI_EMBED_PROVIDER is configured.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        body: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        files_touched: { type: 'array', items: { type: 'string' } },
        audio_path: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const note = addNote({
        project_id: getNumber(args, 'project_id') ?? null,
        body: requireString(args, 'body'),
        tags: getStringArray(args, 'tags'),
        files_touched: getStringArray(args, 'files_touched'),
        audio_path: getString(args, 'audio_path'),
        claude_session_id: getString(args, 'session_id'),
      });
      const embedded = await updateRowEmbedding('notes', note.id, note.body);
      recordActivity({
        project_id: note.project_id,
        session_id: note.claude_session_id,
        action_type: 'add_note',
        action_details: note.body.slice(0, 200),
        entity_type: 'note',
        entity_id: note.id,
      });
      return { ...note, embedded: embedded !== null, embedding_provider: embedded?.provider ?? null };
    },
  },
  {
    name: 'list_notes',
    description: 'List notes ordered newest-first, optionally scoped to a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'integer' },
        limit: { type: 'integer', default: 50 },
      },
      additionalProperties: false,
    },
    handler: (args) =>
      listNotes({
        projectId: getNumber(args, 'project_id'),
        limit: getNumber(args, 'limit') ?? 50,
      }),
  },
];
