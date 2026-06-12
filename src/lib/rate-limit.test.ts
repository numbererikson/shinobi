import { describe, expect, it } from 'vitest';
import { clientKey, createRateLimiter } from './rate-limit.js';

describe('createRateLimiter', () => {
  it('allows up to max within a window, then blocks', () => {
    let t = 0;
    const limiter = createRateLimiter({ name: 't', windowMs: 1000, max: 3, now: () => t });
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(false);
  });

  it('resets after the window elapses', () => {
    let t = 0;
    const limiter = createRateLimiter({ name: 't', windowMs: 1000, max: 1, now: () => t });
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('a')).toBe(false);
    t = 1000;
    expect(limiter.consume('a')).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ name: 't', windowMs: 1000, max: 1, now: () => 0 });
    expect(limiter.consume('a')).toBe(true);
    expect(limiter.consume('b')).toBe(true);
    expect(limiter.consume('a')).toBe(false);
  });
});

describe('clientKey', () => {
  it('prefers cf-connecting-ip, then first x-forwarded-for hop, then local', () => {
    expect(clientKey(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
    expect(clientKey(new Headers({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe('5.6.7.8');
    expect(clientKey(new Headers())).toBe('local');
  });
});
