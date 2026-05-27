import { getDb } from '../lib/db.js';
import { escapeFtsQuery } from '../lib/fts.js';
import { parseJsonOrNull, stringifyOrNull } from '../lib/json.js';

export interface NoteRow {
  id: number;
  project_id: number | null;
  body: string;
  tags: string | null;
  files_touched: string | null;
  audio_path: string | null;
  claude_session_id: string | null;
  created_at: string;
  embedding: Buffer | null;
  embedding_provider: string | null;
  embedding_dims: number | null;
}

export interface Note extends Omit<NoteRow, 'tags' | 'files_touched'> {
  tags: string[] | null;
  files_touched: string[] | null;
}

function hydrate(row: NoteRow): Note {
  return {
    ...row,
    tags: parseJsonOrNull<string[]>(row.tags),
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
  };
}

export interface AddNoteInput {
  project_id?: number | null;
  body: string;
  tags?: string[] | null;
  files_touched?: string[] | null;
  audio_path?: string | null;
  claude_session_id?: string | null;
}

export function addNote(input: AddNoteInput): Note {
  const result = getDb()
    .prepare(
      `INSERT INTO notes
        (project_id, body, tags, files_touched, audio_path, claude_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.project_id ?? null,
      input.body,
      stringifyOrNull(input.tags),
      stringifyOrNull(input.files_touched),
      input.audio_path ?? null,
      input.claude_session_id ?? null,
    );
  const created = getNote(Number(result.lastInsertRowid));
  if (!created) throw new Error('addNote: lookup after insert returned null');
  return created;
}

export function getNote(id: number): Note | null {
  const row = getDb()
    .prepare<[number], NoteRow>('SELECT * FROM notes WHERE id = ?')
    .get(id);
  return row ? hydrate(row) : null;
}

export interface ListNotesOptions {
  projectId?: number;
  sessionId?: string;
  limit?: number;
}

export function listNotes(options: ListNotesOptions = {}): Note[] {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (options.projectId !== undefined) {
    filters.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options.sessionId) {
    filters.push('claude_session_id = ?');
    params.push(options.sessionId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(options.limit ?? 50);
  const rows = getDb()
    .prepare<unknown[], NoteRow>(
      `SELECT * FROM notes ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}

export function searchNotes(query: string, projectId?: number, limit = 20): Note[] {
  const ftsQ = escapeFtsQuery(query);
  if (!ftsQ) return [];
  const params: unknown[] = [ftsQ];
  let projectFilter = '';
  if (projectId !== undefined) {
    projectFilter = 'AND n.project_id = ?';
    params.push(projectId);
  }
  params.push(limit);
  const rows = getDb()
    .prepare<unknown[], NoteRow>(
      `SELECT n.* FROM notes n
       JOIN notes_fts f ON n.id = f.rowid
       WHERE notes_fts MATCH ? ${projectFilter}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...params);
  return rows.map(hydrate);
}
