import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb } from '../../lib/db.js';
import { createApi } from '../plugins/api.js';
import { createInProcessRegistry } from '../plugins/registry.js';
import { setModuleEnabled } from '../modules.js';
import { briefCron, composeBrief, DEFAULT_BRIEF_CRON, registerBriefSection, resetBriefSections, sectionLines } from './brief.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-brief-'));
  process.env.SHINOBI_CONFIG_DIR = tmp;
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  resetBriefSections();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.SHINOBI_CONFIG_DIR;
});

beforeEach(() => resetBriefSections());

describe('sectionLines', () => {
  it('accepts a string or an array, trims, drops junk and caps', () => {
    expect(sectionLines(' a \n\n b ')).toEqual(['a', 'b']);
    expect(sectionLines(['x', 3, null, 'y'])).toEqual(['x', 'y']);
    expect(sectionLines(null)).toEqual([]);
    expect(sectionLines({ text: 'no' })).toEqual([]);
    expect(sectionLines(Array.from({ length: 10 }, (_, i) => `l${i}`))).toHaveLength(6);
    expect(sectionLines('x'.repeat(500))[0]).toHaveLength(200);
  });
});

describe('composeBrief', () => {
  it('starts with the problems, then plugin sections in order, skipping switched-off modules and failed renders', async () => {
    const api = createApi();
    registerBriefSection('user/b', { id: 'later', order: 50, render: () => '🔔 Today: dentist 09:00' }, api);
    registerBriefSection('user/a', { id: 'first', order: 10, render: () => ['👨‍👧 Kids: quiet day'] }, api);
    registerBriefSection('user/c', { id: 'off', render: () => 'hidden' }, api);
    registerBriefSection('user/d', { id: 'broken', render: () => { throw new Error('boom'); } }, api);
    registerBriefSection('user/e', { id: 'empty', render: () => null }, api);
    setModuleEnabled('user/c', false);

    const brief = await composeBrief(new Date('2026-11-24T06:45:00Z'));
    const lines = brief.body.split('\n');
    // No push device in a fresh DB is always a problem (a freshly booted CI host may add one more).
    expect(lines[0]).toMatch(/^⚠️ \d+ problems?$/);
    expect(lines).toContain('• No device is subscribed to push notifications.');
    expect(lines.indexOf('👨‍👧 Kids: quiet day')).toBeLessThan(lines.indexOf('🔔 Today: dentist 09:00'));
    expect(brief.body).not.toContain('hidden');
    expect(brief.body).toContain('(D: not available)');
    expect(brief.title).toBe('Morning brief');
    expect(brief.ok).toBe(false);
    setModuleEnabled('user/c', true);
  });

  it('rejects bad section definitions', () => {
    const api = createApi();
    expect(() => registerBriefSection('p', { id: 'Bad Id', render: () => '' }, api)).toThrow(/must match/);
    registerBriefSection('p', { id: 'ok', render: () => '' }, api);
    expect(() => registerBriefSection('p', { id: 'ok', render: () => '' }, api)).toThrow(/duplicate/);
  });

  it('the in-process registry collects brief sections for plugin tests', async () => {
    const { registry, briefs } = createInProcessRegistry('rem');
    registry.brief({ id: 'today', render: () => 'x' });
    expect([...briefs.keys()]).toEqual(['today']);
    expect(() => registry.brief({ id: 'today', render: () => 'y' })).toThrow(/duplicate/);
  });
});

describe('briefCron', () => {
  it('defaults to 07:45, can be switched off and ignores garbage', () => {
    expect(briefCron(undefined)?.expression).toBe(DEFAULT_BRIEF_CRON);
    expect(briefCron('off')).toBeNull();
    expect(briefCron('nope')).toBeNull();
  });
});
