import { getDb } from '../lib/db.js';

export type UserRole = 'master' | 'member' | 'viewer';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

export interface CreateUserInput {
  email: string;
  name?: string | null;
  role?: UserRole;
}

export function createUser(input: CreateUserInput): User {
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, name, role) VALUES (?, ?, COALESCE(?, 'member'))`,
    )
    .run(input.email.toLowerCase(), input.name ?? null, input.role ?? null);
  const created = getUser(Number(result.lastInsertRowid));
  if (!created) throw new Error('createUser: lookup after insert returned null');
  return created;
}

export function getUser(id: number): User | null {
  return getDb().prepare<[number], User>('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function findUserByEmail(email: string): User | null {
  return (
    getDb()
      .prepare<[string], User>('SELECT * FROM users WHERE email = ?')
      .get(email.toLowerCase()) ?? null
  );
}

export function listUsers(): User[] {
  return getDb().prepare<[], User>('SELECT * FROM users ORDER BY created_at ASC').all();
}

export function countUsers(): number {
  return (getDb().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get())?.n ?? 0;
}

export function touchLastLogin(userId: number): void {
  getDb().prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

export function setRole(userId: number, role: UserRole): User | null {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return getUser(userId);
}

export function disableUser(userId: number): void {
  getDb().prepare('UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

export function ensureMasterUser(email: string, name?: string): User {
  const existing = findUserByEmail(email);
  if (existing) {
    if (existing.role !== 'master') setRole(existing.id, 'master');
    return findUserByEmail(email) ?? existing;
  }
  return createUser({ email, name: name ?? null, role: 'master' });
}
