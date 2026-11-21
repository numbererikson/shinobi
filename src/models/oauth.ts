import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../lib/db.js';

/**
 * OAuth 2.1 storage for the remote /mcp endpoint: dynamically registered
 * clients, one-time authorization codes (PKCE S256) and access/refresh tokens.
 * Codes and tokens are stored only as SHA-256 hashes, so a database copy
 * (backup, `shinobi sync` repo) never contains a usable credential.
 */

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, rotated on use
export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_CLIENTS = 100;

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: string;
  approved_at: string | null;
  last_used_at: string | null;
}

interface ClientRow extends Omit<OAuthClient, 'redirect_uris'> {
  redirect_uris: string;
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function randomSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

function hydrate(row: ClientRow): OAuthClient {
  let uris: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.redirect_uris);
    if (Array.isArray(parsed)) uris = parsed.filter((u): u is string => typeof u === 'string');
  } catch {
    uris = [];
  }
  return { ...row, redirect_uris: uris };
}

export function countClients(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM oauth_clients').get() as { n: number };
  return row.n;
}

export function registerClient(input: { client_name?: string | null; redirect_uris: string[] }): OAuthClient {
  const clientId = `shinobi_client_${randomBytes(16).toString('base64url')}`;
  getDb()
    .prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)')
    .run(clientId, input.client_name ?? null, JSON.stringify(input.redirect_uris));
  const created = getClient(clientId);
  if (!created) throw new Error('registerClient: lookup after insert returned null');
  return created;
}

export function getClient(clientId: string): OAuthClient | null {
  const row = getDb().prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as ClientRow | undefined;
  return row ? hydrate(row) : null;
}

/** Clients the owner has approved at least once (unapproved registrations are noise). */
export function listApprovedClients(): OAuthClient[] {
  const rows = getDb()
    .prepare('SELECT * FROM oauth_clients WHERE approved_at IS NOT NULL ORDER BY approved_at DESC')
    .all() as ClientRow[];
  return rows.map(hydrate);
}

/** Revoke a client: its codes and tokens go with it. */
export function deleteClient(clientId: string): boolean {
  const db = getDb();
  const tx = db.transaction((id: string) => {
    db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(id);
    db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(id);
    return db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(id).changes > 0;
  });
  return tx(clientId);
}

export function createAuthorizationCode(input: { client_id: string; redirect_uri: string; code_challenge: string }, now = Date.now()): string {
  const code = randomSecret('shinobi_code');
  const db = getDb();
  db.prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    hashSecret(code),
    input.client_id,
    input.redirect_uri,
    input.code_challenge,
    now + CODE_TTL_MS,
  );
  db.prepare("UPDATE oauth_clients SET approved_at = COALESCE(approved_at, datetime('now')) WHERE client_id = ?").run(input.client_id);
  return code;
}

/** One-time use: the code is deleted whether or not it is still valid. */
export function consumeAuthorizationCode(code: string, now = Date.now()): { client_id: string; redirect_uri: string; code_challenge: string } | null {
  const db = getDb();
  const hash = hashSecret(code);
  const row = db.prepare('SELECT client_id, redirect_uri, code_challenge, expires_at FROM oauth_codes WHERE code_hash = ?').get(hash) as
    | { client_id: string; redirect_uri: string; code_challenge: string; expires_at: number }
    | undefined;
  db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(hash);
  if (!row || row.expires_at < now) return null;
  return { client_id: row.client_id, redirect_uri: row.redirect_uri, code_challenge: row.code_challenge };
}

export function issueTokens(clientId: string, now = Date.now()): IssuedTokens {
  const access = randomSecret('shinobi_at');
  const refresh = randomSecret('shinobi_rt');
  const insert = getDb().prepare('INSERT INTO oauth_tokens (token_hash, kind, client_id, expires_at) VALUES (?, ?, ?, ?)');
  insert.run(hashSecret(access), 'access', clientId, now + ACCESS_TOKEN_TTL_MS);
  insert.run(hashSecret(refresh), 'refresh', clientId, now + REFRESH_TOKEN_TTL_MS);
  // Opportunistic cleanup so the table never grows without bound.
  getDb().prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').run(now);
  getDb().prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(now);
  return { access_token: access, refresh_token: refresh, expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

/** Refresh-token rotation: the presented refresh token is spent, a new pair is issued. */
export function rotateRefreshToken(refreshToken: string, clientId: string, now = Date.now()): IssuedTokens | null {
  const db = getDb();
  const hash = hashSecret(refreshToken);
  const row = db.prepare("SELECT client_id, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(hash) as
    | { client_id: string; expires_at: number }
    | undefined;
  if (!row || row.client_id !== clientId) return null;
  db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(hash);
  if (row.expires_at < now || !getClient(clientId)) return null;
  return issueTokens(clientId, now);
}

/** The client id an access token belongs to, or null if unknown or expired. */
export function verifyAccessToken(token: string, now = Date.now()): string | null {
  if (!token.startsWith('shinobi_at_')) return null;
  const db = getDb();
  const row = db.prepare("SELECT client_id, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(hashSecret(token)) as
    | { client_id: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < now) return null;
  db.prepare(
    "UPDATE oauth_clients SET last_used_at = datetime('now') WHERE client_id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))",
  ).run(row.client_id);
  return row.client_id;
}
