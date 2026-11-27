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
  sanitizeSvg,
} from './pages.js';

function plugin(name: string, tools: Record<string, (args: Record<string, unknown>) => unknown> = {}): void {
  // Mirrors buildPluginRegistry: the plugin is recorded with the tools it owns.
  recordPlugin({ name, source: 'user', module_path: `file:///${name}.mjs`, tools_registered: Object.keys(tools), pages_registered: [], schedules_registered: [], error: null });
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

describe('input block', () => {
  it('keeps a text field bound to an own tool and drops foreign tools or bad arg names', () => {
    plugin('user/m', { plugin_m_say: () => 'ok' });
    plugin('user/x', { plugin_x_wipe: () => 'gone' });
    const blocks = sanitizeBlocks(
      [
        { type: 'input', label: 'Announce', placeholder: 'Lunch is ready', button: 'Say', tool: 'plugin_m_say', arg: 'text', args: { wait: false }, maxLength: 99999 },
        { type: 'input', button: 'Steal', tool: 'plugin_x_wipe', arg: 'text' },
        { type: 'input', button: 'Bad', tool: 'plugin_m_say', arg: 'not valid!' },
        { type: 'input', tool: 'plugin_m_say', arg: 'text' },
      ],
      'user/m',
    );
    expect(blocks).toEqual([
      { type: 'input', label: 'Announce', placeholder: 'Lunch is ready', button: 'Say', tool: 'plugin_m_say', arg: 'text', args: { wait: false }, maxLength: 2000 },
      { type: 'input', button: 'Send', tool: 'plugin_m_say', arg: 'text', maxLength: 500 },
    ]);
  });
});


describe('figure block', () => {
  const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="url(#g)"/><use href="#a"/></svg>';

  it('keeps a self-contained SVG, adds the namespace, caps the text and defaults the size', () => {
    const [fig] = sanitizeBlocks(
      [{ type: 'figure', svg: `  ${svg}  `, title: 'Squat', caption: 'Sit back.', bullets: ['Chest up', '', 'x'.repeat(500)], size: 'huge', collapsed: true }],
      'user/m',
    );
    expect(fig).toMatchObject({ type: 'figure', alt: 'Squat', title: 'Squat', caption: 'Sit back.', size: 'md', collapsed: true });
    const f = fig as { svg: string; bullets: string[] };
    expect(f.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox')).toBe(true);
    expect(f.bullets).toHaveLength(2);
    expect(f.bullets[1]!.length).toBeLessThanOrEqual(240);
  });

  it('keeps an existing namespace and drops collapsed without a title', () => {
    const [fig] = sanitizeBlocks([{ type: 'figure', svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', alt: 'Dot', size: 'lg', collapsed: true }], 'user/m');
    expect(fig).toEqual({ type: 'figure', svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', alt: 'Dot', size: 'lg' });
  });

  it.each([
    ['script', '<svg><script>alert(1)</script></svg>'],
    ['event handler', '<svg><rect onload="x()"/></svg>'],
    ['foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['external href', '<svg><use href="https://evil.example/x.svg#a"/></svg>'],
    ['external xlink', "<svg><a xlink:href='javascript:x'/></svg>"],
    ['external image', '<svg><image href="#a"/></svg>'],
    ['remote paint', '<svg><rect fill="url(https://evil.example/p)"/></svg>'],
    ['css import', '<svg><style>@import "x.css";</style></svg>'],
    ['entity', '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>'],
    ['not svg', '<div></div>'],
    ['unterminated', '<svg>'],
    ['too big', `<svg>${'a'.repeat(100_001)}</svg>`],
    ['not a string', 42],
  ])('drops a figure with %s', (_label, bad) => {
    expect(sanitizeBlocks([{ type: 'figure', svg: bad, alt: 'x' }], 'user/m')).toEqual([]);
  });

  it('exposes the SVG check for plugins and tests', () => {
    expect(sanitizeSvg(svg)).toContain('xmlns=');
    expect(sanitizeSvg('<svg><use href = "#ok"/></svg>')).not.toBeNull();
    expect(sanitizeSvg('<svg><use href=x.svg /></svg>')).toBeNull();
  });
});

describe('form block', () => {
  it('keeps typed fields bound to an own tool and normalises their values', () => {
    plugin('user/f', { plugin_f_profile: () => 'ok' });
    plugin('user/x', { plugin_x_wipe: () => 'gone' });
    const blocks = sanitizeBlocks(
      [
        {
          type: 'form',
          title: 'Profile',
          tool: 'plugin_f_profile',
          args: { source: 'page' },
          fields: [
            { name: 'weight', label: 'Weight', kind: 'number', unit: 'kg', min: 30, max: 250, step: 0.1, value: 300, required: true },
            { name: 'pain', label: 'Shoulder pain', kind: 'slider', value: 14 },
            { name: 'level', label: 'Level', kind: 'select', options: ['beginner', { value: 'pro', label: 'Pro' }, ''], value: 'nope' },
            { name: 'notes', label: 'Notes', kind: 'textarea', value: 'n'.repeat(5000), maxLength: 99999 },
            { name: 'tower', label: 'Power tower', kind: 'toggle', value: 'yes' },
            { name: 'nick', kind: 'mystery' },
            { name: 'weight', label: 'Duplicate', kind: 'text' },
            { name: 'bad name!', label: 'Bad', kind: 'text' },
            { name: 'empty', label: 'No options', kind: 'select', options: [] },
          ],
        },
        { type: 'form', tool: 'plugin_x_wipe', fields: [{ name: 'a', kind: 'text' }] },
        { type: 'form', tool: 'plugin_f_profile', fields: [] },
      ],
      'user/f',
    );
    expect(blocks).toHaveLength(1);
    const form = blocks[0] as Extract<(typeof blocks)[number], { type: 'form' }>;
    expect(form).toMatchObject({ type: 'form', title: 'Profile', tool: 'plugin_f_profile', button: 'Save', args: { source: 'page' } });
    expect(form.fields.map((f) => f.name)).toEqual(['weight', 'pain', 'level', 'notes', 'tower', 'nick']);
    expect(form.fields[0]).toEqual({ name: 'weight', label: 'Weight', kind: 'number', unit: 'kg', min: 30, max: 250, step: 0.1, value: 250, required: true });
    expect(form.fields[1]).toEqual({ name: 'pain', label: 'Shoulder pain', kind: 'slider', min: 0, max: 10, value: 10 });
    expect(form.fields[2]).toEqual({
      name: 'level',
      label: 'Level',
      kind: 'select',
      options: [
        { value: 'beginner', label: 'beginner' },
        { value: 'pro', label: 'Pro' },
      ],
    });
    expect(form.fields[3]!.maxLength).toBe(2000);
    expect((form.fields[3]!.value as string).length).toBeLessThanOrEqual(2000);
    expect(form.fields[4]).toEqual({ name: 'tower', label: 'Power tower', kind: 'toggle', value: false });
    expect(form.fields[5]).toEqual({ name: 'nick', label: 'nick', kind: 'text', maxLength: 200 });
  });
});

describe('page theme', () => {
  it('renders the chosen preset and falls back to default for unknown ones', async () => {
    plugin('user/t');
    registerPluginPage('user/t', { id: 'glow', title: 'Glow', theme: 'hologram', icon: 'swords', render: () => [] });
    registerPluginPage('user/t', { id: 'odd', title: 'Odd', theme: 'neon' as never, render: () => [] });
    registerPluginPage('user/t', { id: 'plain', title: 'Plain', render: () => [] });
    expect(await renderPluginPage('glow')).toMatchObject({ theme: 'hologram', icon: 'swords' });
    expect(await renderPluginPage('odd')).toMatchObject({ theme: 'default' });
    expect(await renderPluginPage('plain')).toMatchObject({ theme: 'default' });
  });
});

describe('chart block', () => {
  it('aligns values to labels, turns junk into gaps and caps series', () => {
    const blocks = sanitizeBlocks(
      [
        {
          type: 'chart',
          kind: 'bar',
          title: 'Weight',
          unit: 'kg',
          labels: ['Mon', 'Tue', 'Wed'],
          series: [
            { name: 'Me', values: [80, '79.5', 'x', 99] },
            { name: 'Empty', values: [null, 'nope'] },
            { name: 'a', values: [1] },
            { name: 'b', values: [1] },
            { name: 'c', values: [1] },
            { name: 'd', values: [1] },
          ],
        },
        { type: 'chart', labels: [], series: [{ name: 'x', values: [1] }] },
        { type: 'chart', kind: 'pie', labels: ['a'], series: [{ values: [2] }] },
      ],
      'user/m',
    );
    expect(blocks).toEqual([
      {
        type: 'chart',
        kind: 'bar',
        title: 'Weight',
        unit: 'kg',
        labels: ['Mon', 'Tue', 'Wed'],
        series: [
          { name: 'Me', values: [80, 79.5, null] },
          { name: 'a', values: [1, null, null] },
          { name: 'b', values: [1, null, null] },
        ],
      },
      { type: 'chart', kind: 'line', labels: ['a'], series: [{ name: 'Series', values: [2] }] },
    ]);
  });
});
