import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createProject } from './projects.js';
import { addNote, deleteNote, getNote, listNotes, searchNotes } from './notes.js';

let tmp: string;
let projectId: number;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-notes-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
  projectId = createProject({ title: 'Notes test' }).id;
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('deleteNote', () => {
  it('removes the note and its full-text entry, and reports missing ids', () => {
    const keep = addNote({ project_id: projectId, body: 'keep this zebra note' });
    const gone = addNote({ project_id: projectId, body: 'delete this zebra note' });
    expect(searchNotes('zebra', projectId).map((n) => n.id).sort()).toEqual([keep.id, gone.id].sort());

    expect(deleteNote(gone.id)).toBe(true);
    expect(getNote(gone.id)).toBeNull();
    expect(listNotes({ projectId }).map((n) => n.id)).toEqual([keep.id]);
    expect(searchNotes('zebra', projectId).map((n) => n.id)).toEqual([keep.id]);

    expect(deleteNote(gone.id)).toBe(false);
  });
});
