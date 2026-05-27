// Magic-link issuance + verification. We do NOT send emails ourselves yet —
// the link is printed to the dashboard log and surfaced via the issue API
// response so the operator can either (a) email it manually or (b) configure
// an external mailer that polls the database.

import { randomBytes } from 'node:crypto';
import { stderr } from 'node:process';
import { getDb } from '../../lib/db.js';
import { findUserByEmail, touchLastLogin, type User } from '../../models/users.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export interface AuthToken {
  id: number;
  email: string;
  token: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface IssueResult {
  token: string;
  expires_at: string;
  email: string;
}

export function issueMagicLink(email: string, ttlMs = DEFAULT_TTL_MS): IssueResult {
  const normalized = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('invalid email');
  }
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  getDb()
    .prepare('INSERT INTO auth_tokens (email, token, expires_at) VALUES (?, ?, ?)')
    .run(normalized, token, expiresAt);
  stderr.write(`auth: magic link issued for ${normalized} (expires ${expiresAt})\n`);
  return { token, expires_at: expiresAt, email: normalized };
}

export interface VerifyResult {
  ok: true;
  user: User;
  token: string;
}

export interface VerifyError {
  ok: false;
  error: 'token_not_found' | 'token_expired' | 'token_consumed' | 'user_not_found';
}

export function verifyMagicLink(token: string): VerifyResult | VerifyError {
  const row = getDb()
    .prepare<[string], AuthToken>('SELECT * FROM auth_tokens WHERE token = ?')
    .get(token);
  if (!row) return { ok: false, error: 'token_not_found' };
  if (row.consumed_at !== null) return { ok: false, error: 'token_consumed' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: 'token_expired' };
  const user = findUserByEmail(row.email);
  if (!user) return { ok: false, error: 'user_not_found' };
  getDb()
    .prepare('UPDATE auth_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(row.id);
  touchLastLogin(user.id);
  return { ok: true, user, token };
}

export function purgeExpiredTokens(): number {
  return getDb()
    .prepare(
      `DELETE FROM auth_tokens
       WHERE consumed_at IS NOT NULL OR expires_at < CURRENT_TIMESTAMP`,
    )
    .run().changes;
}
