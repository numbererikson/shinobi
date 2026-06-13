import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createProject } from './projects.js';
import {
  decisionsForFile,
  getDecision,
  listDecisions,
  logDecision,
  searchDecisions,
  updateDecisionStatus,
} from './decisions.js';

let tmp: string;
let projectId: number;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-decisions-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
  projectId = createProject({ title: 'Decisions test' }).id;
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('logDecision', () => {
  it('roundtrips and defaults kind to other', () => {
    const d = logDecision({ project_id: projectId, summary: 's', rationale: 'r' });
    expect(d.kind).toBe('other');
    expect(getDecision(d.id)?.summary).toBe('s');
  });

  it('normalizes files_touched to repo-relative on write', () => {
    const d = logDecision({
      project_id: projectId,
      summary: 'win',
      rationale: 'r',
      files_touched: ['c:\\laragon\\www\\app\\src\\x.ts'],
    });
    expect(d.files_touched).toEqual(['src/x.ts']);
  });
});

describe('decisionsForFile', () => {
  it('matches the same file across device path forms', () => {
    const d = logDecision({
      project_id: projectId,
      summary: 'cross',
      rationale: 'r',
      files_touched: ['/home/user/app/src/router.ts'],
    });
    expect(decisionsForFile('src/router.ts').map((x) => x.id)).toContain(d.id);
  });
});

describe('listDecisions', () => {
  it('filters by status', () => {
    const d = logDecision({ project_id: projectId, summary: 'to fix', rationale: 'r' });
    updateDecisionStatus(d.id, 'fixed');
    const fixed = listDecisions({ projectId, status: 'fixed' });
    expect(fixed.every((x) => x.status === 'fixed')).toBe(true);
    expect(fixed.map((x) => x.id)).toContain(d.id);
  });
});

describe('updateDecisionStatus', () => {
  it('stamps decided_at for terminal states only', () => {
    const a = logDecision({ project_id: projectId, summary: 'a', rationale: 'r' });
    expect(updateDecisionStatus(a.id, 'fixed')?.decided_at).not.toBeNull();
    const b = logDecision({ project_id: projectId, summary: 'b', rationale: 'r' });
    expect(updateDecisionStatus(b.id, 'fix_later')?.decided_at).toBeNull();
  });
});

describe('searchDecisions', () => {
  it('matches via FTS', () => {
    logDecision({ project_id: projectId, summary: 'adopt betterdriver storage', rationale: 'sync api' });
    expect(searchDecisions('betterdriver', projectId).length).toBeGreaterThan(0);
  });
});
