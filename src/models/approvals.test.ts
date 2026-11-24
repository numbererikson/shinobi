import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { createApproval, getApproval, respondToApproval } from './approvals.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-approvals-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('respondToApproval', () => {
  it('accepts the first answer only', () => {
    const a = createApproval({ prompt: 'Deploy?' });
    expect(respondToApproval(a.id, { value: 'yes', responded_by: 'phone' })?.response_value).toBe('yes');
    expect(() => respondToApproval(a.id, { value: 'no', responded_by: 'laptop' })).toThrow(/already responded/);
    expect(getApproval(a.id)?.response_value).toBe('yes');
  });

  it('refuses an answer after expires_at (ISO or SQLite format) even before the sweeper ran', () => {
    const iso = createApproval({ prompt: 'Old?', expires_at: '2000-01-01T00:00:00Z' });
    expect(() => respondToApproval(iso.id, { value: 'yes' })).toThrow(/already expired/);
    const sql = createApproval({ prompt: 'Old too?', expires_at: '2000-01-01 00:00:00' });
    expect(() => respondToApproval(sql.id, { value: 'yes' })).toThrow(/already expired/);
    const future = createApproval({ prompt: 'Later?', expires_at: '2999-01-01T00:00:00Z' });
    expect(respondToApproval(future.id, { value: 'no' })?.status).toBe('responded');
  });
});
