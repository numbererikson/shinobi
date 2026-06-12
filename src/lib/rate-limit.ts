import type { MiddlewareHandler } from 'hono';

/**
 * In-memory sliding-window rate limiter for the public-facing routes.
 * Single-process by design — matches the single-container deployment. If the
 * server ever runs replicated, swap the store, not the call sites.
 */

interface WindowState {
  count: number;
  windowStartMs: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Label used in the 429 body and log line. */
  name: string;
  now?: () => number;
}

export interface RateLimiter {
  /** Returns true when the key is within its budget (and consumes one unit). */
  consume(key: string): boolean;
  middleware: MiddlewareHandler;
}

const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, WindowState>();

  function consume(key: string): boolean {
    const ts = now();
    const state = windows.get(key);
    if (!state || ts - state.windowStartMs >= options.windowMs) {
      // Opportunistic GC so abandoned keys can't grow the map unbounded.
      if (windows.size >= MAX_TRACKED_KEYS) {
        for (const [k, v] of windows) {
          if (ts - v.windowStartMs >= options.windowMs) windows.delete(k);
        }
      }
      windows.set(key, { count: 1, windowStartMs: ts });
      return true;
    }
    if (state.count >= options.max) return false;
    state.count += 1;
    return true;
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    const key = clientKey(c.req.raw.headers);
    if (!consume(key)) {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        { ok: false, error: `rate limit exceeded for ${options.name}; retry after ${retryAfter}s` },
        429,
      );
    }
    return next();
  };

  return { consume, middleware };
}

/**
 * Behind the Cloudflare Tunnel every TCP connection originates from the local
 * cloudflared daemon, so the remote address is useless — trust the standard
 * forwarding headers first and fall back to a shared bucket.
 */
export function clientKey(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'local';
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** /mcp tool calls: generous — agents burst, but a runaway loop gets cut. */
export function mcpRateLimiter(): RateLimiter {
  return createRateLimiter({
    name: '/mcp',
    windowMs: 60_000,
    max: envInt('SHINOBI_MCP_RATE_LIMIT', 240),
  });
}

/** Auth endpoints: strict — token guessing and magic-link spam. */
export function authRateLimiter(): RateLimiter {
  return createRateLimiter({
    name: 'auth',
    windowMs: 60_000,
    max: envInt('SHINOBI_AUTH_RATE_LIMIT', 10),
  });
}
