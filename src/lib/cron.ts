/**
 * Minimal 5-field cron matcher: `minute hour day-of-month month day-of-week`.
 *
 * Each field accepts `*`, a number, a range `a-b`, a step `* /n` or `a-b/n`,
 * and comma lists of those. Day-of-week is 0-7 with both 0 and 7 meaning
 * Sunday. As in standard cron, when both day-of-month and day-of-week are
 * restricted, a time matches if EITHER matches.
 *
 * Matching happens in an optional IANA time zone so "0 8 * * *" means 08:00
 * where the owner lives, even when the host (e.g. a Docker container) runs UTC.
 */

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
];

export interface CronMatcher {
  /** The normalized expression (single spaces). */
  expression: string;
  matches(date: Date, timeZone?: string): boolean;
}

function parseNumber(raw: string, spec: FieldSpec, expr: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`cron '${expr}': invalid ${spec.name} value '${raw}'`);
  const n = Number(raw);
  if (n < spec.min || n > spec.max) {
    throw new Error(`cron '${expr}': ${spec.name} ${n} out of range ${spec.min}-${spec.max}`);
  }
  return n;
}

function parseField(raw: string, spec: FieldSpec, expr: string): { values: Set<number>; star: boolean } {
  const values = new Set<number>();
  let star = false;
  for (const part of raw.split(',')) {
    const [rangePart, stepPart, extra] = part.split('/');
    if (rangePart === undefined || rangePart === '' || extra !== undefined) {
      throw new Error(`cron '${expr}': invalid ${spec.name} '${part}'`);
    }
    const step = stepPart === undefined ? 1 : parseNumber(stepPart, { ...spec, min: 1 }, expr);
    let from: number;
    let to: number;
    if (rangePart === '*') {
      from = spec.min;
      to = spec.max;
      if (stepPart === undefined) star = true;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      from = parseNumber(a ?? '', spec, expr);
      to = parseNumber(b ?? '', spec, expr);
      if (from > to) throw new Error(`cron '${expr}': ${spec.name} range ${rangePart} is reversed`);
    } else {
      from = parseNumber(rangePart, spec, expr);
      to = stepPart === undefined ? from : spec.max;
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { values, star };
}

interface ZonedParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(date: Date, timeZone?: string): ZonedParts {
  if (!timeZone) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')),
    day: Number(get('day')),
    month: Number(get('month')),
    weekday: WEEKDAYS[get('weekday')] ?? -1,
  };
}

/** Throws when `timeZone` is not a valid IANA zone name. */
export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`unknown time zone '${timeZone}'`);
  }
}

export function parseCron(expression: string): CronMatcher {
  const expr = expression.trim().replace(/\s+/g, ' ');
  const raw = expr.split(' ');
  if (raw.length !== 5) throw new Error(`cron '${expression}': expected 5 fields, got ${raw.length}`);
  const [minute, hour, dom, month, dow] = raw.map((r, i) => parseField(r, FIELDS[i]!, expr));
  // 7 and 0 are both Sunday.
  if (dow!.values.has(7)) dow!.values.add(0);

  return {
    expression: expr,
    matches(date: Date, timeZone?: string): boolean {
      const p = zonedParts(date, timeZone);
      if (!minute!.values.has(p.minute) || !hour!.values.has(p.hour) || !month!.values.has(p.month)) return false;
      const domOk = dom!.values.has(p.day);
      const dowOk = dow!.values.has(p.weekday);
      if (dom!.star || dow!.star) return domOk && dowOk;
      return domOk || dowOk;
    },
  };
}
