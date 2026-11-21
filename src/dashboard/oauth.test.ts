import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../lib/migrations.js';
import { closeDb } from '../lib/db.js';
import { buildApp } from './server.js';
import { consumeAuthorizationCode, createAuthorizationCode, registerClient, verifyAccessToken } from '../models/oauth.js';

const TOKEN = 'oauth-test-dashboard-token-0123456789abcdef';
const BASE = 'https://shinobi.example.com';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let tmp: string;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-oauth-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  process.env.SHINOBI_AUTH_RATE_LIMIT = '1000';
  process.env.SHINOBI_PUBLIC_URL = BASE;
  applyPendingMigrations();
  app = buildApp({ enabled: true, token: TOKEN }, { mcp: true });
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.SHINOBI_PUBLIC_URL;
  delete process.env.SHINOBI_AUTH_RATE_LIMIT;
});

const req = (path: string, init?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init));
const form = (data: Record<string, string>, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(data).toString(),
});

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function register(): Promise<string> {
  const res = await req('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function authorize(clientId: string, challenge: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return req(
    '/oauth/authorize',
    form(
      {
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'st4te',
        action: 'approve',
        ...extra,
      },
      headers,
    ),
  );
}

describe('discovery', () => {
  it('unauthenticated /mcp answers 401 with a pointer to the resource metadata', async () => {
    const res = await req('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
  });

  it('/mcp/home points at its own path-suffixed resource metadata', async () => {
    const res = await req('/mcp/home', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp/home"`);
    const meta = (await (await req('/.well-known/oauth-protected-resource/mcp/home')).json()) as Record<string, unknown>;
    expect(meta).toMatchObject({ resource: `${BASE}/mcp/home`, authorization_servers: [BASE] });
  });

  it('serves protected-resource and authorization-server metadata without auth', async () => {
    const pr = (await (await req('/.well-known/oauth-protected-resource')).json()) as Record<string, unknown>;
    expect(pr).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    const pr2 = await req('/.well-known/oauth-protected-resource/mcp');
    expect(pr2.status).toBe(200);
    const as = (await (await req('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('registration rejects non-https redirect URIs', async () => {
    const res = await req('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('authorization code flow', () => {
  it('approve with the dashboard token → code → tokens → /mcp works → refresh rotates', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();

    const consent = await req(
      `/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'st4te' })}`,
      { headers: { Accept: 'text/html' } },
    );
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain('Claude');
    expect(html).toContain('claude.ai');
    expect(html).toContain('name="token"');

    const wrong = await authorize(clientId, challenge, { token: 'nope' });
    expect(wrong.status).toBe(401);

    const ok = await authorize(clientId, challenge, { token: TOKEN });
    expect(ok.status).toBe(302);
    const loc = new URL(ok.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT);
    expect(loc.searchParams.get('state')).toBe('st4te');
    const code = loc.searchParams.get('code')!;

    const bad = await req('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: 'wrong-verifier' }));
    expect(bad.status).toBe(400);
    // The failed attempt spent the code (one-time use).
    const reused = await req('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }));
    expect(reused.status).toBe(400);

    const ok2 = await authorize(clientId, challenge, { token: TOKEN });
    const code2 = new URL(ok2.headers.get('location')!).searchParams.get('code')!;
    const tokRes = await req('/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }));
    expect(tokRes.status).toBe(200);
    expect(tokRes.headers.get('cache-control')).toBe('no-store');
    const tokens = (await tokRes.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(3600);

    // GET /mcp is a 405 for authorised callers, so it proves the token passed auth.
    const mcp = await req('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(mcp.status).toBe(405);
    const home = await req('/mcp/home', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(home.status).toBe(405);
    // OAuth tokens are for /mcp only, not the dashboard API.
    const api = await req('/api/projects', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(api.status).toBe(401);

    const refreshed = await req('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(refreshed.status).toBe(200);
    const again = await req('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(again.status).toBe(400);

    // Revoking the app from the dashboard kills its tokens.
    const list = (await (await req('/api/oauth/clients', { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as { clients: { client_id: string; redirect_hosts: string[] }[] };
    expect(list.clients.map((c) => c.client_id)).toContain(clientId);
    expect(list.clients.find((c) => c.client_id === clientId)!.redirect_hosts).toEqual(['claude.ai']);
    const del = await req(`/api/oauth/clients/${clientId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(((await del.json()) as { deleted: boolean }).deleted).toBe(true);
    const afterRevoke = await req('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(afterRevoke.status).toBe(401);
  });

  it('cookie sign-in needs the CSRF value from the consent page', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const cookie = { Cookie: `shinobi_token=${TOKEN}` };
    const forged = await authorize(clientId, challenge, {}, cookie);
    expect(forged.status).toBe(401);

    const consent = await req(
      `/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'st4te' })}`,
      { headers: cookie },
    );
    const html = await consent.text();
    expect(html).not.toContain('name="token"');
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const ok = await authorize(clientId, challenge, { csrf }, cookie);
    expect(ok.status).toBe(302);
    expect(new URL(ok.headers.get('location')!).searchParams.get('code')).toBeTruthy();
  });

  it('deny redirects with access_denied; bad redirect_uri or client never redirects', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const deny = await authorize(clientId, challenge, { action: 'deny' });
    expect(deny.status).toBe(302);
    expect(new URL(deny.headers.get('location')!).searchParams.get('error')).toBe('access_denied');

    const badRedirect = await authorize(clientId, challenge, { token: TOKEN, redirect_uri: 'https://evil.example.com/cb' });
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.headers.get('location')).toBeNull();

    const badClient = await authorize('nope', challenge, { token: TOKEN });
    expect(badClient.status).toBe(400);

    const noPkce = await req(`/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', state: 's' })}`);
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });
});

describe('model', () => {
  it('codes expire and tokens are stored only as hashes', () => {
    const client = registerClient({ client_name: 'x', redirect_uris: [REDIRECT] });
    const code = createAuthorizationCode({ client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: 'c' }, Date.now() - 60 * 60 * 1000);
    expect(consumeAuthorizationCode(code)).toBeNull();
    expect(verifyAccessToken('shinobi_at_not-a-real-token')).toBeNull();
    expect(verifyAccessToken(TOKEN)).toBeNull();
  });
});
