import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPendingMigrations } from '../src/lib/migrations.js';
import { closeDb } from '../src/lib/db.js';
import { createInProcessRegistry } from '../src/services/plugins/registry.js';
import { register } from '../src/plugins/fitness/index.js';
import type {
  CreateFitnessOutput,
  LogPainOutput,
  SetEquipmentOutput,
  StatusOutput,
  TodayOutput,
} from '../src/plugins/fitness/types.js';

// Isolated DB so the smoke never touches a real ~/.shinobi brain.
const tmp = mkdtempSync(join(tmpdir(), 'shinobi-fitness-smoke-'));
process.env.SHINOBI_DB_PATH = join(tmp, 'smoke.db');
applyPendingMigrations();

const { registry, call } = createInProcessRegistry('fitness');
register(registry);

const SECTION = (t: string): void => console.log(`\n=== ${t} ===`);
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main(): Promise<void> {
  SECTION('create');
  const created = (await call('plugin_fitness_create', {
    goal: 'visible_abs',
    smokeFreeSince: '2026-06-01',
    alcoholFreeSince: '2026-06-01',
    restrictions: { shoulder: { side: 'right', status: 'watch', lastPain: 2 } },
  })) as CreateFitnessOutput;
  console.log('mission', created.mission.id, 'created', created.created);
  assert(created.created && created.mission.type === 'fitness_180', 'mission created');

  SECTION('today (foundation)');
  const day1 = (await call('plugin_fitness_today')) as TodayOutput;
  console.log('day', day1.day, 'phase', day1.phase?.name, 'workout', day1.workoutId);
  console.log('restriction', day1.restrictions?.[0]?.messageCode, 'streaks', JSON.stringify(day1.streaks));
  assert(day1.workoutId === 'phase1_fullbody_a', 'foundation fullbody A');
  assert(day1.restrictions?.[0]?.messageCode === 'NO_HEAVY_OVERHEAD_PRESSING', 'shoulder watch code');
  assert((day1.streaks?.smokeFreeDays ?? 0) > 0, 'smoke-free streak counted');

  SECTION('log shoulder pain 5/10');
  const pain = (await call('plugin_fitness_log_pain', {
    area: 'shoulder',
    side: 'right',
    value: 5,
  })) as LogPainOutput;
  console.log('restrictionLevel', pain.restrictionLevel);
  assert(pain.restrictionLevel === 'avoid', 'pain 5 → avoid');

  SECTION('today (after pain)');
  const afterPain = (await call('plugin_fitness_today')) as TodayOutput;
  console.log('workout', afterPain.workoutId, 'restriction', afterPain.restrictions?.[0]?.messageCode);
  assert(afterPain.workoutId === 'phase1_legs_core', 'high shoulder pain → legs/core');
  assert(afterPain.restrictions?.[0]?.messageCode === 'SHOULDER_PAIN_HIGH', 'shoulder high code');

  SECTION('set equipment bench_dumbbells');
  const equip = (await call('plugin_fitness_set_equipment', { level: 'bench_dumbbells' })) as SetEquipmentOutput;
  console.log('families', equip.enabledWorkoutFamilies.join(', '));
  assert(equip.enabledWorkoutFamilies.includes('phase2_bench_dumbbell'), 'dumbbell family enabled');

  SECTION('status');
  const status = (await call('plugin_fitness_status')) as StatusOutput;
  console.log(
    'day', status.summary?.day,
    'phase', status.summary?.phase,
    'restrictions', status.summary?.activeRestrictions.map((r) => r.messageCode).join(','),
  );
  assert(status.exists && status.summary?.activeRestrictions[0]?.messageCode === 'SHOULDER_PAIN_HIGH', 'status summary');

  SECTION('persistence across fresh registry');
  const second = createInProcessRegistry('fitness');
  register(second.registry);
  const reread = (await second.call('plugin_fitness_status')) as StatusOutput;
  assert(reread.exists && reread.mission?.goal === 'visible_abs', 'state survived new registry');
  console.log('reread goal', reread.mission?.goal);

  closeDb();
  rmSync(tmp, { recursive: true, force: true });
  console.log('\nALL OK');
}

main().catch((err) => {
  console.error(err);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
