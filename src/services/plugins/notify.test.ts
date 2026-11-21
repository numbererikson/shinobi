import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb, getDb } from '../../lib/db.js';
import { createPushActions } from '../../models/plugin_push_actions.js';
import type { PushPayload, SafePushResult } from '../push/web-push.js';
import { setModuleEnabled } from '../modules.js';
import { runPluginPushAction } from './notify.js';
import { createInProcessRegistry } from './registry.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-notify-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  getDb().exec('DELETE FROM plugin_push_actions; DELETE FROM modules;');
});

const delivered: SafePushResult = { total: 1, succeeded: 1, failed: 0, pruned_endpoints: [], error: null };

/** A reminders-like plugin whose notification buttons call its own tools. */
function setup() {
  const sent: PushPayload[] = [];
  const pressed: string[] = [];
  const reg = createInProcessRegistry('rem', undefined, {
    send: async (payload) => {
      sent.push(payload);
      return delivered;
    },
  });
  for (const name of ['plugin_rem_done', 'plugin_rem_snooze']) {
    reg.registry.registerTool({
      name,
      description: name,
      inputSchema: { type: 'object' },
      handler: (args) => {
        pressed.push(`${name}:${JSON.stringify(args)}`);
        return { ok: true };
      },
    });
  }
  return { ...reg, sent, pressed };
}

const tokenOf = (payload: PushPayload, i: number): string => payload.actions![i]!.action.slice('plugin:'.length);

describe('registry.notify', () => {
  it('sends title, body, url and buttons with opaque tokens', async () => {
    const { registry, sent } = setup();
    const result = await registry.notify({
      title: 'Nazovi banku',
      body: 'Podsjetnik',
      url: '/apps/reminders',
      tag: 'rem-1',
      actions: [
        { label: 'Done', tool: 'plugin_rem_done', args: { id: 1 } },
        { label: 'Snooze 1h', tool: 'plugin_rem_snooze', args: { id: 1, minutes: 60 } },
      ],
    });
    expect(result).toEqual(delivered);
    expect(sent).toHaveLength(1);
    const p = sent[0]!;
    expect(p).toMatchObject({ title: 'Nazovi banku', body: 'Podsjetnik', url: '/apps/reminders', tag: 'rem-1' });
    expect(p.actions!.map((a) => a.title)).toEqual(['Done', 'Snooze 1h']);
    expect(p.actions![0]!.action).toMatch(/^plugin:[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(p)).not.toContain('plugin_rem_done');
  });

  it('runs the pressed button once and retires its siblings', async () => {
    const { registry, sent, pressed, runPushAction } = setup();
    await registry.notify({
      title: 't',
      body: 'b',
      actions: [
        { label: 'Done', tool: 'plugin_rem_done', args: { id: 7 } },
        { label: 'Snooze', tool: 'plugin_rem_snooze', args: { id: 7 } },
      ],
    });
    const payload = sent[0]!;
    expect(await runPushAction(tokenOf(payload, 0))).toEqual({ status: 'ok', result: { ok: true } });
    expect(await runPushAction(tokenOf(payload, 0))).toEqual({ status: 'not_found' });
    expect(await runPushAction(tokenOf(payload, 1))).toEqual({ status: 'not_found' });
    expect(pressed).toEqual(['plugin_rem_done:{"id":7}']);
  });

  it('rejects invalid notifications', async () => {
    const { registry } = setup();
    await expect(registry.notify({ title: '', body: 'b' })).rejects.toThrow(/title/);
    await expect(registry.notify({ title: 't', body: 'b', url: 'https://evil.example' })).rejects.toThrow(/same-origin/);
    await expect(registry.notify({ title: 't', body: 'b', url: '//evil.example' })).rejects.toThrow(/same-origin/);
    await expect(
      registry.notify({ title: 't', body: 'b', actions: [{ label: 'x', tool: 'plugin_other_tool' }] }),
    ).rejects.toThrow(/not registered by this plugin/);
    const three = Array.from({ length: 3 }, () => ({ label: 'x', tool: 'plugin_rem_done' }));
    await expect(registry.notify({ title: 't', body: 'b', actions: three })).rejects.toThrow(/at most 2/);
  });

  it('caps long text', async () => {
    const { registry, sent } = setup();
    await registry.notify({ title: 'x'.repeat(500), body: 'y'.repeat(5000) });
    expect(sent[0]!.title).toHaveLength(120);
    expect(sent[0]!.body).toHaveLength(1000);
  });

  it('does not send while the module is switched off', async () => {
    const { registry, sent } = setup();
    setModuleEnabled('rem', false);
    const result = await registry.notify({ title: 't', body: 'b', actions: [{ label: 'Done', tool: 'plugin_rem_done' }] });
    expect(result.error).toBe('module disabled');
    expect(sent).toHaveLength(0);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM plugin_push_actions').get()).toEqual({ n: 0 });
  });
});

describe('runPluginPushAction', () => {
  it('refuses unknown and expired tokens', async () => {
    expect(await runPluginPushAction('nope')).toEqual({ status: 'not_found' });
    createPushActions('n1', 'rem', [{ token: 'expired', tool: 'plugin_rem_done', args: {} }], 0);
    expect(await runPluginPushAction('expired')).toEqual({ status: 'not_found' });
  });

  it('refuses a tool the plugin does not own', async () => {
    createPushActions('n2', 'rem', [{ token: 'foreign', tool: 'plugin_other_tool', args: {} }], 60);
    const r = await runPluginPushAction('foreign', () => null);
    expect(r).toEqual({ status: 'forbidden', error: "tool 'plugin_other_tool' does not belong to plugin 'rem'" });
  });

  it('refuses buttons of a switched-off module', async () => {
    createPushActions('n3', 'rem', [{ token: 'off', tool: 'plugin_rem_done', args: {} }], 60);
    setModuleEnabled('rem', false);
    expect(await runPluginPushAction('off', () => () => 'ran')).toEqual({ status: 'forbidden', error: 'module disabled' });
  });

  it('reports a failing tool', async () => {
    createPushActions('n4', 'rem', [{ token: 'bad', tool: 'plugin_rem_done', args: {} }], 60);
    const r = await runPluginPushAction('bad', () => () => {
      throw new Error('kaput');
    });
    expect(r).toEqual({ status: 'failed', error: 'kaput' });
  });
});
