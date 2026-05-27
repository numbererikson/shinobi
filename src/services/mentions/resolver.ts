// Resolves @mentions in free-text bodies to user IDs and records a row
// per mention. The resolver matches "@<localpart>" against users whose
// email local part equals localpart (case-insensitive). Users can also
// be mentioned by exact lowercase `name` if it contains no spaces.

import { getDb } from '../../lib/db.js';

const MENTION_RE = /@([a-zA-Z0-9_.+-]+)/g;

export type MentionEntityType = 'decision' | 'subtask' | 'note';

export interface MentionRow {
  id: number;
  entity_type: MentionEntityType;
  entity_id: number;
  mentioned_user_id: number;
  mentioned_by_user_id: number | null;
  project_id: number | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface ResolvedMention {
  user_id: number;
  email: string;
  handle: string;
}

interface UserMatch {
  id: number;
  email: string;
  name: string | null;
}

export function resolveMentionsInText(text: string): ResolvedMention[] {
  if (!text) return [];
  const handles = new Set<string>();
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    handles.add(m[1]!.toLowerCase());
  }
  if (handles.size === 0) return [];

  const out: ResolvedMention[] = [];
  const seen = new Set<number>();
  for (const handle of handles) {
    const user = lookupUserByHandle(handle);
    if (!user) continue;
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    out.push({ user_id: user.id, email: user.email, handle });
  }
  return out;
}

function lookupUserByHandle(handle: string): UserMatch | null {
  const db = getDb();
  const byEmail = db
    .prepare<[string], UserMatch>(
      "SELECT id, email, name FROM users WHERE LOWER(SUBSTR(email, 1, INSTR(email, '@') - 1)) = ?",
    )
    .get(handle);
  if (byEmail) return byEmail;
  return (
    db
      .prepare<[string], UserMatch>(
        "SELECT id, email, name FROM users WHERE LOWER(REPLACE(name, ' ', '')) = ?",
      )
      .get(handle) ?? null
  );
}

export interface RecordMentionsInput {
  entity_type: MentionEntityType;
  entity_id: number;
  project_id: number | null;
  mentioned_by_user_id?: number | null;
}

export function recordMentions(text: string, ctx: RecordMentionsInput): ResolvedMention[] {
  const resolved = resolveMentionsInText(text);
  if (resolved.length === 0) return resolved;
  const insertStmt = getDb().prepare(
    `INSERT INTO mentions (entity_type, entity_id, mentioned_user_id, mentioned_by_user_id, project_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteStmt = getDb().prepare(
    `DELETE FROM mentions WHERE entity_type = ? AND entity_id = ?`,
  );
  const tx = getDb().transaction((items: ResolvedMention[]) => {
    deleteStmt.run(ctx.entity_type, ctx.entity_id);
    for (const r of items) {
      insertStmt.run(
        ctx.entity_type,
        ctx.entity_id,
        r.user_id,
        ctx.mentioned_by_user_id ?? null,
        ctx.project_id,
      );
    }
  });
  tx(resolved);
  return resolved;
}

export interface MentionInbox {
  user_id: number;
  total: number;
  unread: number;
  items: Array<MentionRow & { entity_summary: string | null }>;
}

export function getMentionsForUser(userId: number, limit = 50): MentionInbox {
  const totalRow = getDb()
    .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM mentions WHERE mentioned_user_id = ?')
    .get(userId);
  const unreadRow = getDb()
    .prepare<[number], { n: number }>(
      'SELECT COUNT(*) AS n FROM mentions WHERE mentioned_user_id = ? AND acknowledged_at IS NULL',
    )
    .get(userId);
  interface JoinRow extends MentionRow {
    entity_summary: string | null;
  }
  const items = getDb()
    .prepare<[number, number], JoinRow>(
      `SELECT m.*,
              CASE m.entity_type
                WHEN 'decision' THEN (SELECT summary FROM decisions WHERE id = m.entity_id)
                WHEN 'subtask' THEN (SELECT title FROM subtasks WHERE id = m.entity_id)
                WHEN 'note' THEN (SELECT SUBSTR(body, 1, 120) FROM notes WHERE id = m.entity_id)
                ELSE NULL
              END AS entity_summary
       FROM mentions m
       WHERE m.mentioned_user_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit);
  return {
    user_id: userId,
    total: totalRow?.n ?? 0,
    unread: unreadRow?.n ?? 0,
    items,
  };
}

export function acknowledgeMention(mentionId: number, userId: number): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE mentions SET acknowledged_at = CURRENT_TIMESTAMP
         WHERE id = ? AND mentioned_user_id = ? AND acknowledged_at IS NULL`,
      )
      .run(mentionId, userId).changes > 0
  );
}

export function acknowledgeAllMentions(userId: number): number {
  return getDb()
    .prepare(
      `UPDATE mentions SET acknowledged_at = CURRENT_TIMESTAMP
       WHERE mentioned_user_id = ? AND acknowledged_at IS NULL`,
    )
    .run(userId).changes;
}
