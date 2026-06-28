import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../../lib/migrations.js';
import { closeDb, getDb } from '../../lib/db.js';
import { createInProcessRegistry } from '../../services/plugins/registry.js';
import { register } from './index.js';
import {
  enabledWorkoutFamilies,
  painLevel,
  phaseForDay,
  selectWorkoutId,
  todayRestrictions,
  workoutStreakDays,
} from './rules.js';
import type {
  CreateFitnessOutput,
  FitnessMission,
  LogPainOutput,
  SetEquipmentOutput,
  StatusOutput,
  TodayOutput,
} from './types.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shinobi-fitness-'));
  process.env.SHINOBI_DB_PATH = join(tmp, 'test.db');
  applyPendingMigrations();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM plugin_state WHERE plugin = 'fitness'").run();
});

function mount() {
  const { registry, call } = createInProcessRegistry('fitness');
  register(registry);
  return call;
}

describe('rules', () => {
  it('maps mission day to phase at the SPEC boundaries', () => {
    expect(phaseForDay(1).name).toBe('foundation');
    expect(phaseForDay(30).name).toBe('foundation');
    expect(phaseForDay(31).name).toBe('base_strength');
    expect(phaseForDay(76).name).toBe('progressive_strength');
    expect(phaseForDay(136).name).toBe('definition');
  });

  it('grades pain into normal/caution/avoid', () => {
    expect(painLevel(1)).toBe('normal');
    expect(painLevel(3)).toBe('caution');
    expect(painLevel(7)).toBe('avoid');
  });

  it('emits a graded shoulder restriction with the right message code', () => {
    expect(todayRestrictions({ shoulder: { status: 'watch', lastPain: 2 } })[0]).toMatchObject({
      level: 'watch',
      messageCode: 'NO_HEAVY_OVERHEAD_PRESSING',
    });
    expect(todayRestrictions({ shoulder: { status: 'avoid', lastPain: 6 } })[0]).toMatchObject({
      level: 'avoid',
      messageCode: 'SHOULDER_PAIN_HIGH',
    });
  });

  it('unlocks dumbbell families only when bench+dumbbells are present', () => {
    expect(enabledWorkoutFamilies('bench')).not.toContain('phase2_bench_dumbbell');
    expect(enabledWorkoutFamilies('bench_dumbbells')).toContain('phase2_bench_dumbbell');
    expect(enabledWorkoutFamilies('pullup_bar_bench_dumbbells')).toContain('phase2_pullup_dumbbell');
  });

  it('swaps a push day for legs/core under high shoulder pain', () => {
    const mission = { history: [], equipment: { level: 'none' } } as unknown as FitnessMission;
    const restrictions = todayRestrictions({ shoulder: { status: 'avoid', lastPain: 6 } });
    expect(selectWorkoutId(mission, { number: 1, name: 'foundation', startedAt: 'x' }, restrictions)).toBe(
      'phase1_legs_core',
    );
  });

  it('counts a trailing workout streak ending today', () => {
    const mission = {
      history: [
        { completed: true, date: '2026-06-26' },
        { completed: true, date: '2026-06-27' },
        { completed: true, date: '2026-06-28' },
      ],
    } as unknown as FitnessMission;
    expect(workoutStreakDays(mission, '2026-06-28')).toBe(3);
    expect(workoutStreakDays(mission, '2026-06-30')).toBe(0); // gap breaks it
  });
});

describe('plugin demo flow (SPEC §10)', () => {
  it('create → today → log pain → today → set equipment → status', async () => {
    const call = mount();

    const created = (await call('plugin_fitness_create', {
      goal: 'visible_abs',
      smokeFreeSince: '2026-06-01',
      alcoholFreeSince: '2026-06-01',
      restrictions: { shoulder: { side: 'right', status: 'watch', lastPain: 2 } },
    })) as CreateFitnessOutput;
    expect(created.created).toBe(true);
    expect(created.mission.type).toBe('fitness_180');

    const day1 = (await call('plugin_fitness_today')) as TodayOutput;
    expect(day1.exists).toBe(true);
    expect(day1.phase?.name).toBe('foundation');
    expect(day1.workoutId).toBe('phase1_fullbody_a');
    expect(day1.restrictions?.[0]?.messageCode).toBe('NO_HEAVY_OVERHEAD_PRESSING');
    expect(day1.streaks?.smokeFreeDays).toBeGreaterThan(0);

    const pain = (await call('plugin_fitness_log_pain', {
      area: 'shoulder',
      side: 'right',
      value: 5,
    })) as LogPainOutput;
    expect(pain.restrictionLevel).toBe('avoid');

    const afterPain = (await call('plugin_fitness_today')) as TodayOutput;
    expect(afterPain.workoutId).toBe('phase1_legs_core');
    expect(afterPain.restrictions?.[0]?.messageCode).toBe('SHOULDER_PAIN_HIGH');

    const equip = (await call('plugin_fitness_set_equipment', {
      level: 'bench_dumbbells',
    })) as SetEquipmentOutput;
    expect(equip.enabledWorkoutFamilies).toContain('phase2_bench_dumbbell');

    const status = (await call('plugin_fitness_status')) as StatusOutput;
    expect(status.exists).toBe(true);
    expect(status.summary?.smokeFreeDays).toBeGreaterThan(0);
    expect(status.summary?.activeRestrictions[0]?.messageCode).toBe('SHOULDER_PAIN_HIGH');
  });

  it('returns a safe fallback when no mission exists', async () => {
    const call = mount();
    const today = (await call('plugin_fitness_today')) as TodayOutput;
    expect(today.exists).toBe(false);
    expect(today.requiredAction).toBe('create_mission');
  });

  it('persists mission state across a fresh registry instance', async () => {
    const first = mount();
    await first('plugin_fitness_create', { goal: 'general_fitness' });

    // A brand new registry/handler set, same plugin name → same SQLite state.
    const second = mount();
    const status = (await second('plugin_fitness_status')) as StatusOutput;
    expect(status.exists).toBe(true);
    expect(status.mission?.goal).toBe('general_fitness');
  });
});
