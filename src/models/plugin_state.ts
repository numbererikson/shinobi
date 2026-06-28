import { getDb } from '../lib/db.js';
import { parseJsonOrNull } from '../lib/json.js';

/**
 * Generic key/value persistence for plugins, scoped by plugin name.
 *
 * Values are JSON-serialized on write and parsed on read. A stored value that
 * fails to parse is treated as absent (returns null) rather than throwing, so a
 * corrupt blob degrades to "no state" instead of crashing the host — see the
 * failure rules in the plugin specs.
 */

export function getPluginState<T>(plugin: string, key: string): T | null {
  const row = getDb()
    .prepare<[string, string], { value: string }>(
      'SELECT value FROM plugin_state WHERE plugin = ? AND key = ?',
    )
    .get(plugin, key);
  return row ? parseJsonOrNull<T>(row.value) : null;
}

export function setPluginState(plugin: string, key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO plugin_state (plugin, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(plugin, key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(plugin, key, JSON.stringify(value));
}

export function deletePluginState(plugin: string, key: string): void {
  getDb()
    .prepare('DELETE FROM plugin_state WHERE plugin = ? AND key = ?')
    .run(plugin, key);
}

/**
 * Atomic read-modify-write. The mutator receives the current value (or null)
 * and returns the next value to persist. Wrapped in a single SQLite transaction
 * so concurrent async handlers under the HTTP transport cannot interleave a
 * separate get/set pair and clobber each other. Returns the persisted value.
 */
export function updatePluginState<T>(
  plugin: string,
  key: string,
  mutator: (current: T | null) => T,
): T {
  const db = getDb();
  const tx = db.transaction((): T => {
    const current = getPluginState<T>(plugin, key);
    const next = mutator(current);
    setPluginState(plugin, key, next);
    return next;
  });
  return tx();
}
