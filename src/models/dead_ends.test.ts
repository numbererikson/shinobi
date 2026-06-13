import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createProject } from './projects.js';
import { checkDeadEnds, getDeadEnd, listDeadEnds, logDeadEnd } from './dead_ends.js';

let tmp: string;
let projectId: number;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-deadends-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
  projectId = createProject({ title: 'Dead ends test' }).id;
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('logDeadEnd', () => {
  it('roundtrips never_retry as boolean and files as array', () => {
    const d = logDeadEnd({
      project_id: projectId,
      attempted_approach: 'mock sqlite in memory',
      failure_reason: 'fts semantics diverged',
      files_involved: ['src/lib/db.ts'],
      never_retry: true,
    });
    const got = getDeadEnd(d.id);
    expect(got?.never_retry).toBe(true);
    expect(got?.files_involved).toEqual(['src/lib/db.ts']);
  });
});

describe('checkDeadEnds', () => {
  it('matches a prior failure by approach (FTS)', () => {
    logDeadEnd({
      project_id: projectId,
      attempted_approach: 'use websocketrelay for the realtime channel',
      failure_reason: 'does not survive container restart',
    });
    const hits = checkDeadEnds({ approach: 'websocketrelay', projectId });
    expect(hits.some((h) => h.attempted_approach.includes('websocketrelay'))).toBe(true);
  });

  it('matches by file overlap even when the approach text does not', () => {
    const d = logDeadEnd({
      project_id: projectId,
      attempted_approach: 'unrelated wording aaa',
      failure_reason: 'nope',
      files_involved: ['src/server/http.ts'],
    });
    const hits = checkDeadEnds({
      approach: 'zzznomatchzzz',
      files: ['src/server/http.ts'],
      projectId,
    });
    expect(hits.map((h) => h.id)).toContain(d.id);
  });

  it('scopes matches to the given project', () => {
    const other = createProject({ title: 'other' }).id;
    logDeadEnd({ project_id: other, attempted_approach: 'uniquemarker approach', failure_reason: 'x' });
    const hits = checkDeadEnds({ approach: 'uniquemarker', projectId });
    expect(hits.every((h) => h.project_id === projectId)).toBe(true);
  });
});

describe('listDeadEnds', () => {
  it('returns only the requested project, newest first', () => {
    const list = listDeadEnds({ projectId });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((d) => d.project_id === projectId)).toBe(true);
  });
});
