import { getDb } from '../lib/db.js';
import { parseJsonOrNull } from '../lib/json.js';

/**
 * One-time tokens behind plugin push notification buttons. Buttons of the same
 * notification share `notification_id`; consuming one consumes them all.
 */

export interface PushActionInput {
  token: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PushAction {
  plugin: string;
  tool: string;
  args: Record<string, unknown>;
}

export function createPushActions(
  notificationId: string,
  plugin: string,
  actions: PushActionInput[],
  ttlSeconds: number,
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO plugin_push_actions (token, notification_id, plugin, tool, args, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
  );
  db.transaction(() => {
    for (const a of actions) {
      insert.run(a.token, notificationId, plugin, a.tool, JSON.stringify(a.args), `+${ttlSeconds} seconds`);
    }
  })();
}

/**
 * Atomically consume a token: returns its action and marks every button of the
 * same notification used, or null when the token is unknown, used or expired.
 */
export function consumePushAction(token: string): PushAction | null {
  const db = getDb();
  return db.transaction((): PushAction | null => {
    const row = db
      .prepare<[string], { notification_id: string; plugin: string; tool: string; args: string }>(
        `SELECT notification_id, plugin, tool, args FROM plugin_push_actions
          WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')`,
      )
      .get(token);
    if (!row) return null;
    db.prepare(
      `UPDATE plugin_push_actions SET used_at = datetime('now') WHERE notification_id = ? AND used_at IS NULL`,
    ).run(row.notification_id);
    return { plugin: row.plugin, tool: row.tool, args: parseJsonOrNull<Record<string, unknown>>(row.args) ?? {} };
  })();
}

/** Drop tokens that expired or were used more than a day ago. */
export function prunePushActions(): number {
  return getDb()
    .prepare(
      `DELETE FROM plugin_push_actions
        WHERE expires_at < datetime('now') OR used_at < datetime('now', '-1 day')`,
    )
    .run().changes;
}
