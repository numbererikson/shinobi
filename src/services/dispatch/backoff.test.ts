import { describe, expect, it } from 'vitest';
import {
  BLOCKED_BACKOFF_MS,
  DEFAULT_MAX_FAILURES,
  blockedBackoffMs,
  shouldHaltOnBlocked,
} from './backoff.js';

describe('shouldHaltOnBlocked', () => {
  it('halts once consecutive blocks reach the cap', () => {
    expect(shouldHaltOnBlocked(2, 3)).toBe(false);
    expect(shouldHaltOnBlocked(3, 3)).toBe(true);
    expect(shouldHaltOnBlocked(4, 3)).toBe(true);
  });

  it('treats maxFailures <= 0 as unlimited (opt-out)', () => {
    expect(shouldHaltOnBlocked(100, 0)).toBe(false);
    expect(shouldHaltOnBlocked(100, -1)).toBe(false);
  });

  it('uses a sane default cap', () => {
    expect(shouldHaltOnBlocked(DEFAULT_MAX_FAILURES, DEFAULT_MAX_FAILURES)).toBe(true);
    expect(shouldHaltOnBlocked(DEFAULT_MAX_FAILURES - 1, DEFAULT_MAX_FAILURES)).toBe(false);
  });
});

describe('blockedBackoffMs', () => {
  it('escalates linearly with consecutive blocks', () => {
    expect(blockedBackoffMs(1, 30_000)).toBe(BLOCKED_BACKOFF_MS);
    expect(blockedBackoffMs(2, 30_000)).toBe(BLOCKED_BACKOFF_MS * 2);
    expect(blockedBackoffMs(3, 30_000)).toBe(BLOCKED_BACKOFF_MS * 3);
  });

  it('never sleeps longer than the poll interval', () => {
    expect(blockedBackoffMs(100, 5_000)).toBe(5_000);
  });

  it('always backs off at least the base, even at count 0', () => {
    expect(blockedBackoffMs(0, 30_000)).toBe(BLOCKED_BACKOFF_MS);
  });
});
