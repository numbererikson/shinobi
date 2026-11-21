import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  consumeAuthorizationCode,
  countClients,
  createAuthorizationCode,
  deleteClient,
  getClient,
  issueTokens,
  listApprovedClients,
  MAX_CLIENTS,
  registerClient,
  rotateRefreshToken,
} from '../models/oauth.js';
import { authRateLimiter } from '../lib/rate-limit.js';

/**
 * OAuth 2.1 authorization server for the remote /mcp endpoint, following the
 * MCP authorization spec: protected-resource + authorization-server metadata,
 * dynamic client registration, authorization code + PKCE (S256), refresh
 * token rotation. The owner approves a client once in the browser by proving
 * they hold the dashboard token, so nothing new has to be configured.
 */

export const OAUTH_OPEN_PREFIXES = ['/.well-known/oauth-', '/oauth/'];
const COOKIE_NAME = 'shinobi_token';

export function isOAuthOpenPath(path: string): boolean {
  return OAUTH_OPEN_PREFIXES.some((p) => path.startsWith(p));
}

/** Public origin as the client sees it (tunnels set X-Forwarded-*), or SHINOBI_PUBLIC_URL. */
export function publicBaseUrl(c: Context): string {
  const override = (process.env['SHINOBI_PUBLIC_URL'] ?? '').trim().replace(/\/+$/, '');
  if (override) return override;
  const url = new URL(c.req.url);
  const proto = (c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')).split(',')[0]!.trim();
  const host = (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host).split(',')[0]!.trim();
  return `${proto}://${host}`;
}

export function resourceMetadataUrl(c: Context): string {
  return `${publicBaseUrl(c)}/.well-known/oauth-protected-resource`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function esc(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Redirect URIs must be https, or http on a loopback host (desktop clients). */
export function isAcceptableRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  response_type: string;
}

function csrfFor(dashboardToken: string, p: AuthorizeParams): string {
  return createHmac('sha256', dashboardToken)
    .update([p.client_id, p.redirect_uri, p.code_challenge, p.state].join('\n'))
    .digest('base64url');
}

function redirectWith(c: Context, redirectUri: string, params: Record<string, string>): Response {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return c.redirect(u.toString(), 302);
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0f1216;color:#d8dee9;display:flex;justify-content:center;padding:24px">
<main style="max-width:440px;width:100%;background:#161b22;border:1px solid #2a313c;border-radius:8px;padding:24px">
<h2 style="margin-top:0;color:#eceff4">🥷 ${esc(title)}</h2>
${body}
</main></body></html>`;
}

function errorPage(c: Context, message: string, status: 400 | 401 = 400): Response {
  return c.html(page('Shinobi — cannot connect', `<p>${esc(message)}</p>`), status);
}

/** Validate the request parts that decide where we may redirect. Errors here must NOT redirect. */
function resolveClient(p: Partial<AuthorizeParams>): { ok: true; redirectUri: string; clientName: string } | { ok: false; error: string } {
  if (!p.client_id) return { ok: false, error: 'Missing client_id.' };
  const client = getClient(p.client_id);
  if (!client) return { ok: false, error: 'Unknown client. Remove the connector and add it again.' };
  let redirectUri = p.redirect_uri ?? '';
  if (!redirectUri) {
    if (client.redirect_uris.length !== 1) return { ok: false, error: 'Missing redirect_uri.' };
    redirectUri = client.redirect_uris[0]!;
  }
  if (!client.redirect_uris.includes(redirectUri)) return { ok: false, error: 'redirect_uri is not registered for this client.' };
  return { ok: true, redirectUri, clientName: client.client_name || 'An MCP client' };
}

function readParams(src: Record<string, unknown>): AuthorizeParams {
  const s = (k: string) => (typeof src[k] === 'string' ? (src[k] as string) : '');
  return {
    client_id: s('client_id'),
    redirect_uri: s('redirect_uri'),
    code_challenge: s('code_challenge'),
    code_challenge_method: s('code_challenge_method'),
    state: s('state'),
    response_type: s('response_type'),
  };
}

function consentPage(c: Context, p: AuthorizeParams, clientName: string, redirectUri: string, dashboardToken: string, error?: string): Response {
  const loggedIn = (() => {
    const cookie = getCookie(c, COOKIE_NAME);
    return Boolean(cookie && safeEqual(cookie, dashboardToken));
  })();
  const hidden = (['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'response_type'] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`)
    .join('');
  const csrf = loggedIn ? `<input type="hidden" name="csrf" value="${esc(csrfFor(dashboardToken, p))}">` : '';
  const tokenField = loggedIn
    ? '<p style="color:#a3be8c">You are signed in to this Shinobi.</p>'
    : `<label style="display:block;margin:12px 0 4px">Dashboard token</label>
<input name="token" type="password" autocomplete="current-password" required
 style="width:100%;box-sizing:border-box;padding:8px;background:#0f1216;color:#d8dee9;border:1px solid #3b4252;border-radius:4px">
<p style="font-size:12px;color:#6b7785">The same token you open the dashboard with. It is checked here and never sent to the app.</p>`;
  const host = (() => {
    try {
      return new URL(redirectUri).host;
    } catch {
      return redirectUri;
    }
  })();
  const btn = 'padding:8px 14px;border-radius:4px;border:1px solid;cursor:pointer;font-weight:600';
  return c.html(
    page(
      'Connect to Shinobi',
      `<p><strong>${esc(clientName)}</strong> (${esc(host)}) wants to use your Shinobi: projects, notes, plugins and everything else the MCP tools can do.</p>
${error ? `<p style="color:#bf616a">${esc(error)}</p>` : ''}
<form method="post" action="/oauth/authorize">${hidden}${csrf}${tokenField}
<div style="display:flex;gap:8px;margin-top:16px">
<button name="action" value="approve" style="${btn};background:#5e81ac;border-color:#5e81ac;color:#fff">Allow</button>
<button name="action" value="deny" formnovalidate style="${btn};background:transparent;border-color:#3b4252;color:#d8dee9">Deny</button>
</div></form>`,
    ),
    error ? 401 : 200,
  );
}

export function registerOAuthRoutes(app: Hono, opts: { dashboardToken: string }): void {
  const limiter = authRateLimiter();

  const protectedResource = (c: Context) => {
    const base = publicBaseUrl(c);
    return c.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      resource_name: 'Shinobi',
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/*', protectedResource);

  const authServer = (c: Context) => {
    const base = publicBaseUrl(c);
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  };
  app.get('/.well-known/oauth-authorization-server', authServer);
  app.get('/.well-known/oauth-authorization-server/*', authServer);

  // RFC 7591 dynamic client registration (public clients, PKCE only).
  app.post('/oauth/register', limiter.middleware, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid_client_metadata', error_description: 'JSON body required' }, 400);
    }
    const uris = Array.isArray(body['redirect_uris']) ? body['redirect_uris'].filter((u): u is string => typeof u === 'string') : [];
    if (uris.length === 0 || uris.length > 10 || !uris.every(isAcceptableRedirectUri)) {
      return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be 1-10 https (or loopback http) URLs' }, 400);
    }
    if (countClients() >= MAX_CLIENTS) {
      return c.json({ error: 'invalid_client_metadata', error_description: 'too many registered clients; revoke some in the dashboard' }, 400);
    }
    const name = typeof body['client_name'] === 'string' ? body['client_name'].slice(0, 100) : null;
    const client = registerClient({ client_name: name, redirect_uris: uris });
    return c.json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
    );
  });

  app.get('/oauth/authorize', (c) => {
    const p = readParams(c.req.query());
    const resolved = resolveClient(p);
    if (!resolved.ok) return errorPage(c, resolved.error);
    p.redirect_uri = resolved.redirectUri;
    if (p.response_type !== 'code') return redirectWith(c, p.redirect_uri, { error: 'unsupported_response_type', state: p.state });
    if (!p.code_challenge || p.code_challenge_method !== 'S256') {
      return redirectWith(c, p.redirect_uri, { error: 'invalid_request', error_description: 'PKCE with S256 is required', state: p.state });
    }
    return consentPage(c, p, resolved.clientName, p.redirect_uri, opts.dashboardToken);
  });

  app.post('/oauth/authorize', limiter.middleware, async (c) => {
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const p = readParams(form);
    const resolved = resolveClient(p);
    if (!resolved.ok) return errorPage(c, resolved.error);
    p.redirect_uri = resolved.redirectUri;
    if (p.response_type !== 'code' || !p.code_challenge || p.code_challenge_method !== 'S256') {
      return redirectWith(c, p.redirect_uri, { error: 'invalid_request', state: p.state });
    }
    if (form['action'] === 'deny') return redirectWith(c, p.redirect_uri, { error: 'access_denied', state: p.state });

    const typed = typeof form['token'] === 'string' ? form['token'].trim() : '';
    const cookie = getCookie(c, COOKIE_NAME);
    const csrf = typeof form['csrf'] === 'string' ? form['csrf'] : '';
    const byToken = typed.length > 0 && safeEqual(typed, opts.dashboardToken);
    const byCookie = Boolean(cookie && safeEqual(cookie, opts.dashboardToken) && csrf && safeEqual(csrf, csrfFor(opts.dashboardToken, p)));
    if (!byToken && !byCookie) {
      return consentPage(c, p, resolved.clientName, p.redirect_uri, opts.dashboardToken, 'That is not the dashboard token.');
    }
    const code = createAuthorizationCode({ client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge });
    return redirectWith(c, p.redirect_uri, { code, state: p.state });
  });

  app.post('/oauth/token', limiter.middleware, async (c) => {
    c.header('Cache-Control', 'no-store');
    const ct = c.req.header('content-type') ?? '';
    let body: Record<string, unknown>;
    try {
      body = ct.includes('application/json') ? ((await c.req.json()) as Record<string, unknown>) : ((await c.req.parseBody()) as Record<string, unknown>);
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
    const clientId = s('client_id');
    if (!clientId || !getClient(clientId)) return c.json({ error: 'invalid_client' }, 401);

    if (s('grant_type') === 'authorization_code') {
      const code = consumeAuthorizationCode(s('code'));
      if (!code || code.client_id !== clientId) return c.json({ error: 'invalid_grant', error_description: 'unknown, used or expired code' }, 400);
      if (s('redirect_uri') && s('redirect_uri') !== code.redirect_uri) return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
      const verifier = s('code_verifier');
      if (!verifier || !safeEqual(pkceChallenge(verifier), code.code_challenge)) {
        return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      }
      return c.json({ ...issueTokens(clientId), token_type: 'Bearer', scope: 'mcp' });
    }
    if (s('grant_type') === 'refresh_token') {
      const tokens = rotateRefreshToken(s('refresh_token'), clientId);
      if (!tokens) return c.json({ error: 'invalid_grant', error_description: 'unknown, used or expired refresh token' }, 400);
      return c.json({ ...tokens, token_type: 'Bearer', scope: 'mcp' });
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // Dashboard (behind normal auth): connected apps + revoke.
  app.get('/api/oauth/clients', (c) =>
    c.json({
      clients: listApprovedClients().map((cl) => ({
        client_id: cl.client_id,
        client_name: cl.client_name,
        redirect_hosts: cl.redirect_uris.map((u) => {
          try {
            return new URL(u).host;
          } catch {
            return u;
          }
        }),
        approved_at: cl.approved_at,
        last_used_at: cl.last_used_at,
      })),
    }),
  );
  app.delete('/api/oauth/clients/:id', (c) => c.json({ deleted: deleteClient(c.req.param('id')) }));
}
