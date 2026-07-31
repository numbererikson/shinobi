import type { Locale, Register } from './types.js';

/**
 * What she says, per trigger. Multiple variants exist so a repeated situation
 * doesn't produce a repeated sentence — the reactor avoids recently used ones.
 *
 * Placeholders: {task} {next} {n} {hours} {count}
 */
export interface LineSet {
  register: Register;
  lines: string[];
  /** Optional follow-up half, shown under the main line. */
  details?: string[];
}

export type Catalog = Record<string, LineSet>;

const EN: Catalog = {
  task_completed: {
    register: 'business',
    lines: [
      'Done, boss. {task} is closed.',
      '{task} — closed.',
      'That is {task} off the board.',
    ],
    details: ['Next up: {next}.', 'Next in the queue: {next}.'],
  },
  streak: {
    register: 'cheer',
    lines: [
      '{n} in a row, nothing blocked. You are on a run.',
      'Third one clean. Today is going your way.',
      '{n} straight without a block — that is a good afternoon.',
    ],
    details: ['Next up: {next}.'],
  },
  blocked: {
    register: 'caution',
    lines: [
      '{task} came back blocked. Worth a look before you queue it again.',
      'Blocked: {task}. I put it back in the queue.',
    ],
  },
  blocked_repeat: {
    register: 'dry',
    lines: [
      'Second time on {task}. Maybe the problem is not the code.',
      '{task} again. That is {count} now — something upstream is wrong.',
      'Same task, same wall. {count} attempts.',
    ],
  },
  dead_end: {
    register: 'caution',
    lines: [
      'Logged. That one is on the record now, so it will surface next time.',
      'Dead end saved — future you gets a warning instead of an afternoon.',
    ],
  },
  approvals: {
    register: 'nag',
    lines: [
      '{count} approval waiting on you.',
      '{count} approvals are sitting there unanswered.',
    ],
  },
  stale_session: {
    register: 'nag',
    lines: [
      '{hours} hours in, nothing written down. Tomorrow you will not remember any of it.',
      '{hours} hours without a closeout. Want me to wrap it up?',
    ],
  },
  decision: {
    register: 'business',
    lines: ['Decision recorded.', 'Noted — that one is on the record.'],
  },
  plan: {
    register: 'business',
    lines: ['Plan saved.', 'New plan version stored.'],
  },
  task_created: {
    register: 'business',
    lines: ['Added to the queue.', 'On the board.'],
  },
  findings: {
    register: 'business',
    lines: ['Findings ingested — the queue just grew.'],
  },
};

const HR: Catalog = {
  task_completed: {
    register: 'business',
    lines: [
      'Gotovo, šefe. {task} je zatvoren.',
      '{task} — zatvoreno.',
      'Skinula sam {task} s ploče.',
    ],
    details: ['Sljedeći je: {next}.', 'Sljedeće u redu: {next}.'],
  },
  streak: {
    register: 'cheer',
    lines: [
      '{n} zaredom, ništa blokirano. Danas si u gasu.',
      'Treći čist. Ide ti.',
      '{n} bez ijedne blokade — to je dobro poslijepodne.',
    ],
    details: ['Sljedeći je: {next}.'],
  },
  blocked: {
    register: 'caution',
    lines: [
      '{task} se vratio blokiran. Pogledaj prije nego ga opet pustiš.',
      'Blokirano: {task}. Vratila sam ga u red.',
    ],
  },
  blocked_repeat: {
    register: 'dry',
    lines: [
      'Drugi put na {task}. Možda problem nije u kodu.',
      'Opet {task}. To je {count} pokušaja — nešto ranije u lancu ne štima.',
      'Isti task, isti zid. {count} pokušaja.',
    ],
  },
  dead_end: {
    register: 'caution',
    lines: [
      'Zapisano. Sad je na papiru, pa će iskočiti sljedeći put.',
      'Slijepa ulica spremljena — budući ti dobiva upozorenje umjesto izgubljenog popodneva.',
    ],
  },
  approvals: {
    register: 'nag',
    lines: [
      '{count} odobrenje čeka tebe.',
      '{count} odobrenja stoje neodgovorena.',
    ],
  },
  stale_session: {
    register: 'nag',
    lines: [
      '{hours} sata rada, ništa zabilježeno. Ujutro se nećeš sjećati ničega.',
      '{hours} sata bez closeouta. Da ti zaključim sesiju?',
    ],
  },
  decision: {
    register: 'business',
    lines: ['Odluka zabilježena.', 'Zapisano — to je sad na papiru.'],
  },
  plan: {
    register: 'business',
    lines: ['Plan spremljen.', 'Nova verzija plana pohranjena.'],
  },
  task_created: {
    register: 'business',
    lines: ['Dodano u red.', 'Na ploči je.'],
  },
  findings: {
    register: 'business',
    lines: ['Nalazi uneseni — red je upravo narastao.'],
  },
};

const CATALOGS: Record<Locale, Catalog> = { en: EN, hr: HR };

export function catalogFor(locale: Locale): Catalog {
  return CATALOGS[locale] ?? EN;
}

/** Replace {placeholders} with values; unknown placeholders are left alone. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

/**
 * Pick a variant that hasn't been used recently. Falls back to the first one
 * when every variant is in the recent list (rather than staying silent).
 */
export function pickVariant(
  variants: string[],
  recent: string[],
  random: () => number,
): string {
  if (variants.length === 0) return '';
  const fresh = variants.filter((v) => !recent.includes(v));
  const pool = fresh.length > 0 ? fresh : variants;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}
