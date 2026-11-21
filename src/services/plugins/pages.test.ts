import { afterEach, describe, expect, it } from 'vitest';

import { appendTool, resetTools } from '../../server/tools/registry.js';
import { recordPlugin, resetPluginState } from './state.js';
import {
  listPluginPages,
  registerPluginPage,
  renderPluginPage,
  resetPluginPages,
  runPluginPageAction,
  sanitizeBlocks,
} from './pages.js';

function plugin(name: string, tools: Record<string, (args: Record<string, unknown>) => unknown> = {}): void {
  // Mirrors buildPluginRegistry: the plugin is recorded with the tools it owns.
  recordPlugin({ name, source: 'user', module_path: `file:///${name}.mjs`, tools_registered: Object.keys(tools), pages_registered: [], error: null });
  for (const [tool, handler] of Object.entries(tools)) {
    appendTool({ name: tool, description: tool, inputSchema: { type: 'object' }, handler });
  }
}

afterEach(() => {
  resetPluginPages();
  resetPluginState();
  resetTools();
});

describe('registerPluginPage', () => {
  it('lists pages sorted by order then title, with a safe icon', () => {
    plugin('user/a');
    registerPluginPage('user/a', { id: 'zeta', title: 'Zeta', icon: 'music', render: () => [] });
    registerPluginPage('user/a', { id: 'alpha', title: 'Alpha', icon: 'not-an-icon', render: () => [] });
    registerPluginPage('user/a', { id: 'first', title: 'Zz first', order: 1, render: () => [] });
    expect(listPluginPages()).toEqual([
      { id: 'first', title: 'Zz first', icon: 'package', plugin: 'user/a' },
      { id: 'alpha', title: 'Alpha', icon: 'package', plugin: 'user/a' },
      { id: 'zeta', title: 'Zeta', icon: 'music', plugin: 'user/a' },
    ]);
  });

  it('rejects bad ids, missing render, and ids taken by another plugin', () => {
    plugin('user/a');
    plugin('user/b');
    expect(() => registerPluginPage('user/a', { id: 'Bad Id', title: 'x', render: () => [] })).toThrow(/must match/);
    expect(() => registerPluginPage('user/a', { id: 'ok', title: ' ', render: () => [] })).toThrow(/needs a title/);
    expect(() => registerPluginPage('user/a', { id: 'ok', title: 'Ok' } as never)).toThrow(/render function/);
    registerPluginPage('user/a', { id: 'music', title: 'Music', render: () => [] });
    expect(() => registerPluginPage('user/b', { id: 'music', title: 'Music', render: () => [] })).toThrow(/already used by plugin 'user\/a'/);
  });
});

describe('sanitizeBlocks', () => {
  it('keeps known blocks, drops unknown ones and coerces values to capped text', () => {
    plugin('user/m', { plugin_m_next: () => 'ok' });
    const blocks = sanitizeBlocks(
      [
        { type: 'heading', text: 'Now playing' },
        { type: 'script', src: 'evil.js' },
        { type: 'text', text: '<b>x</b>', tone: 'sparkly' },
        { type: 'stats', items: [{ label: 'Volume', value: 80, tone: 'ok' }, 'junk'] },
        { type: 'table', columns: ['Name', 'IP'], rows: [['TV', '192.168.1.10', 'extra'], 'bad', [null]] },
        { type: 'progress', label: 'Day', value: 250, max: 180 },
        { type: 'list', items: [{ title: 'a'.repeat(5000), badge: 'NEW' }] },
        { type: 'divider' },
        null,
      ],
      'user/m',
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'text', 'stats', 'table', 'progress', 'list', 'divider']);
    expect(blocks[1]).toEqual({ type: 'text', text: '<b>x</b>' });
    expect(blocks[2]).toEqual({ type: 'stats', items: [{ label: 'Volume', value: '80', tone: 'ok' }] });
    expect(blocks[3]).toEqual({ type: 'table', columns: ['Name', 'IP'], rows: [['TV', '192.168.1.10'], ['', '']] });
    expect(blocks[4]).toEqual({ type: 'progress', label: 'Day', value: 180, max: 180 });
    const list = blocks[5] as { items: { title: string }[] };
    expect(list.items[0]!.title.length).toBeLessThanOrEqual(200);
  });

  it('only keeps buttons that target the page plugin\'s own tools', () => {
    plugin('user/m', { plugin_m_next: () => 'ok' });
    plugin('user/x', { plugin_x_wipe: () => 'gone' });
    const [actions] = sanitizeBlocks(
      [
        {
          type: 'actions',
          buttons: [
            { label: 'Next', tool: 'plugin_m_next', args: { a: 1 }, variant: 'primary', confirm: 'Sure?' },
            { label: 'Steal', tool: 'plugin_x_wipe' },
            { label: 'Core', tool: 'delete_project' },
          ],
        },
      ],
      'user/m',
    );
    expect(actions).toEqual({
      type: 'actions',
      buttons: [{ label: 'Next', tool: 'plugin_m_next', args: { a: 1 }, variant: 'primary', confirm: 'Sure?' }],
    });
  });
});

describe('renderPluginPage / runPluginPageAction', () => {
  it('renders blocks plus refresh rate, and reports render errors instead of throwing', async () => {
    plugin('user/m');
    registerPluginPage('user/m', { id: 'music', title: 'Music', render: async () => ({ blocks: [{ type: 'text', text: 'hi' }], refreshSeconds: 1 }) });
    registerPluginPage('user/m', {
      id: 'broken',
      title: 'Broken',
      render: () => {
        throw new Error('mpd down');
      },
    });
    const ok = await renderPluginPage('music');
    expect(ok).toMatchObject({ id: 'music', blocks: [{ type: 'text', text: 'hi' }], refreshSeconds: 2, error: null });
    const bad = await renderPluginPage('broken');
    expect(bad).toMatchObject({ id: 'broken', blocks: [], error: 'mpd down' });
    expect(await renderPluginPage('nope')).toBeNull();
  });

  it('runs an owned tool, then returns the re-rendered page', async () => {
    let volume = 50;
    plugin('user/m', { plugin_m_louder: () => (volume += 10) });
    registerPluginPage('user/m', { id: 'music', title: 'Music', render: () => [{ type: 'stats', items: [{ label: 'Volume', value: volume }] }] });
    const r = await runPluginPageAction('music', 'plugin_m_louder', {});
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.result).toBe(60);
    expect(r.page.blocks[0]).toEqual({ type: 'stats', items: [{ label: 'Volume', value: '60' }] });
  });

  it('refuses tools of other plugins and core tools, and reports tool failures with the page', async () => {
    plugin('user/m', {
      plugin_m_fail: () => {
        throw new Error('no speaker');
      },
    });
    plugin('user/x', { plugin_x_wipe: () => 'gone' });
    registerPluginPage('user/m', { id: 'music', title: 'Music', render: () => [] });
    expect(await runPluginPageAction('music', 'plugin_x_wipe', {})).toMatchObject({ status: 'forbidden' });
    expect(await runPluginPageAction('music', 'delete_project', {})).toMatchObject({ status: 'forbidden' });
    expect(await runPluginPageAction('missing', 'plugin_m_fail', {})).toEqual({ status: 'not_found' });
    const failed = await runPluginPageAction('music', 'plugin_m_fail', {});
    expect(failed).toMatchObject({ status: 'failed', error: 'no speaker', page: { id: 'music' } });
  });
});
