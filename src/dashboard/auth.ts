import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from 'node:process';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { configDir } from '../lib/config.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const COOKIE_NAME = 'shinobi_token';
const OPEN_PATHS = new Set(['/health']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function dashboardTokenPath(): string {
  return join(configDir(), 'dashboard-token');
}

export type TokenSource = 'env' | 'file' | 'generated';

export interface ResolveTokenResult {
  token: string;
  source: TokenSource;
  path: string;
}

export function resolveDashboardToken(): ResolveTokenResult {
  const path = dashboardTokenPath();
  const fromEnv = env['SHINOBI_DASHBOARD_TOKEN'];
  if (fromEnv && fromEnv.length > 0) {
    return { token: fromEnv, source: 'env', path };
  }
  if (existsSync(path)) {
    const stored = readFileSync(path, 'utf-8').trim();
    if (stored.length > 0) {
      return { token: stored, source: 'file', path };
    }
  }
  const token = randomBytes(24).toString('hex');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token + '\n', 'utf-8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows filesystems often reject chmod; the file is still inside the
    // user-scoped config dir, so this is best-effort hardening.
  }
  return { token, source: 'generated', path };
}

function tokenFromRequest(c: Context): string | null {
  const auth = c.req.header('authorization') ?? c.req.header('Authorization');
  if (auth && /^bearer\s+/i.test(auth)) {
    const value = auth.replace(/^bearer\s+/i, '').trim();
    if (value.length > 0) return value;
  }
  const headerToken = c.req.header('x-shinobi-token');
  if (headerToken && headerToken.length > 0) return headerToken;
  const cookie = getCookie(c, COOKIE_NAME);
  if (cookie && cookie.length > 0) return cookie;
  const url = new URL(c.req.url);
  const q = url.searchParams.get('token');
  if (q && q.length > 0) return q;
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function escHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AuthMiddlewareOptions {
  enabled: boolean;
  token: string | null;
  tokenPath?: string;
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    if (!opts.enabled || !opts.token) {
      return next();
    }
    const path = new URL(c.req.url).pathname;
    if (OPEN_PATHS.has(path)) {
      return next();
    }
    const presented = tokenFromRequest(c);
    if (!presented || !safeEqual(presented, opts.token)) {
      const accept = c.req.header('accept') ?? '';
      if (accept.includes('text/html')) {
        const hint = escHtml(opts.tokenPath ?? '~/.shinobi/dashboard-token');
        return c.html(
          `<!doctype html><html><head><meta charset="utf-8"><title>Shinobi — unauthorized</title></head>
<body style="font-family:-apple-system,Segoe UI,sans-serif;padding:24px;background:#0f1216;color:#d8dee9">
<h2 style="color:#eceff4">Shinobi dashboard — unauthorized</h2>
<p>Append <code>?token=YOUR_TOKEN</code> once (we set a cookie) or send <code>Authorization: Bearer YOUR_TOKEN</code>.</p>
<p>Token source: env <code>SHINOBI_DASHBOARD_TOKEN</code> or file <code>${hint}</code>.</p>
</body></html>`,
          401,
        );
      }
      return c.json({ error: 'unauthorized' }, 401);
    }
    const url = new URL(c.req.url);
    if (url.searchParams.has('token')) {
      setCookie(c, COOKIE_NAME, opts.token, {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return next();
  };
}
