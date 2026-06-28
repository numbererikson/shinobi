import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb, getDb } from '../lib/db.js';
import {
  deletePluginState,
  getPluginState,
  setPluginState,
  updatePluginState,
} from './plugin_state.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-plugin-state-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('plugin_state', () => {
  it('returns null for a missing key', () => {
    expect(getPluginState('p1', 'missing')).toBeNull();
  });

  it('roundtrips JSON values and upserts on the same key', () => {
    setPluginState('p1', 'k', { a: 1, b: ['x'] });
    expect(getPluginState<{ a: number; b: string[] }>('p1', 'k')).toEqual({ a: 1, b: ['x'] });
    setPluginState('p1', 'k', { a: 2, b: [] });
    expect(getPluginState<{ a: number }>('p1', 'k')?.a).toBe(2);
  });

  it('scopes keys per plugin name', () => {
    setPluginState('p1', 'shared', 'one');
    setPluginState('p2', 'shared', 'two');
    expect(getPluginState('p1', 'shared')).toBe('one');
    expect(getPluginState('p2', 'shared')).toBe('two');
  });

  it('deletes a key', () => {
    setPluginState('p1', 'gone', true);
    deletePluginState('p1', 'gone');
    expect(getPluginState('p1', 'gone')).toBeNull();
  });

  it('treats a corrupt value as absent rather than throwing', () => {
    getDb()
      .prepare(
        `INSERT INTO plugin_state (plugin, key, value, updated_at)
           VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(plugin, key) DO UPDATE SET value = excluded.value`,
      )
      .run('p1', 'corrupt', '{not json');
    expect(getPluginState('p1', 'corrupt')).toBeNull();
  });

  it('update() seeds from null and returns the persisted value', () => {
    const next = updatePluginState<{ count: number }>('p1', 'counter', (cur) => ({
      count: (cur?.count ?? 0) + 1,
    }));
    expect(next.count).toBe(1);
    expect(getPluginState<{ count: number }>('p1', 'counter')?.count).toBe(1);
  });

  it('update() applies sequential read-modify-writes atomically', () => {
    setPluginState('p1', 'counter', { count: 0 });
    for (let i = 0; i < 50; i++) {
      updatePluginState<{ count: number }>('p1', 'counter', (cur) => ({
        count: (cur?.count ?? 0) + 1,
      }));
    }
    expect(getPluginState<{ count: number }>('p1', 'counter')?.count).toBe(50);
  });
});
