import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb } from '../../lib/db.js';
import { createInProcessRegistry, type PluginRegistry } from './registry.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-registry-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

// Trivial plugin exercising registry.state — the platform's end-to-end path.
function counterPlugin(registry: PluginRegistry): void {
  registry.registerTool({
    name: 'plugin_counter_bump',
    description: 'Increment a persistent counter',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({ count: registry.state.update<number>('count', (c) => (c ?? 0) + 1) }),
  });
}

describe('createInProcessRegistry', () => {
  it('registers tools and persists state across calls', async () => {
    const { registry, call } = createInProcessRegistry('counter');
    counterPlugin(registry);
    expect((await call('plugin_counter_bump')) as { count: number }).toEqual({ count: 1 });
    expect((await call('plugin_counter_bump')) as { count: number }).toEqual({ count: 2 });
  });

  it('persists state across a fresh registry with the same plugin name', async () => {
    const { registry, call } = createInProcessRegistry('counter');
    counterPlugin(registry);
    expect(((await call('plugin_counter_bump')) as { count: number }).count).toBe(3);
  });

  it('scopes state by plugin name', async () => {
    const { registry, call } = createInProcessRegistry('counter_other');
    counterPlugin(registry);
    // Independent namespace from 'counter', so it starts fresh.
    expect(((await call('plugin_counter_bump')) as { count: number }).count).toBe(1);
  });

  it('rejects tool names that break the plugin_ convention', () => {
    const { registry } = createInProcessRegistry('bad');
    expect(() =>
      registry.registerTool({
        name: 'badName',
        description: '',
        inputSchema: {},
        handler: () => ({}),
      }),
    ).toThrow();
  });

  it('rejects duplicate tool names', () => {
    const { registry } = createInProcessRegistry('dupe');
    counterPlugin(registry);
    expect(() => counterPlugin(registry)).toThrow();
  });
});
