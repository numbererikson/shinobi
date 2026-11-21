import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from 'node:process';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { configDir } from '../lib/config.js';
import { verifyAccessToken } from '../models/oauth.js';
import { isOAuthOpenPath, resourceMetadataUrl } from './oauth.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const COOKIE_NAME = 'shinobi_token';
const OPEN_PATHS = new Set(['/health']);
const SIGNIN_PATH = '/auth/signin';

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
  // No ?token= query: a token in a URL ends up in browser history, proxy and
  // tunnel logs. Browsers sign in through the POST form and get a cookie.
  const cookie = getCookie(c, COOKIE_NAME);
  if (cookie && cookie.length > 0) return cookie;
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
  /** Accept OAuth access tokens on /mcp and leave the OAuth endpoints open. */
  oauth?: boolean;
}

/** Only same-site paths: never redirect a sign-in to another origin. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

function signinPage(next: string, tokenPath: string | undefined, error?: string): string {
  const hint = escHtml(tokenPath ?? '~/.shinobi/dashboard-token');
  // The form matters for an installed PWA (iOS home screen): it has no address
  // bar and does not share Safari's cookies. POST keeps the token out of URLs.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shinobi — sign in</title></head>
<body style="font-family:-apple-system,Segoe UI,sans-serif;padding:24px;background:#0f1216;color:#d8dee9">
<h2 style="color:#eceff4">Shinobi dashboard — sign in</h2>
${error ? `<p style="color:#bf616a">${escHtml(error)}</p>` : ''}
<form method="post" action="${SIGNIN_PATH}" style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">
<input type="hidden" name="next" value="${escHtml(next)}">
<input type="password" name="token" autocomplete="current-password" placeholder="Dashboard token" required style="flex:1;min-width:220px;padding:10px;font-size:16px;border-radius:6px;border:1px solid #3b4252;background:#1b1f27;color:#eceff4">
<button type="submit" style="padding:10px 16px;font-size:16px;border-radius:6px;border:0;background:#5e81ac;color:#fff">Sign in</button>
</form>
<p>The sign-in lasts 30 days on this device. API clients send <code>Authorization: Bearer YOUR_TOKEN</code>.</p>
<p>Token source: env <code>SHINOBI_DASHBOARD_TOKEN</code> or file <code>${hint}</code>.</p>
</body></html>`;
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    if (!opts.enabled || !opts.token) {
      return next();
    }
    const path = new URL(c.req.url).pathname;
    if (path === SIGNIN_PATH) {
      if (c.req.method !== 'POST') return c.html(signinPage(safeNext(c.req.query('next')), opts.tokenPath));
      const form = (await c.req.parseBody()) as Record<string, unknown>;
      const typed = typeof form['token'] === 'string' ? form['token'].trim() : '';
      const target = safeNext(form['next']);
      if (!typed || !safeEqual(typed, opts.token)) {
        return c.html(signinPage(target, opts.tokenPath, 'That is not the dashboard token.'), 401);
      }
      setCookie(c, COOKIE_NAME, opts.token, { path: '/', httpOnly: true, secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https', sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
      return c.redirect(target, 303);
    }
    if (OPEN_PATHS.has(path) || (opts.oauth && isOAuthOpenPath(path))) {
      return next();
    }
    const presented = tokenFromRequest(c);
    const isMcp = path === '/mcp' || path.startsWith('/mcp/');
    // OAuth access tokens (claude.ai connector "Connect" flow) are valid for the MCP endpoints only.
    if (opts.oauth && isMcp && presented && verifyAccessToken(presented)) {
      return next();
    }
    if (!presented || !safeEqual(presented, opts.token)) {
      if (opts.oauth && isMcp) {
        // Tells MCP clients where to start the OAuth flow (MCP authorization spec).
        c.header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl(c, path)}"`);
      }
      const accept = c.req.header('accept') ?? '';
      if (accept.includes('text/html')) {
        return c.html(signinPage(safeNext(path + new URL(c.req.url).search), opts.tokenPath), 401);
      }
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  };
}
