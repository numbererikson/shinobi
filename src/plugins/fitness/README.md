# @shinobi/plugin-fitness (reference plugin)

A headless Shinobi plugin that demonstrates **long-term adaptive mission
state**. It is the reference implementation for Shinobi's writable, per-plugin
state store (`registry.state`).

The point is not to be a fitness app. It is to show that Shinobi can persist
structured state across time while an LLM reasons over that state and adapts
recommendations. The first mission is: *get visible abs in 180 days while
staying smoke-free and alcohol-free.*

## Division of labour

- **Shinobi owns truth** — durable state in SQLite via `registry.state`.
- **The plugin owns state** — it returns structured facts, restrictions,
  message codes, IDs and snapshots. It never returns coaching, motivation, or
  exercise explanations.
- **The LLM owns language** — it maps workout IDs and message codes to words.

## Tools

| Tool | Purpose |
| --- | --- |
| `plugin_fitness_create` | Create a `fitness_180` mission |
| `plugin_fitness_today` | Today's day, phase, workout ID, restrictions, streaks, rules |
| `plugin_fitness_log_workout` | Record a completed/skipped workout |
| `plugin_fitness_log_pain` | Record pain (0-10) and update restrictions |
| `plugin_fitness_log_weight` | Record weight/waist and delta from start |
| `plugin_fitness_set_equipment` | Update equipment and enabled workout families |
| `plugin_fitness_status` | Full mission status + progress summary |

Workout IDs (e.g. `phase1_fullbody_a`, `phase1_legs_core`,
`phase2_bench_dumbbell_a`) and restriction message codes (e.g.
`NO_HEAVY_OVERHEAD_PRESSING`, `SHOULDER_PAIN_HIGH`) are stable contracts the LLM
translates into instructions.

## Demo flow

1. User creates a 180-day mission.
2. Plugin stores smoke-free and alcohol-free start dates.
3. User logs an old right-shoulder issue (`restrictions.shoulder = watch`).
4. `plugin_fitness_today` → `phase1_fullbody_a` with a `NO_HEAVY_OVERHEAD_PRESSING` watch.
5. User logs shoulder pain `5/10` → restriction escalates to `avoid`.
6. Next `plugin_fitness_today` → `phase1_legs_core` with `SHOULDER_PAIN_HIGH`.
7. User adds a bench + dumbbells (`set_equipment` `bench_dumbbells`).
8. Plugin enables the `phase2_bench_dumbbell` family.
9. The LLM explains the workout using the plugin's structured state — e.g.
   *"Today we skip push and overhead work; do legs and core only. Your right
   shoulder was 5/10, so keep the streak alive without irritating it."* The
   plugin never returns that sentence.

## Deterministic rules

- **Pain** (`rules.ts`): `0-2` normal, `3-4` caution, `5+` avoid. High shoulder
  pain replaces any push day with `phase1_legs_core`.
- **Phases** by mission day: foundation `1-30`, base_strength `31-75`,
  progressive_strength `76-135`, definition `136-180`. Advancement is delayed
  while consistency is low (<4 workouts/14 days), a high-pain restriction is
  active, or the mission is paused.
- **Equipment** gates workout families; dumbbell families unlock only once a
  bench *and* dumbbells are present.

## Persistence

State is a single JSON object under `registry.state` key `mission`
(`FitnessPluginState`, `version: 1`). It lives in Shinobi's SQLite DB, so it is
covered by the pre-migration backup and `shinobi sync`, and works behind the
stateless remote `/mcp` endpoint. Read-modify-write goes through
`registry.state.update(...)` so concurrent calls stay atomic.

## Notes / out of scope

The plugin does not give medical advice and does not replace a trainer, doctor,
physiotherapist, or dentist. No wearables, nutrition, video, or LLM calls live
inside it — by design.
