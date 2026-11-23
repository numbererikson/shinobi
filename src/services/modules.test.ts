import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { recordPlugin, resetPluginState } from './plugins/state.js';
import { registerPluginPage, listPluginPages, renderPluginPage, resetPluginPages } from './plugins/pages.js';
import { appendTool, resetTools } from '../server/tools/registry.js';
import { buildApp } from '../dashboard/server.js';
import { visibleTools } from '../server/mcp.js';
import {
  DEVELOPMENT,
  isModuleEnabled,
  isToolEnabled,
  listModules,
  moduleDisplayName,
  moduleOfTool,
  setModuleEnabled,
} from './modules.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-modules-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
  resetTools();
  resetPluginState();
  resetPluginPages();
  appendTool({ name: 'list_projects', description: '', inputSchema: {}, handler: () => [] });
  appendTool({ name: 'plugin_music_play', description: '', inputSchema: {}, handler: () => 'ok' });
  appendTool({ name: 'system_status', description: '', inputSchema: {}, handler: () => ({}) });
  recordPlugin({ name: 'user/shinobi-plugin-music', source: 'user', module_path: 'file:///m.mjs', tools_registered: ['plugin_music_play'], pages_registered: [], schedules_registered: [], error: null });
  registerPluginPage('user/shinobi-plugin-music', { id: 'music', title: 'Music', render: () => [] });
});

afterAll(() => {
  resetTools();
  resetPluginState();
  resetPluginPages();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('modules', () => {
  it('names plugins nicely and maps tools to their module', () => {
    expect(moduleDisplayName('user/shinobi-plugin-music')).toBe('Music');
    expect(moduleDisplayName('@shinobi/plugin-fitness')).toBe('Fitness');
    expect(moduleDisplayName('user/shinobi-plugin-smart-home')).toBe('Smart Home');
    expect(moduleOfTool('plugin_music_play')).toBe('user/shinobi-plugin-music');
    expect(moduleOfTool('list_projects')).toBe(DEVELOPMENT);
  });

  it('everything is on by default; switching a module off hides its tools and pages', async () => {
    expect(isToolEnabled('plugin_music_play')).toBe(true);
    expect(listPluginPages().map((p) => p.id)).toEqual(['music']);

    setModuleEnabled('user/shinobi-plugin-music', false);
    expect(isModuleEnabled('user/shinobi-plugin-music')).toBe(false);
    expect(isToolEnabled('plugin_music_play')).toBe(false);
    expect(isToolEnabled('list_projects')).toBe(true);
    expect(listPluginPages()).toEqual([]);
    expect(await renderPluginPage('music')).toBeNull();

    setModuleEnabled(DEVELOPMENT, false);
    expect(isToolEnabled('list_projects')).toBe(false);

    setModuleEnabled('user/shinobi-plugin-music', true);
    setModuleEnabled(DEVELOPMENT, true);
    expect(listModules(1).map((m) => [m.id, m.name, m.enabled, m.tools])).toEqual([
      [DEVELOPMENT, 'Development', true, 1],
      ['user/shinobi-plugin-music', 'Music', true, 1],
    ]);
  });

  it('dashboard API lists and toggles modules, refusing unknown ids', async () => {
    const app = buildApp({ enabled: false, token: null });
    const list = (await (await app.fetch(new Request('http://localhost/api/modules'))).json()) as { modules: { id: string; enabled: boolean }[] };
    expect(list.modules.map((m) => m.id)).toEqual([DEVELOPMENT, 'user/shinobi-plugin-music']);

    const post = (body: unknown) =>
      app.fetch(new Request('http://localhost/api/modules/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    expect((await post({ id: 'nope', enabled: false })).status).toBe(404);
    expect((await post({ id: DEVELOPMENT })).status).toBe(400);
    const off = (await (await post({ id: 'user/shinobi-plugin-music', enabled: false })).json()) as { modules: { id: string; enabled: boolean }[] };
    expect(off.modules.find((m) => m.id === 'user/shinobi-plugin-music')?.enabled).toBe(false);
    setModuleEnabled('user/shinobi-plugin-music', true);
  });

  it('/mcp/home leaves out Development; /mcp offers everything enabled', () => {
    expect(visibleTools().map((t) => t.name).sort()).toEqual(['list_projects', 'plugin_music_play', 'system_status']);
    expect(visibleTools({ excludeModules: [DEVELOPMENT] }).map((t) => t.name).sort()).toEqual(['plugin_music_play', 'system_status']);
    setModuleEnabled('user/shinobi-plugin-music', false);
    expect(visibleTools({ excludeModules: [DEVELOPMENT] }).map((t) => t.name)).toEqual(['system_status']);
    // System tools stay even when Development is off.
    setModuleEnabled(DEVELOPMENT, false);
    expect(visibleTools().map((t) => t.name)).toEqual(['system_status']);
    setModuleEnabled(DEVELOPMENT, true);
    setModuleEnabled('user/shinobi-plugin-music', true);
  });
});
