// Server-signed cookie session. Stateless: cookie carries `<user_id>.<hmac>`
// signed with a secret derived from the dashboard token file (reusing existing
// trust root). Verifies on every middleware call; no DB lookup unless the
// cookie is valid.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { resolveDashboardToken } from '../../dashboard/auth.js';
import { countUsers, getUser, type User } from '../../models/users.js';

const COOKIE_NAME = 'shinobi_user';
const COOKIE_TTL_S = 60 * 60 * 24 * 30;

function signingSecret(): string {
  return `auth:${resolveDashboardToken().token}`;
}

function sign(userId: number): string {
  const h = createHmac('sha256', signingSecret()).update(String(userId)).digest('hex');
  return `${userId}.${h}`;
}

function verifySignature(cookie: string): number | null {
  const idx = cookie.indexOf('.');
  if (idx < 1) return null;
  const idStr = cookie.slice(0, idx);
  const sig = cookie.slice(idx + 1);
  const userId = Number(idStr);
  if (!Number.isFinite(userId)) return null;
  const expected = createHmac('sha256', signingSecret()).update(String(userId)).digest('hex');
  const a = Buffer.from(sig, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? userId : null;
}

export function setSessionCookie(c: Context, userId: number): void {
  setCookie(c, COOKIE_NAME, sign(userId), {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: COOKIE_TTL_S,
  });
}

export function clearSessionCookie(c: Context): void {
  setCookie(c, COOKIE_NAME, '', { path: '/', maxAge: 0 });
}

export function readSessionUser(c: Context): User | null {
  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie) return null;
  const userId = verifySignature(cookie);
  if (userId === null) return null;
  return getUser(userId);
}

/**
 * Returns the effective user for this request. In single-user mode
 * (zero users in DB), synthesizes a transparent master placeholder so
 * legacy installs keep working without any login flow.
 */
export function effectiveUser(c: Context): User | { transparent: true; role: 'master' } | null {
  if (countUsers() === 0) {
    return { transparent: true, role: 'master' };
  }
  return readSessionUser(c);
}
