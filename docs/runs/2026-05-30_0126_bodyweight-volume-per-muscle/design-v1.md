# Design v1 — 2026-05-30_0126_bodyweight-volume-per-muscle

## Goal (1 sentence)
Make the canonical volume kernel bodyweight-aware on EVERY surface (Phase 0), and add a weekly per-muscle multi-line chart while removing the per-session chart (Phase 1).

## Approach

Phase 0 introduces ONE pure helper — `effectiveWeightKg(equipment, weight, bodyweightKg)` — that replaces the bare `parseFloat(weight)` step in all ~9 kernel sites, plus ONE pure resolver — `bodyweightKgAsOf(measurements, instantMs)` — that turns the measurement timeline into a per-session bodyweight. Both are threaded as **optional inputs** so that when absent the kernels reproduce byte-for-byte the pre-feature numbers (the `windowStartMs?` precedent at `volume-target.ts:48-57` / `progress-page-math.ts:33-43`). Two data pipelines exist after this: the `WeeklyVolumeRow[]` pipeline (surfaces 1,2,5,6,14) gets `equipment` from a **widened `stats.ts` SELECT** (`exercises!inner(equipment)`), and resolves bodyweight **per-row** via `row.sessions.started_at` (each row already carries it); the `SetRow`/`SessionSets` pipelines (surfaces 3,4,8,9,10,11,13) are **all single-session at the call site** (verified below), so they get equipment from a per-exercise map built off `useAllExercises` (already in scope or one cheap hook away) and a **single** `bodyweightKgAsOf` resolved once per session from the session's `started_at`.

Why this seam over alternatives: widening the SELECT touches one query and 4 `WeeklyVolumeRow` kernels inherit `equipment` for free, lower blast radius than threading a `useAllExercises` join into 4 separate surfaces (Discovery #1c). The single `effectiveWeightKg` helper makes the "same number everywhere" invariant *real* (centralised arithmetic) rather than merely documented. The optional-param design means non-bodyweight numbers are provably unchanged because the only new code path is `equipment === "bodyweight"`.

Phase 1 adds a new `<MultiSeriesChart>` (not an extension of `<ProgressChart>`, to protect its 2 single-series callers) fed by a new presenter `presentWeeklyVolumeByMuscle(...)` that buckets the (already bodyweight-aware) `WeeklyVolumeRow[]` by ISO week × `muscles[0]`, zero-filled across a shared contiguous week axis, with 7 fixed colors and client-state check-all/uncheck-all. It is a TREND viz: it does NOT honor `max_volume_window_weeks` (Discovery #3).

## Verified facts that shaped the design (beyond Discovery)

- **F-1 (load-bearing).** `SetRow` does NOT carry `sessions.started_at` (`db/types.ts:210-226`). Every `sumLiveVolume(SetRow[])` / `sumPastVolume(SetRow[])` call site is **single-session**: live header `workout/[sessionId].tsx:91-94`, verdict total `verdict/[sessionId].tsx:53-56`, history detail `history/[id].tsx:133`, `computeCurrentSessionVolumeByExercise` `session-verdict-math.ts:33-48` (groups ONE session's sets by exercise), `computeVolumeTarget` (one live session + per-past-session reduce inside the loop), `presentExerciseSessionRow`/`presentSetVolumeLines` (one session group). → the `SetRow` pipeline can take a **single** `bodyweightKgAsOf: number | null` per call. The per-exercise-progress screen reduces `SessionSets[]` (multi-session) but iterates session-by-session (`progress.tsx:133`), so it resolves bodyweight per `s.started_at` inside the loop.
- **F-2.** `groupSessionVolumes` / `bucketLifetimeWeeklyVolumes` / `computeCurrentWeekVolume` / `computeLifetimeMaxPerExercise` / `computePrsThisWeek` are **multi-session** and each `WeeklyVolumeRow` carries `sessions.started_at` (`stats.ts:25`). → the `WeeklyVolumeRow` pipeline resolves bodyweight **per-row**.
- **F-3.** `listAllExercises` is `select("*")` (`exercises.ts:36-44`) → `equipment` + `muscles` already load via `useAllExercises`. No new fetch for the exercise→equipment/muscle map.
- **F-4.** e2e fixtures use `pickCanonicalExercise(admin, "Bench Press"/"Squat (Barbell)"/...)` with explicit barbell weights (`end-of-session-verdict.spec.ts:16-20`, `canonical-exercise.ts:34-60`). None pick a `bodyweight`-equipment exercise. → existing volume-assertion e2e numbers do NOT move (must still be verified, not assumed — see Test plan).
- **F-5.** `presentSessionVolumeChart` has NO unit test (Discovery verified; confirmed by reading `progress-page-math.ts` — the describe inventory has no block for it). Removal deletes no test.
- **F-6.** `useMeasurements` has no `staleTime` (refetch on mount, `use-measurements.ts:17-22`), key `["measurements"]`. `useFinishSession` invalidates `["stats"]`+`["exercises"]` but NOT `["measurements"]` — acceptable: a finished session does not create a weigh-in, and the measurements list is already fresh-on-mount. The Progress page mounting `useMeasurements` triggers its own fetch. No invalidation change needed.

## Mudanças por arquivo

### Phase 0 — new pure helpers
| File | Type | Change |
|---|---|---|
| `src/utils/bodyweight.ts` | new | Two pure functions: `effectiveWeightKg(equipment, weight, bodyweightKg)` and `bodyweightKgAsOf(measurements, instantMs)`. No React, no I/O — unit-testable under vitest. Single responsibility: bodyweight-as-load arithmetic + as-of-session resolution. |

### Phase 0 — data plumbing (one query change)
| File | Type | Change |
|---|---|---|
| `src/api/stats.ts` | edited | Widen `SELECT` (`:28-29`) to `... exercise_id, session_id, exercises!inner(equipment), sessions!inner(started_at, ended_at)`. Add `exercises: { equipment: string }` to `WeeklyVolumeRow` (`:18-26`). Single responsibility: carry equipment into the row. (`equipment` typed `string` not `Equipment` — legacy user rows may hold arbitrary strings, `db/types.ts:77-78`; the `=== "bodyweight"` test in the kernel is the canonical gate.) |

### Phase 0 — kernel sites (route `w` through `effectiveWeightKg`; add optional bodyweight inputs)
| File | Type | Change |
|---|---|---|
| `src/utils/volume-target.ts` | edited | `sumPastVolume` (`:74-85`) + `sumLiveVolume` (`:100-114`) gain optional `bw?: BodyweightResolver`. `computeVolumeTarget` (`:135-201`) gains `bodyweightKgBySession?` (see contract) and passes per-session bw into `sumPastVolume`, the live bw into `sumLiveVolume`, and uses `effectiveWeightKg` in the `currentWeightKg` reduce (`:177-190`). |
| `src/utils/progress-page-math.ts` | edited | `bucketLifetimeWeeklyVolumes` (`:41-59`), `computeCurrentWeekVolume` (`:143-158`), `computeLifetimeMaxPerExercise` (`:183-222`), `computePrsThisWeek` (`:306-393`) each gain optional `bodyweight?: WeeklyBodyweightInput` and replace the inline `row.weight ? parseFloat(row.weight) : 0` with `effectiveWeightKg(row.exercises.equipment, row.weight, bw)` where `bw = bodyweight ? bodyweightKgAsOf(bodyweight.measurements, parseISO(row.sessions.started_at).getTime()) : null`. `groupSessionVolumes` (`:251-265`) gains the same optional input and passes a per-row resolver into `sumLiveVolume`. **REMOVE** `presentSessionVolumeChart` (`:537-586`). |
| `src/utils/weekly-volume-strip-math.ts` | edited | `computeStripModel` (`:47-92`) — the easy-to-miss 4th inline kernel — gains optional `bodyweight?: WeeklyBodyweightInput`; replace `row.weight ? parseFloat(row.weight) : 0` (`:72-76`) with `effectiveWeightKg(row.exercises.equipment, row.weight, bwForRow)`. |
| `src/utils/exercise-session-row-format.ts` | edited | `presentExerciseSessionRow` (`:48-62`) + `presentSetVolumeLines` (`:89-112`) gain optional `bodyweightKg?: number | null` + `equipment?: string`; the `w*r` at `:98-101` becomes `effectiveWeightKg(equipment, s.weight, bodyweightKg)`. |
| `src/utils/session-verdict-math.ts` | edited | `computeCurrentSessionVolumeByExercise` (`:33-48`) gains optional `opts?: { equipmentByExerciseId, bodyweightKg }`; passes a per-exercise resolver into `sumLiveVolume`. `computePrsForSession` (`:82-133`) passes its `bodyweight?` straight through to `computeLifetimeMaxPerExercise`. |

### Phase 0 — inline-reduce site (per-exercise progress screen)
| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/[id]/progress.tsx` | edited | The inline `useMemo` reduce (`:138-147`, the `w*r` at `:145`) replaces `const w = set.weight ? parseFloat(set.weight) : 0` with `const w = effectiveWeightKg(exercise.data?.equipment, set.weight, bodyweightKgAsOf(measurements, parseISO(s.started_at).getTime()))`. Mount `useMeasurements`; add `measurements` to the `useMemo` deps. e1RM is computed from the **logged** weight per `set` and is OUT OF SCOPE (see Risks) — only the `sessionVolume += w*r` line uses the effective weight. |

### Phase 0 — surfaces that must pass the new inputs (call-site wiring)
| File | Type | Change |
|---|---|---|
| `app/(app)/workout/[sessionId].tsx` | edited | `:91-94` — `sumLiveVolume(setsQ.data ?? [])` → pass a `BodyweightResolver` built from `useAllExercises` equipment map + `bodyweightKgAsOf(measurements, parseISO(session.data.started_at).getTime())`. Mount `useMeasurements` + `useAllExercises` (session already loaded). |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | `:53-56` total + `:58-61` `computeCurrentSessionVolumeByExercise` + `:66-84` `computePrsForSession`: pass equipment map (from `useAllExercises`, already mounted `:45`) + `bodyweightKgAsOf(measurements, parseISO(session.started_at))`. Mount `useMeasurements`. |
| `app/(app)/history/[id].tsx` | edited | `:133` `sumLiveVolume(rows)`: pass equipment map (mount `useAllExercises`) + `bodyweightKgAsOf(measurements, parseISO(session.started_at))` (mount `useMeasurements`). Also the `sumLiveVolume` in any per-exercise sub-total on this screen, if present, gets the same. |
| `app/(app)/admin/index.tsx` | edited | `:394` admin session-detail total: pass equipment map + per-session bw (admin already reads sessions; mount `useMeasurements` scoped to the admin's own auth — NOTE the admin views OTHER users' sessions, so their bodyweight is not the admin's; see Risk R-7. Default: admin total stays **non-bodyweight** by passing no bw input, preserving today's number — admin is a debug surface, not a user-facing volume claim). |
| `src/components/volume-target-slot.tsx` | edited | `:47-55` `computeVolumeTarget(...)`: pass `bodyweightKgBySession` (resolved from `useMeasurements` + each past `SessionSets.started_at`) and the live bw for `currentSessionSets` (from the live session's `started_at`). Mount `useMeasurements`; equipment from the `ExerciseRow` the parent `<ExerciseBlock>` holds — thread `equipment` prop in. |
| `src/hooks/use-progress-page.ts` | edited | `useLifetimeBestWeek` / `useCurrentWeekVolume` / `usePrsThisWeek` (`:45-144`) + `useExercisesThisWeek` (`:220-334`): mount `useMeasurements`, build `{ measurements, equipmentByExerciseId }` from `useAllExercises` (lib already fetched in `useExercisesThisWeek`), pass into the kernels. The inline reduce at `:251-258` (`nowKgByExercise`) replaces `parseFloat(w)` with `effectiveWeightKg(ex.equipment, r.weight, bodyweightKgAsOf(...))` — `libById.get(r.exercise_id)` already resolves the exercise here (`:274`). |
| `src/components/weekly-volume-strip.tsx` | edited | Pass `{ measurements, equipmentByExerciseId }` into `computeStripModel`. Mount `useMeasurements` + `useAllExercises`. |
| `src/components/exercise-session-row.tsx` | edited | Thread `equipment` + `bodyweightKg` (resolved from the session's `started_at`) into `presentExerciseSessionRow`. Receives `equipment`/`measurements` from the per-exercise progress screen which already has both. |
| `src/components/set-volume-breakdown.tsx` callers | edited | The two callers of `presentSetVolumeLines` (`progress.tsx:262-267`, `volume-target-slot.tsx:68,138`) pass `equipment` + the resolved `bodyweightKg` for the relevant session. |

### Phase 1 — new chart
| File | Type | Change |
|---|---|---|
| `src/components/multi-series-chart.tsx` | new | `<MultiSeriesChart>` — multi-line SVG chart over a shared x-axis. Props in Contracts. |
| `src/components/weekly-muscle-volume-section.tsx` | new | Section wrapper: mounts `useLifetimeWeeklyVolume` + `useAllExercises` + `useMeasurements`, calls `presentWeeklyVolumeByMuscle`, owns check-all/uncheck-all + per-muscle toggle client state, renders `<MultiSeriesChart>`. Mirrors the removed section's local-state idiom (`session-volume-chart-section.tsx:36`). |
| `src/utils/weekly-muscle-volume.ts` | new | Pure presenter `presentWeeklyVolumeByMuscle(...)` (signature in Contracts). |

### Phase 1 — removals + mount
| File | Type | Change |
|---|---|---|
| `src/components/session-volume-chart-section.tsx` | deleted | Superseded by the per-muscle chart. |
| `src/utils/progress-page-math.ts` | edited | Remove `presentSessionVolumeChart` (`:537-586`) + its imports if now-unused (`formatShortDate` still used by `weekKeyToMondayLabel`, keep). |
| `app/(app)/progress/index.tsx` | edited | Remove `<SessionVolumeChartSection />` import (`:6`) + mount (`:70`); add `<WeeklyMuscleVolumeSection />` in the same slot (between `<WeeklyVolumeStrip>` and `<ExercisesThisWeekList>`). |

### Tests
| File | Type | Change |
|---|---|---|
| `tests/unit/bodyweight.test.ts` | new | Unit tests for `effectiveWeightKg` + `bodyweightKgAsOf` (all fallback branches). |
| `tests/unit/weekly-muscle-volume.test.ts` | new | Unit tests for `presentWeeklyVolumeByMuscle` (bucketing, zero-fill, `muscles[0]` attribution, "Other", bodyweight contribution). |
| `tests/unit/volume-target.test.ts` | edited | Add bodyweight cases (bw addend, weighted pull-up, null-bw passthrough). |
| `tests/unit/weekly-volume-bucketing.test.ts` | edited | Add equipment field to fixtures (the existing `buildRow` `:24-37` already defaults `sessions`; add `exercises: { equipment }` default = `"barbell"` so existing assertions stay green); add a bodyweight bucket case. |
| `tests/unit/session-verdict-math.test.ts` | edited | Add a bodyweight-PR creation/erasure case. |
| `tests/unit/progress-page-math.test.ts` | edited | Add bodyweight cases to `bucketLifetimeWeeklyVolumes`/`computeLifetimeMaxPerExercise`/`computePrsThisWeek`; **no** `presentSessionVolumeChart` block exists to delete (F-5). |
| `tests/e2e/weekly-muscle-volume.spec.ts` | new | New chart smoke (renders, lines toggle, check-all/uncheck-all). |
| `docs/features.md` | edited | Move both phases from "## Open" to "## Done"; keep leverage-factors + secondary-muscle deferred entries (`:7-8`). |

## Contratos de I/O

### `src/utils/bodyweight.ts`

```ts
import type { MeasurementEntryRow } from "~/db/types";

/**
 * Bodyweight-as-of-session resolver result, cached per session by callers.
 * `null` = the user has never logged a non-null weight_kg → bodyweight
 * contribution is treated as 0 (NOT NaN). See fallback rule below.
 */

/**
 * Effective per-set load in kg. The single arithmetic seam for the
 * "same number everywhere" invariant.
 *
 *   - equipment === "bodyweight": effective = (bodyweightKg ?? 0) + addedLoad
 *   - any other equipment (incl. legacy strings, null): effective = addedLoad
 *
 * `addedLoad = weight == null ? 0 : parseFloat(weight)` (NaN-safe: a
 * non-finite parse → 0). `bodyweightKg` is the resolved as-of-session
 * bodyweight or null. The bodyweight addend ONLY fires on the exact canonical
 * token "bodyweight" (Decision #7) — a 0-weight machine set stays 0
 * (Decision #6). Returns a finite number ≥ 0; never NaN.
 */
export function effectiveWeightKg(
  equipment: string | null | undefined,
  weight: string | null,
  bodyweightKg: number | null,
): number;

/**
 * Resolves the user's bodyweight (kg) as of `instantMs` (a UTC ms instant,
 * typically parseISO(session.started_at).getTime()).
 *
 * `measurements` is the raw `useMeasurements` result (DESC by measured_at per
 * `listMeasurements`, but this function does NOT rely on input order — it
 * filters + scans). Only entries with a non-null, finite `weight_kg` are
 * considered (mirrors `measurements-chart.ts:29-31`).
 *
 * Fallback rule (all branches unit-tested — Decision #2):
 *   1. nearest PRIOR weigh-in: max(measured_at) s.t. measured_at <= instantMs
 *      AND weight_kg finite. Compare on parseISO(measured_at).getTime()
 *      (both UTC instants) — NO local-day rounding.
 *   2. else nearest LATER weigh-in: min(measured_at) s.t.
 *      measured_at > instantMs AND weight_kg finite.
 *   3. else (user never logged a finite weight_kg): return null.
 * Returns kg as a finite number, or null.
 */
export function bodyweightKgAsOf(
  measurements: MeasurementEntryRow[] | undefined,
  instantMs: number,
): number | null;
```

**Resolver helper passed to row-by-row kernels** (avoids re-scanning measurements per row): kernels that iterate `WeeklyVolumeRow[]` accept a single optional struct and resolve per row internally, but memoise by session via a `Map<string, number | null>` keyed on `session_id`:

```ts
// Shared input shape for the WeeklyVolumeRow[] kernels (optional everywhere).
export type WeeklyBodyweightInput = {
  measurements: MeasurementEntryRow[];
};
// Inside each kernel: resolve bw once per session_id and cache.
//   const bwCache = new Map<string, number | null>();
//   const bw = resolveSessionBw(row.session_id, row.sessions.started_at);
// where resolveSessionBw memoises bodyweightKgAsOf(input.measurements, ms).
```

For the `SetRow`/single-session kernels, the input is a **flat** optional `bodyweightKg: number | null` plus a per-exercise equipment lookup:

```ts
// sumLiveVolume / sumPastVolume gain an optional resolver argument:
export type SetBodyweightInput = {
  /** exercise_id → equipment token. From useAllExercises. */
  equipmentByExerciseId: Map<string, string>;
  /** Bodyweight as-of THIS session (single session per call — F-1). */
  bodyweightKg: number | null;
};
export function sumPastVolume(sets: SetRow[], bw?: SetBodyweightInput): number;
export function sumLiveVolume(
  sets: Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps" | "exercise_id">[],
  bw?: SetBodyweightInput,
): number;
```

Note the `Pick` gains `"exercise_id"` (already on both `SetRow` and `WeeklyVolumeRow`) so the equipment lookup works for both shapes without a cast. **When `bw` is `undefined`, both functions execute the exact pre-feature predicate** (`w = weight ? parseFloat(weight) : NaN; if (Number.isFinite(w) && w>0 && r>0) total += w*r`) — byte-for-byte (Decision #6/#9, the `windowStartMs?` precedent).

### `computeVolumeTarget` signature delta

```ts
export type ComputeVolumeTargetInput = {
  pastSessions: SessionSets[] | undefined;
  currentSessionSets: SetRow[];
  windowStartMs?: number;
  /** Optional. When provided, volume math becomes bodyweight-aware. */
  bodyweight?: {
    equipmentByExerciseId: Map<string, string>;
    /** Bodyweight as-of the LIVE session (for currentSessionSets). */
    liveBodyweightKg: number | null;
    /** session_id → bodyweight-as-of for past sessions (resolved by caller
     *  from each SessionSets.started_at). */
    pastBodyweightBySession: Map<string, number | null>;
  };
};
```
`currentWeightKg` pick (`:177-190`) uses `effectiveWeightKg(equipmentByExerciseId.get(s.exercise_id), s.weight, liveBodyweightKg)` for the `> 0` gate so a bodyweight set with `addedLoad=0` still qualifies as the "current weight" (its effective load is the bodyweight). `repsToBeat = gapKg / effectiveCurrentWeightKg`.

### `WeeklyVolumeRow` delta (`stats.ts`)

```ts
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;
  session_id: string;
  exercises: { equipment: string };          // NEW (string, not Equipment — legacy)
  sessions: { started_at: string; ended_at: string };
};
const SELECT =
  "completed_at, weight, reps, set_type, exercise_id, session_id, " +
  "exercises!inner(equipment), sessions!inner(started_at, ended_at)";
```
RLS: `exercises` is already RLS-readable to the owner (`user_id IS NULL OR auth.uid()=user_id`, `db/types.ts:142-147`); `!inner` will not drop rows — every set references a visible exercise. No new RLS, no migration (Discovery #7).

### `presentWeeklyVolumeByMuscle` (`src/utils/weekly-muscle-volume.ts`)

```ts
import type { WeeklyVolumeRow } from "~/api/stats";
import type { ExerciseRow, MeasurementEntryRow, MuscleGroup } from "~/db/types";

export type MuscleSeriesKey = MuscleGroup | "Other";

export type WeeklyMuscleSeries = {
  key: MuscleSeriesKey;
  /** kg per week, index-aligned to `weeks` (zero-filled). */
  values: number[];
};

export type WeeklyMuscleVolumeModel = {
  /** Shared contiguous ISO-week axis (oldest→newest), first-trained → now. */
  weeks: { key: string; label: string }[];
  /** One entry per muscle group that has ANY non-zero week (+ "Other" iff it
   *  has data). Insertion order = MUSCLE_GROUPS then "Other". */
  series: WeeklyMuscleSeries[];
};

/**
 * Buckets bodyweight-aware weekly volume by (ISO week × primary muscle).
 *
 * - Week axis = isoWeeksBetween(firstSessionMonday, currentMonday) — same
 *   zero-fill contract as computeStripModel (Decision #4).
 * - Bucket placement uses weekKeyOf(parseISO(row.completed_at)) (matches the
 *   strip's bar-week semantic).
 * - Muscle attribution: libById.get(row.exercise_id).muscles[0] → MuscleGroup,
 *   else "Other" (mirrors useExercisesThisWeek:278-283). Dangling exercise_id
 *   (not in lib) → skip the row (mirrors use-progress-page.ts:275).
 * - Volume per set = effectiveWeightKg(ex.equipment, row.weight, bw) * reps,
 *   bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at)),
 *   memoised per session_id.
 * - Empty series (a muscle with all-zero weeks) is dropped from `series`.
 * - Returns weeks=[] / series=[] when rows is empty.
 *
 * Does NOT honor max_volume_window_weeks (Decision #3) — full history.
 */
export function presentWeeklyVolumeByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  now?: Date;            // injectable for deterministic tests (default new Date())
}): WeeklyMuscleVolumeModel;
```

### `<MultiSeriesChart>` props (`src/components/multi-series-chart.tsx`)

```ts
export type ChartSeries = {
  label: string;
  color: string;        // hex
  /** index-aligned to xLabels; values are pre-unit-converted by the caller. */
  values: number[];
  visible: boolean;     // toggled by the section's check state
};
type MultiSeriesChartProps = {
  xLabels: string[];          // shared week axis labels
  series: ChartSeries[];
  width: number;
  height?: number;            // default 200
  title: string;
  formatValue?: (v: number) => string;
};
```
Y-domain spans `max` across ALL **visible** series (min pinned to 0 — volume is non-negative, so 0-baseline reads honestly). One `<Polyline>` per visible series colored by `series.color`; dots per point. X positions derived from the shared `xLabels.length` (index spacing), so a muscle that is 0 in week W still aligns to W's x (zero point, not a gap — Decision #4). Renders an empty-state when no series is visible or all values are 0.

### 7 fixed colors (keyed to `MUSCLE_GROUPS` order + "Other")

```ts
const MUSCLE_COLORS: Record<MuscleSeriesKey, string> = {
  "Chest":      "#ef4444", // red-500
  "Upper back": "#3b82f6", // blue-500
  "Lower back": "#06b6d4", // cyan-500
  "Shoulders":  "#f59e0b", // amber-500
  "Arms":       "#8b5cf6", // violet-500
  "Legs":       "#10b981", // emerald-500
  "Core":       "#ec4899", // pink-500
  "Other":      "#9ca3af", // gray-400 (only when an "Other" line exists)
};
```

### Section client state (`weekly-muscle-volume-section.tsx`)

```ts
// Local, non-persisted (mirrors removed chart's useState idiom).
const [visible, setVisible] = useState<Set<MuscleSeriesKey>>(
  () => new Set(model.series.map((s) => s.key)), // all on by default
);
// check-all → set all keys; uncheck-all → empty set.
// per-muscle chip toggles membership.
```

## Decision log (all 9 Discovery Unknowns)

**#1 — Plumbing seam.** DECISION: single `effectiveWeightKg` helper + `bodyweightKgAsOf` resolver. `WeeklyVolumeRow` pipeline gets `equipment` via a widened `stats.ts` SELECT (`exercises!inner(equipment)`) and resolves bw per-row from `row.sessions.started_at`. `SetRow`/`SessionSets` pipelines get equipment from an `equipmentByExerciseId` Map (built off `useAllExercises`, F-3) and a single per-session `bodyweightKg` (F-1 proves they're all single-session). RATIONALE: one query touched, 4 `WeeklyVolumeRow` kernels inherit equipment for free; the helper centralises the arithmetic so the invariant is real. REJECTED: client-side `useAllExercises` join threaded into all 4 `WeeklyVolumeRow` surfaces — 4 wiring points vs 1 SELECT, higher blast radius (Discovery #1c). REJECTED: server-side bodyweight resolution via a SQL lateral join on `measurement_entries` — no FK, temporal join is awkward in PostgREST and would not be reusable by the `SetRow` pipeline.

**#2 — Bodyweight fallback (central correctness).** DECISION: (1) nearest PRIOR finite `weight_kg`; (2) else nearest LATER finite `weight_kg`; (3) else `null` → contribution 0 (no NaN). For a `bodyweight` set with `addedLoad=0` and `null` bw, effective = 0 → contributes 0 = today's behavior. RATIONALE: prior-first is the honest "what did I weigh then"; later-fallback rescues early sessions before the first weigh-in (a user who weighs in a week after starting still has a meaningful number); null→0 guarantees no silent NaN and means a measurement-less user sees exactly today's numbers (safe degrade). REJECTED: prior-only-else-0 — leaves the bug unfixed for everyone before their first weigh-in (Discovery flagged this risk). REJECTED: nearest-by-absolute-distance (prior-or-later, whichever is closer) — back-dates today's bodyweight onto years-old sessions when a later weigh-in happens to be temporally closer; prior-priority avoids that.

**#3 — Honor `max_volume_window_weeks`?** DECISION: NO. The per-muscle chart is a full-history trend viz (its job is "make a silent weekly drop visible," prompt `state.md:23`). RATIONALE: PR/Max surfaces honor the pref; trend charts deliberately do not (`exercises/[id]/progress.tsx:29-31`). REJECTED: a chart-local 12/26/52/all selector (like the removed chart) — adds chrome the owner didn't ask for; deferred to Out of scope as an easy future add since the presenter already takes `now`.

**#4 — Zero/untrained weeks.** DECISION: zero-fill across a shared contiguous week axis (first-trained Monday → current Monday), zero point (not a gap). RATIONALE: mirrors `computeStripModel` zero-fill (`weekly-volume-strip-math.ts:66-77`); a drop to zero is exactly the signal the owner wants; all 7 lines share one axis so they're comparable. REJECTED: per-series gap (skip the week) — `<ProgressChart>` has no gap concept and a gap hides the very drop the chart exists to surface.

**#5 — Retroactive PR/max blast radius.** DECISION: documented as the Regression contract (below). Invariant: non-bodyweight numbers byte-for-byte unchanged (provable — only `equipment === "bodyweight"` adds a path); bodyweight PRs/max change as expected. RATIONALE/VERIFICATION: F-4 — e2e fixtures use barbell exercises with explicit weights, so their numbers do NOT move; the Tester must still grep each listed spec for any `bodyweight` exercise pick and confirm. REJECTED: scoping the kernel change to only the new chart — explicitly forbidden by the owner's pre-confirmed Decision (a).

**#6 — `addedLoadKg` for non-bodyweight `weight=0`.** DECISION: only `equipment === "bodyweight"` gets the addend; every other equipment keeps the `w>0` guard. A 0-weight machine set stays 0. The predicate is `effective = effectiveWeightKg(eq, weight, bw); if (effective > 0 && r > 0) total += effective * r`. RATIONALE: preserves today's behavior for non-bodyweight (Decision aligns with the `windowStartMs?`-absent invariant). The `effective > 0` guard restructure replaces `w > 0` but is byte-identical for non-bodyweight because `effective === addedLoad` there. REJECTED: treating any `weight=0` set as bodyweight — would silently inflate sloppy machine logs.

**#7 — Legacy/unknown equipment.** DECISION: exact `=== "bodyweight"` (lowercase canonical, post-0014). Legacy mixed-case "Bodyweight" does NOT trigger. RATIONALE: 0014 normalised canonical rows (`features.md:33`); owner is sole user; the `Equipment` union is lowercase (`db/types.ts:80-85`). `WeeklyVolumeRow.exercises.equipment` typed `string` (not `Equipment`) to tolerate legacy without a cast. REJECTED: case-insensitive match — over-broad; no canonical row needs it.

**#8 — New component vs extend `<ProgressChart>`.** DECISION: new `<MultiSeriesChart>`. RATIONALE: `<ProgressChart>` is single-series with 2 callers (measurements strip `measurements-progress-strip.tsx:61-67`, per-exercise page `progress.tsx:229-243`); extending it risks regressing both for zero benefit. "Other" bucket GETS an 8th line (gray) only when it has data — the owner cares about total visibility and "Other" can hide a real drop. Check-all/uncheck-all = client state, not persisted (mirrors `session-volume-chart-section.tsx:36`). REJECTED: extend `<ProgressChart>` with an optional `series` prop — couples two unrelated render contracts. REJECTED: exclude "Other" — would silently drop volume for exercises with empty/unknown primary muscle, the opposite of the chart's purpose.

**#9 — Refactor `computeStripModel` + per-exercise inline reduce onto the kernel?** DECISION: route BOTH (and all ~9 sites) through `effectiveWeightKg`. `computeStripModel` gains the bodyweight input; the per-exercise screen's inline reduce calls `effectiveWeightKg` directly. RATIONALE: the prompt's "canonical kernel" framing requires it — leaving either inline-but-unfixed breaks "same number everywhere" at exactly the strip + per-exercise surfaces. I do NOT extract the per-exercise inline reduce into a named function (out of scope churn) — it just adopts the helper. REJECTED: leave them inline-and-unfixed — breaks the invariant. REJECTED: full extraction of every inline kernel into `volume-target.ts` — scope creep beyond the bodyweight change.

## Kernel-site inventory (the "change once" map — all routed through `effectiveWeightKg`)

| # | Site | File:line | Pipeline | bw input |
|---|---|---|---|---|
| 1 | `sumPastVolume` | `volume-target.ts:74-85` | SetRow | `SetBodyweightInput?` |
| 2 | `sumLiveVolume` | `volume-target.ts:100-114` | SetRow/WVR | `SetBodyweightInput?` |
| 3 | `computeVolumeTarget` current-weight reduce | `volume-target.ts:177-190` | SetRow | via `bodyweight?` |
| 4 | `bucketLifetimeWeeklyVolumes` | `progress-page-math.ts:52-55` | WVR | `WeeklyBodyweightInput?` |
| 5 | `computeCurrentWeekVolume` | `progress-page-math.ts:151-155` | WVR | `WeeklyBodyweightInput?` |
| 6 | `computeLifetimeMaxPerExercise` | `progress-page-math.ts:191-193` | WVR | `WeeklyBodyweightInput?` |
| 7 | `groupSessionVolumes` (via `sumLiveVolume`) | `progress-page-math.ts:251-265` | WVR | `WeeklyBodyweightInput?` |
| 8 | `computePrsThisWeek` | `progress-page-math.ts:328-330` | WVR | `WeeklyBodyweightInput?` |
| 9 | `computeStripModel` (easy-to-miss) | `weekly-volume-strip-math.ts:72-76` | WVR | `WeeklyBodyweightInput?` |
| 10 | per-exercise inline reduce (easy-to-miss) | `progress.tsx:138-147` | SessionSets | inline `effectiveWeightKg` |
| 11 | `presentSetVolumeLines` | `exercise-session-row-format.ts:98-101` | SetRow | `equipment?`+`bodyweightKg?` |
| 12 | `presentExerciseSessionRow` (via `sumPastVolume`) | `exercise-session-row-format.ts:55` | SetRow | inherited |
| 13 | `useExercisesThisWeek` nowKg reduce | `use-progress-page.ts:251-258` | WVR | inline `effectiveWeightKg` |
| — | `presentSessionVolumeChart` | `progress-page-math.ts:537-586` | — | **REMOVED** |

After this, every volume number flows through `effectiveWeightKg`; the single-kernel invariant holds.

## Regression contract (for the Tester — Discovery #5)

- **Invariant A:** for any exercise whose `equipment !== "bodyweight"`, EVERY volume readout (surfaces 1-13) is byte-for-byte identical to baseline. Provable: the only new branch is `equipment === "bodyweight"`; for all else `effectiveWeightKg` returns `addedLoad` and the guard `effective > 0` ≡ `addedLoad > 0` ≡ the old `w > 0`.
- **Invariant B:** for a `bodyweight` exercise, volume becomes `(bw + addedLoad) * reps`. PRs/max for such exercises CAN appear/disappear and max-volume numbers shift — assert one create + one erase case in unit tests.
- **e2e audit (F-4):** the Tester MUST grep each of `soft-deleted-session-volume-leak.spec.ts`, `session-total-volume-header.spec.ts`, `end-of-session-verdict.spec.ts`, `volume-target.spec.ts`, `progress-page.spec.ts`, `weekly-volume-strip.spec.ts`, `max-volume-window.spec.ts`, `chart-scroll-week-selector.spec.ts` for any `bodyweight`/pull-up/dip exercise pick. Expectation (per F-4): all use barbell/explicit weights → numbers don't move. If any uses a bodyweight exercise, its expected numbers shift and the spec must add a measurement fixture.

## Riscos

- **Data integrity (R-1, MEDIUM/MEDIUM).** `exercises!inner(equipment)` join in `stats.ts` could drop rows if a set referenced an exercise the RLS hides. Mitigation: every set is owned by the user and references an exercise visible via the canonical-or-owned RLS; `!inner` is safe. Verify in the e2e smoke that lifetime row count is unchanged.
- **Data integrity (R-2, HIGH/MEDIUM).** Retroactive PR/max shifts for bodyweight exercises (the whole point). Mitigation: Regression contract Invariants A/B + unit create/erase cases. This is intended, not a defect, but it is irreversible-looking to the user (a past "PR" badge may vanish) — acceptable per owner Decision (a).
- **UX regression (R-3, MEDIUM/LOW).** `currentWeightKg`/`repsToBeat` on `<VolumeTargetSlot>` for a bodyweight exercise: with `addedLoad=0` the effective current weight = bodyweight, so "≈ N reps @ {bodyweight} kg" reads correctly. Verify the copy isn't misleading (it shows bodyweight as the weight — correct). No regression for weighted exercises.
- **UX regression (R-4, LOW/LOW).** Removing the per-session chart removes a surface the user had. Owner explicitly asked for removal; the new chart supersedes it.
- **Platform (R-5, LOW/LOW).** `<MultiSeriesChart>` is `react-native-svg` like `<ProgressChart>` — same web+native path, width via `Dimensions`/`useWindowDimensions`. No iOS/Android divergence. Verify the 7-color legend wraps on narrow widths.
- **Performance (R-6, LOW/LOW).** `bodyweightKgAsOf` is O(M) per session (M = measurement count, small). Memoising per `session_id` inside each kernel keeps total cost O(N + S·M) where S = sessions; same class as today's O(N). `presentWeeklyVolumeByMuscle` is O(N + W·G). No SQL change beyond the join.
- **Correctness (R-7, MEDIUM/MEDIUM).** Admin session-detail (`admin/index.tsx:394`) shows OTHER users' sessions — the admin's own measurements are the wrong bodyweight. DECISION: admin total passes NO bodyweight input → stays non-bodyweight (today's number). Documented in the file-change row; it's a debug surface. Validator: confirm this is acceptable or flag.
- **Correctness (R-8, MEDIUM/LOW).** Timezone: `bodyweightKgAsOf` compares UTC instants (`parseISO(...).getTime()`), NO local-day rounding — matches Discovery's "nearest prior weigh-in" rule (`discovery.md:110`). ISO-week bucketing stays device-local (unchanged).

## Alternativas descartadas

1. **Resolve bodyweight at the API layer** (compute effective weight server-side / materialise it on `WeeklyVolumeRow`) — descartada porque there is no FK between sets and measurements; a temporal lateral join in PostgREST is brittle and not reusable by the `SetRow` pipeline; keeping the arithmetic in one pure TS helper is testable and shared.
2. **Single flat `bodyweightKg: number` for all kernels** — descartada porque the `WeeklyVolumeRow` kernels are multi-session (F-2); one number can't be correct across sessions. The per-row resolver (memoised per `session_id`) is required there; the flat number is correct ONLY for the single-session `SetRow` callers (F-1).
3. **Extend `<ProgressChart>` for multi-series** — descartada porque it has 2 single-series callers; coupling them to a `series[]` contract risks regressions for no benefit (Decision #8).
4. **Exclude the "Other" bucket from the chart** — descartada porque it would silently hide volume drops for exercises with empty/unknown primary muscle — the opposite of the chart's purpose (Decision #8).
5. **Prior-only-else-0 fallback** — descartada porque it leaves the bug unfixed for every session before a user's first weigh-in (Decision #2).
6. **Refactor every inline kernel into named functions in `volume-target.ts`** — descartada porque it is scope creep; the bodyweight fix only needs each site to call `effectiveWeightKg`, not to be extracted (Decision #9).
7. **Make the new chart honor `max_volume_window_weeks`** — descartada porque it's a trend viz, not a PR/Max surface (Decision #3).
8. **Bodyweight-aware admin totals** — descartada porque admin views other users' sessions and the admin's own bodyweight is the wrong number (R-7).

## Out of scope

- Bodyweight leverage factors (push-up ≈ 0.64 BW) — deferred (`features.md:7`); full-BW approximation only.
- Secondary-muscle fractional attribution — deferred (`features.md:8`); primary-only `muscles[0]`.
- e1RM strength chart + favorites — deferred (`features.md:5-6`). e1RM stays computed from logged weight (NOT bodyweight-adjusted) — making e1RM bodyweight-aware is a separate strength-semantics question.
- "Hard sets per muscle/week" dose metric — deferred (`features.md:9`).
- A chart-local window selector for the per-muscle chart — easy future add (presenter takes `now`); not requested.
- Editing/backfilling bodyweight history or prompting weigh-ins — read whatever exists.
- Bodyweight-aware admin session totals (R-7).
- Extracting the per-exercise / `useExercisesThisWeek` inline reduces into named functions.
</content>
</invoke>
