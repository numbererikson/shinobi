import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb, getDb } from '../../lib/db.js';
import { setModuleEnabled } from '../modules.js';
import { createApi } from './api.js';
import { createInProcessRegistry } from './registry.js';
import {
  listPluginSchedules,
  registerPluginSchedule,
  resetPluginSchedules,
  runDueSchedules,
  slotOf,
} from './schedules.js';
import { findPlugin, recordPlugin, resetPluginState } from './state.js';

let tmp: string;
const api = createApi();

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-schedules-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  resetPluginSchedules();
  resetPluginState();
  getDb().exec('DELETE FROM plugin_schedule_runs; DELETE FROM modules;');
});

function plugin(name: string): void {
  recordPlugin({ name, source: 'user', module_path: `file:///${name}.mjs`, tools_registered: [], pages_registered: [], schedules_registered: [], error: null });
}

const at = (iso: string): Date => new Date(iso);

describe('registerPluginSchedule', () => {
  it('records the schedule on the plugin and lists it', () => {
    plugin('user/rem');
    registerPluginSchedule('user/rem', { id: 'tick', cron: '* * * * *', timezone: 'Europe/Zagreb', run: () => undefined }, api);
    expect(findPlugin('user/rem')?.schedules_registered).toEqual(['tick']);
    expect(listPluginSchedules()).toEqual([{ plugin: 'user/rem', id: 'tick', cron: '* * * * *', timezone: 'Europe/Zagreb' }]);
  });

  it('rejects bad ids, crons, zones and duplicates', () => {
    plugin('user/rem');
    const run = (): void => undefined;
    expect(() => registerPluginSchedule('user/rem', { id: 'Bad Id', cron: '* * * * *', run }, api)).toThrow(/schedule id/);
    expect(() => registerPluginSchedule('user/rem', { id: 'x', cron: '* * *', run }, api)).toThrow(/5 fields/);
    expect(() => registerPluginSchedule('user/rem', { id: 'x', cron: '* * * * *', timezone: 'Nope/Nope', run }, api)).toThrow(/time zone/);
    registerPluginSchedule('user/rem', { id: 'x', cron: '* * * * *', run }, api);
    expect(() => registerPluginSchedule('user/rem', { id: 'x', cron: '* * * * *', run }, api)).toThrow(/duplicate/);
  });
});

describe('runDueSchedules', () => {
  it('runs a due schedule once per slot', async () => {
    plugin('user/rem');
    let runs = 0;
    registerPluginSchedule('user/rem', { id: 'tick', cron: '* * * * *', run: () => { runs++; } }, api);
    const now = at('2026-11-21T08:00:10Z');
    expect(await runDueSchedules(now)).toEqual([{ plugin: 'user/rem', id: 'tick', status: 'ran', error: null }]);
    expect(await runDueSchedules(at('2026-11-21T08:00:40Z'))).toEqual([]);
    expect(runs).toBe(1);
    await runDueSchedules(at('2026-11-21T08:01:05Z'));
    expect(runs).toBe(2);
  });

  it('skips schedules that are not due', async () => {
    plugin('user/rem');
    let runs = 0;
    registerPluginSchedule('user/rem', { id: 'brief', cron: '0 8 * * *', timezone: 'Europe/Zagreb', run: () => { runs++; } }, api);
    await runDueSchedules(at('2026-11-21T08:00:00Z')); // 09:00 in Zagreb
    expect(runs).toBe(0);
    await runDueSchedules(at('2026-11-21T07:00:00Z')); // 08:00 in Zagreb
    expect(runs).toBe(1);
  });

  it('skips schedules of a switched-off module', async () => {
    plugin('user/rem');
    let runs = 0;
    registerPluginSchedule('user/rem', { id: 'tick', cron: '* * * * *', run: () => { runs++; } }, api);
    setModuleEnabled('user/rem', false);
    expect(await runDueSchedules(at('2026-11-21T08:00:00Z'))).toEqual([]);
    expect(runs).toBe(0);
  });

  it('isolates a failing schedule and records the error', async () => {
    plugin('user/rem');
    let okRuns = 0;
    registerPluginSchedule('user/rem', { id: 'boom', cron: '* * * * *', run: () => { throw new Error('kaput'); } }, api);
    registerPluginSchedule('user/rem', { id: 'ok', cron: '* * * * *', run: async () => { okRuns++; } }, api);
    const results = await runDueSchedules(at('2026-11-21T08:00:00Z'));
    expect(results).toContainEqual({ plugin: 'user/rem', id: 'boom', status: 'failed', error: 'kaput' });
    expect(okRuns).toBe(1);
    const row = getDb()
      .prepare('SELECT error, finished_at FROM plugin_schedule_runs WHERE schedule_id = ?')
      .get('boom') as { error: string; finished_at: string | null };
    expect(row.error).toBe('kaput');
    expect(row.finished_at).not.toBeNull();
  });
});

describe('slotOf', () => {
  it('is the UTC minute', () => {
    expect(slotOf(at('2026-11-21T08:05:59.999Z'))).toBe('2026-11-21T08:05');
  });
});

describe('in-process registry schedules', () => {
  it('validates and runs schedules on demand', async () => {
    const { registry, schedules, runSchedule } = createInProcessRegistry('rem');
    registry.schedule({ id: 'tick', cron: '* * * * *', run: () => 'done' });
    expect(schedules.has('tick')).toBe(true);
    expect(await runSchedule('tick')).toBe('done');
    expect(() => registry.schedule({ id: 'tick', cron: '* * * * *', run: () => 'x' })).toThrow(/duplicate/);
  });
});
