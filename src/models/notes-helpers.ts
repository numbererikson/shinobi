import { parseJsonOrNull } from '../lib/json.js';
import type { Note, NoteRow } from './notes.js';

export function hydrate(row: NoteRow): Note {
  return {
    ...row,
    tags: parseJsonOrNull<string[]>(row.tags),
    files_touched: parseJsonOrNull<string[]>(row.files_touched),
  };
}
