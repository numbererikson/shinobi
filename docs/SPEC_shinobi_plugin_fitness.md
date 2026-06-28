# @shinobi/plugin-fitness — SPEC

Version: 0.2.0
Status: Draft
Owner: Shinobi plugin example / demo use case

> **Changelog vs 0.1.0** — reconciled with the actual Shinobi plugin
> architecture: (1) persistence moves from a stray `fitness-mission-state.json`
> to the platform-provided, SQLite-backed `registry.state` KV store (see §0 and
> §9); (2) all tool names corrected to `snake_case` to satisfy the registration
> regex; (3) `messageCode` formalized into the data model with an enum; (4)
> minor data-model cleanups. Sections describing *why* call out the constraint
> they satisfy.

## 0. Platform prerequisite (read first)

This plugin is **stateful and write-heavy** (create mission, log workout, log
pain, log weight, set equipment). The current Shinobi plugin API
(`ShinobiApi`) is intentionally **read-only** — it exposes only `list*`,
`get*`, `search*`, `check*`. There is no persistence facility exposed to
plugins today.

Therefore this plugin depends on a small platform addition that MUST land
first: a scoped, write-enabled plugin state store.

### 0.1 `registry.state` — scoped KV store

Each plugin receives a state handle scoped to its own plugin name, so one
plugin cannot read or clobber another's namespace:

```ts
export interface PluginStateStore {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

export interface PluginRegistry {
  registerTool(def: PluginToolDef): void;
  state: PluginStateStore; // scoped to this plugin
}
```

### 0.2 Backing store

State is persisted in SQLite (not a side-file). Rationale, tied to repository
constraints in `CLAUDE.md`:

- **"Two independent brain copies — never reduce below two."** SQLite rows are
  covered by the automatic pre-migration backup and travel through
  `shinobi sync`'s git repo. A loose JSON file would be neither.
- **"The remote `/mcp` endpoint is stateless."** Truth must live in the shared
  database, not on one node's disk, so the plugin works behind a tunnel / load
  balancer without sticky sessions.

A single generic table backs all plugins:

```sql
CREATE TABLE IF NOT EXISTS plugin_state (
  plugin     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,            -- JSON blob
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin, key)
);
```

Added as a new forward-only `migrations/NNNN_plugin_state.sql`. The store is
generic, not fitness-specific, so it serves every future stateful plugin —
which is what makes this a true *reference* plugin.

## 1. Purpose

`@shinobi/plugin-fitness` is a headless Shinobi plugin that demonstrates
long-term adaptive mission state.

The goal is not to build another fitness app. The goal is to show that Shinobi
can persist structured state across time, while an LLM reasons over that state
and adapts recommendations.

The first supported mission is:

> Get fit / visible abs in 180 days, while staying smoke-free and
> alcohol-free.

This plugin is intended to be useful in real life, but also to serve as a
reference plugin for Shinobi.

## 2. Core Philosophy

Shinobi owns truth.
The plugin owns state.
The LLM owns reasoning and communication.

The plugin must not generate natural language coaching, motivational text, or
exercise explanations. It should return structured facts, restrictions, IDs,
and state snapshots.

The LLM can then explain workouts, adapt wording, motivate the user, or ask
follow-up questions.

## 3. MVP Scope

The MVP supports one mission type: `fitness_180`.

The MVP tracks:

- profile
- equipment
- restrictions / injuries
- smoking-free streak
- alcohol-free streak
- workout history
- weight history
- current phase
- next suggested workout ID

The MVP does not include:

- wearable integration
- nutrition tracking
- exercise video hosting
- automatic AI-generated programs inside the plugin
- React / mobile UI
- cloud sync beyond Shinobi's existing persistence pattern

## 4. Plugin Responsibilities

The plugin is responsible for:

- creating a fitness mission
- storing persistent mission state (via `registry.state`)
- returning today's structured workout context
- logging workout completion
- logging pain / injury signals
- logging weight
- updating available equipment
- computing simple deterministic restrictions
- computing streaks and progress summary

The plugin is not responsible for:

- explaining how to perform exercises
- deciding exact exercise substitutions in natural language
- giving medical advice
- generating motivational messages
- replacing a trainer, doctor, physiotherapist, or dentist

## 5. Data Model

### 5.1 FitnessMission

```ts
type FitnessMission = {
  id: string;
  type: 'fitness_180';
  status: 'active' | 'paused' | 'completed' | 'archived';
  createdAt: string;
  startedAt: string;
  targetDays: number;
  goal: 'visible_abs' | 'general_fitness' | 'custom';
  profile: FitnessProfile;
  habits: HabitState;
  equipment: EquipmentState;
  restrictions: RestrictionState;
  phase: TrainingPhase;
  history: WorkoutLog[];
  weightHistory: WeightLog[];
  painHistory: PainLog[];
};
```

### 5.2 FitnessProfile

```ts
type FitnessProfile = {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  experience?:
    | 'beginner'
    | 'returning_after_long_break'
    | 'physical_worker_returning'
    | 'intermediate'
    | 'advanced';
  notes?: string;
};
```

### 5.3 HabitState

```ts
type HabitState = {
  smokeFreeSince?: string;
  alcoholFreeSince?: string;
};
```

### 5.4 EquipmentState

```ts
type EquipmentState = {
  level:
    | 'none'
    | 'bodyweight'
    | 'bands'
    | 'bench'
    | 'dumbbells'
    | 'bench_dumbbells'
    | 'pullup_bar'
    | 'pullup_bar_bench_dumbbells'
    | 'home_gym';
  items?: string[];
};
```

> MVP note: the deterministic rules in §7.2 only need `none`/`bodyweight`,
> `bands`, and `bench_dumbbells`/`pullup_bar_bench_dumbbells`. The full enum is
> retained for forward compatibility, but the first implementation may treat
> unhandled levels as their nearest supported neighbor rather than adding rule
> branches that aren't exercised.

### 5.5 RestrictionState

```ts
type RestrictionState = {
  shoulder?: JointRestriction;
  knee?: JointRestriction;
  back?: JointRestriction;
  temporary?: TemporaryRestriction[];
};

type JointRestriction = {
  side?: 'left' | 'right' | 'both';
  status: 'watch' | 'avoid' | 'cleared';
  lastPain?: number; // 0-10
  notes?: string;
};

type TemporaryRestriction = {
  id: string;
  reason: string;
  activeUntil?: string;
  severity: 'low' | 'medium' | 'high';
};
```

### 5.6 TrainingPhase

```ts
type TrainingPhase = {
  number: 1 | 2 | 3 | 4;
  name:
    | 'foundation'
    | 'base_strength'
    | 'progressive_strength'
    | 'definition';
  startedAt: string;
};
```

### 5.7 Logs

```ts
type WorkoutLog = {
  id: string;
  date: string;
  workoutId: string;
  completed: boolean;
  durationMinutes?: number;
  difficulty?: number; // 1-10
  pain?: PainReport[];
  notes?: string;
};

type PainLog = {
  date: string;
  area: PainArea;
  side?: 'left' | 'right' | 'both';
  value: number; // 0-10
  trigger?: string;
  notes?: string;
};

type WeightLog = {
  date: string;
  weightKg: number;
  waistCm?: number;
};

type PainReport = {
  area: PainArea;
  side?: 'left' | 'right' | 'both';
  value: number;
};
```

### 5.8 Pain areas and restriction message codes

```ts
type PainArea = 'shoulder' | 'knee' | 'back' | 'other';

// Stable, machine-readable restriction codes. The LLM maps these to language.
// Codes are part of the plugin's contract and must not change meaning once
// shipped; add new codes rather than repurposing existing ones.
type RestrictionMessageCode =
  | 'NO_HEAVY_OVERHEAD_PRESSING'
  | 'REDUCE_PUSH_VOLUME'
  | 'NO_DIPS'
  | 'SHOULDER_PAIN_HIGH'
  | 'KNEE_PAIN_HIGH'
  | 'BACK_PAIN_HIGH';

type TodayRestriction = {
  area: PainArea;
  side?: 'left' | 'right' | 'both';
  level: 'watch' | 'caution' | 'avoid';
  messageCode: RestrictionMessageCode;
};
```

> Removed in 0.2.0: the `'tooth'` pain area. It was present in 0.1.0's enum but
> mapped to no deterministic workout rule and produced no restriction. Dental
> issues remain a real-life concern but are out of scope for the workout engine;
> reintroduce only alongside a rule that consumes them.

## 6. Workout IDs

The plugin stores and returns workout IDs only. It does not define full
natural-language workouts.

Initial MVP workout IDs:

```txt
phase1_fullbody_a
phase1_fullbody_b
phase1_fullbody_c
phase1_legs_core
phase1_pull_core
phase1_recovery_walk
phase2_bench_dumbbell_a
phase2_bench_dumbbell_b
phase2_pullup_dumbbell_a
```

The LLM maps these IDs to human-readable workout instructions.

Example response from `plugin_fitness_today`:

```json
{
  "missionId": "mission_123",
  "day": 10,
  "phase": {
    "number": 1,
    "name": "foundation"
  },
  "equipment": {
    "level": "none"
  },
  "workoutId": "phase1_fullbody_a",
  "restrictions": [
    {
      "area": "shoulder",
      "side": "right",
      "level": "watch",
      "messageCode": "NO_HEAVY_OVERHEAD_PRESSING"
    }
  ],
  "rules": {
    "trainToFailure": false,
    "repsInReserve": 2,
    "maxPainAllowed": 4
  }
}
```

## 7. Deterministic Rules

### 7.1 Pain Rules

Pain is logged from 0 to 10.

- `0-2`: normal / monitor only
- `3-4`: reduce volume or intensity; return caution restriction
- `5+`: disable conflicting movement category; return avoid restriction

Shoulder-specific behavior:

- shoulder pain `3-4`: avoid dips (`NO_DIPS`), reduce push volume
  (`REDUCE_PUSH_VOLUME`), avoid heavy overhead work
  (`NO_HEAVY_OVERHEAD_PRESSING`)
- shoulder pain `5+`: no push workout (`SHOULDER_PAIN_HIGH`); suggest legs/core
  or recovery workout ID

### 7.2 Equipment Rules

- `none` or `bodyweight`: return phase 1 bodyweight workout IDs
- `bands`: allow shoulder prehab / pull accessory IDs
- `bench`: allow bench-supported bodyweight/dumbbell IDs only if dumbbells exist
- `bench_dumbbells`: allow phase 2 dumbbell strength IDs
- `pullup_bar_bench_dumbbells`: allow pull-up/dumbbell hybrid IDs

### 7.3 Mission Phase Rules

Default phase progression:

- days 1-30: `foundation`
- days 31-75: `base_strength`
- days 76-135: `progressive_strength`
- days 136-180: `definition`

The plugin may delay phase advancement if:

- workouts completed in last 14 days < 4
- active high pain restriction exists
- mission is paused

### 7.4 Failure Rules

The plugin should always return safe fallback state.

If no mission exists:

```json
{
  "exists": false,
  "requiredAction": "create_mission"
}
```

If state is partially corrupt, the plugin should return recoverable error data
and not crash the host. In particular, a malformed or absent KV value MUST be
treated as "no mission" rather than throwing.

## 8. Plugin Tools

Tool names follow the Shinobi convention enforced at registration:
`/^plugin_[a-z][a-z0-9_]*$/`. **Names must be lowercase `snake_case`** — camelCase
is rejected at registration time. (0.1.0 used `logWorkout`, `logPain`,
`logWeight`, `setEquipment`, which would all have failed.)

### 8.1 `plugin_fitness_create`

Creates a fitness mission.

Input:

```ts
type CreateFitnessInput = {
  goal?: 'visible_abs' | 'general_fitness' | 'custom';
  targetDays?: number;
  profile?: Partial<FitnessProfile>;
  smokeFreeSince?: string;
  alcoholFreeSince?: string;
  equipment?: Partial<EquipmentState>;
  restrictions?: Partial<RestrictionState>;
};
```

Output:

```ts
type CreateFitnessOutput = {
  mission: FitnessMission;
  created: boolean;
};
```

### 8.2 `plugin_fitness_today`

Returns today's structured state and suggested workout ID.

Input:

```ts
type TodayInput = {
  date?: string;
};
```

Output:

```ts
type TodayOutput = {
  exists: boolean;
  missionId?: string;
  day?: number;
  phase?: TrainingPhase;
  workoutId?: string;
  restrictions?: TodayRestriction[];
  streaks?: {
    smokeFreeDays?: number;
    alcoholFreeDays?: number;
    workoutStreakDays?: number;
  };
  rules?: {
    trainToFailure: false;
    repsInReserve: number;
    maxPainAllowed: number;
  };
};
```

### 8.3 `plugin_fitness_log_workout`

Stores completed or skipped workout.

Input:

```ts
type LogWorkoutInput = {
  date?: string;
  workoutId: string;
  completed: boolean;
  durationMinutes?: number;
  difficulty?: number;
  pain?: PainReport[];
  notes?: string;
};
```

Output:

```ts
type LogWorkoutOutput = {
  stored: boolean;
  updatedRestrictions: RestrictionState;
  nextSuggestedWorkoutId?: string;
};
```

### 8.4 `plugin_fitness_log_pain`

Stores pain signal and updates restrictions.

Input:

```ts
type LogPainInput = {
  date?: string;
  area: PainArea;
  side?: 'left' | 'right' | 'both';
  value: number;
  trigger?: string;
  notes?: string;
};
```

Output:

```ts
type LogPainOutput = {
  stored: boolean;
  restrictionLevel: 'normal' | 'caution' | 'avoid';
  updatedRestrictions: RestrictionState;
};
```

### 8.5 `plugin_fitness_log_weight`

Stores weight and optional waist measurement.

Input:

```ts
type LogWeightInput = {
  date?: string;
  weightKg: number;
  waistCm?: number;
};
```

Output:

```ts
type LogWeightOutput = {
  stored: boolean;
  latestWeightKg: number;
  deltaFromStartKg?: number;
};
```

### 8.6 `plugin_fitness_set_equipment`

Updates equipment state.

Input:

```ts
type SetEquipmentInput = {
  level: EquipmentState['level'];
  items?: string[];
};
```

Output:

```ts
type SetEquipmentOutput = {
  stored: boolean;
  equipment: EquipmentState;
  enabledWorkoutFamilies: string[];
};
```

### 8.7 `plugin_fitness_status`

Returns complete mission status.

Input:

```ts
type StatusInput = {
  includeHistory?: boolean;
};
```

Output:

```ts
type StatusOutput = {
  mission?: FitnessMission;
  summary?: FitnessSummary;
};
```

## 9. Persistence

State is stored through the platform `registry.state` KV store (see §0), not a
side-file.

- Key: `'mission'`
- Value: the `FitnessPluginState` object below, JSON-serialized by the store.

```ts
type FitnessPluginState = {
  version: 1;
  missions: FitnessMission[];
  activeMissionId?: string;
};
```

Read/write pattern inside a handler:

```ts
const state =
  registry.state.get<FitnessPluginState>('mission') ??
  { version: 1, missions: [] };
// ...mutate deterministically...
registry.state.set('mission', state);
```

State must remain JSON-serializable and migration-friendly: bump `version` and
migrate on read when the shape changes.

## 10. README Demo Scenario

The README should demonstrate this exact flow:

1. User creates 180-day mission.
2. Plugin stores smoke-free and alcohol-free start date.
3. User logs old right shoulder issue.
4. `today()` returns safe foundation workout ID.
5. User logs shoulder pain `5/10`.
6. Next `today()` returns legs/core or recovery workout ID.
7. User adds bench + dumbbells.
8. Plugin enables dumbbell workout IDs.
9. LLM explains the workout using plugin state.

## 11. Example LLM Behavior

The plugin returns:

```json
{
  "workoutId": "phase1_legs_core",
  "restrictions": [
    {
      "area": "shoulder",
      "side": "right",
      "level": "avoid",
      "messageCode": "SHOULDER_PAIN_HIGH"
    }
  ]
}
```

The LLM may say:

> Today we skip push-ups and overhead work. Do legs and core only. Your right
> shoulder was logged at 5/10, so the goal is to keep the streak alive without
> irritating it.

The plugin must not return this text. The LLM generates it.

## 12. Acceptance Criteria

MVP is complete when:

- the `registry.state` platform addition (§0) is implemented, with unit tests
  and `docs/plugin-development.md` updated to document writable scoped state
- plugin can create a mission
- state persists across runs (verified through `registry.state`, surviving a
  process restart)
- `today()` returns deterministic workout ID
- pain logging changes future output
- equipment updates change enabled workout family
- status returns useful summary
- README contains the full demo flow
- smoke test covers create -> today -> log pain -> today -> set equipment ->
  status

## 13. Implementation Notes for Claude

Use this spec as source of truth.

Land the platform prerequisite (§0) first, then build the smallest working
plugin on top of it.

Do not add React, mobile UI, external APIs, additional database dependencies
(reuse the existing better-sqlite3 + migration pattern), exercise video logic,
or LLM calls.

Prefer plain TypeScript, JSON-in-KV state, and deterministic rules.

Keep implementation boring and reliable.
