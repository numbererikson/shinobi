import { describe, expect, it } from 'vitest';

import { assertTimeZone, parseCron } from './cron.js';

// Local-time dates: 2026-11-23 is a Monday, 2026-11-21 a Saturday, 2026-11-22 a Sunday.
const at = (day: number, hour: number, minute: number): Date => new Date(2026, 10, day, hour, minute);

describe('parseCron', () => {
  it('handles steps', () => {
    const m = parseCron('*/15 * * * *');
    expect(m.matches(at(23, 10, 0))).toBe(true);
    expect(m.matches(at(23, 10, 45))).toBe(true);
    expect(m.matches(at(23, 10, 7))).toBe(false);
  });

  it('handles ranges on weekdays', () => {
    const m = parseCron('30 8 * * 1-5');
    expect(m.matches(at(23, 8, 30))).toBe(true);
    expect(m.matches(at(21, 8, 30))).toBe(false);
    expect(m.matches(at(23, 9, 30))).toBe(false);
  });

  it('treats 7 as Sunday', () => {
    expect(parseCron('0 18 * * 7').matches(at(22, 18, 0))).toBe(true);
    expect(parseCron('0 18 * * 0').matches(at(22, 18, 0))).toBe(true);
  });

  it('matches day-of-month OR day-of-week when both are restricted', () => {
    const m = parseCron('0 0 1 * 1');
    expect(m.matches(new Date(2026, 11, 1, 0, 0))).toBe(true); // 1 Dec 2026, a Tuesday
    expect(m.matches(at(23, 0, 0))).toBe(true); // a Monday
    expect(m.matches(at(21, 0, 0))).toBe(false);
  });

  it('handles lists and normalizes whitespace', () => {
    const m = parseCron('  0,30   9,17 * * * ');
    expect(m.expression).toBe('0,30 9,17 * * *');
    expect(m.matches(at(21, 17, 30))).toBe(true);
    expect(m.matches(at(21, 12, 30))).toBe(false);
  });

  it('matches in a given time zone', () => {
    const m = parseCron('0 8 * * *');
    // Zagreb is UTC+1 in November.
    expect(m.matches(new Date('2026-11-21T07:00:00Z'), 'Europe/Zagreb')).toBe(true);
    expect(m.matches(new Date('2026-11-21T08:00:00Z'), 'Europe/Zagreb')).toBe(false);
  });

  it('rejects malformed expressions', () => {
    expect(() => parseCron('* * * *')).toThrow(/5 fields/);
    expect(() => parseCron('60 * * * *')).toThrow(/out of range/);
    expect(() => parseCron('* 5-2 * * *')).toThrow(/reversed/);
    expect(() => parseCron('*/0 * * * *')).toThrow(/out of range/);
    expect(() => parseCron('a * * * *')).toThrow(/invalid minute/);
  });
});

describe('assertTimeZone', () => {
  it('accepts IANA zones and rejects unknown ones', () => {
    expect(() => assertTimeZone('Europe/Zagreb')).not.toThrow();
    expect(() => assertTimeZone('Mars/Olympus')).toThrow(/unknown time zone/);
  });
});
