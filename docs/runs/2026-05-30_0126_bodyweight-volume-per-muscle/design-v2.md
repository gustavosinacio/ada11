# Design v2 — 2026-05-30_0126_bodyweight-volume-per-muscle

## Diff vs v1 (every Validator issue → resolution pointer)

| Validator issue | Severity | Resolved in | One-line resolution |
|---|---|---|---|
| MAJ-1 — 14th kernel site `history/week/[isoWeek].tsx:82-93` (`weekVolumeKg`) missed | major | Kernel-site inventory row 14; wiring table; `Approach`; re-grep proof | Route `weekVolumeKg` through `effectiveWeightKg` + per-session `bodyweightKgAsOf`; mount `useMeasurements`; `avgVolumePerSession` inherits the fix. |
| MAJ-2 — e1RM and volume share one `const w` | major | `Contratos > per-exercise progress screen`; inventory row 10; Out-of-scope | Two-variable split: `w` (logged) drives `epley1RM` under `w>0`; separate `effW` (effective) drives `sessionVolume`/`maxVolumeKg` under `effW>0`; guards intentionally diverge for bodyweight sets. |
| MIN-1 — `computeVolumeTarget` has THREE spots, not one | minor | `Contratos > computeVolumeTarget`; inventory row 3 | Selection gate (`:178-179`), displayed `currentWeightKg` (`:184-186`), and `repsToBeat` denominator (`:187-190`) ALL use `effectiveWeightKg`. |
| MIN-2 — F-4 reason wrong ("fixtures use barbell") | minor | F-4; Regression contract e2e audit | Restated: the invariant is "no volume e2e spec seeds a `measurement_entries` row AND every seeded set carries explicit positive `weight`" → `bodyweightKgAsOf → null → effective = addedLoad`. Tester audits those two conditions. |
| MIN-3 — over-specified `equipmentByExerciseId` for WVR hooks | minor | Wiring table (`use-progress-page.ts` row); F-3 | WVR hooks take ONLY `WeeklyBodyweightInput = { measurements }` (equipment arrives on the widened row); the `equipmentByExerciseId` map is needed only on the `SetRow`/`SessionSets` path + the muscle-join. |
| MIN-4 — `RowInput`/`buildRow` fixture migration | minor | Tests table; `Contratos > test-fixture migration` | Add `exercises?` to the `RowInput`/`Omit` types; default `exercises: { equipment: "barbell" }` in `buildRow`/`mkRow`/verdict fixtures so existing assertions stay green. |
| MIN-5 — per-set-sum invariant not a regression assertion | minor | Regression contract Invariant C | Tester asserts `sum(presentSetVolumeLines) === sumPastVolume` for a bodyweight exercise (both receive identical `equipment` + `bodyweightKg`). |

Everything the Validator verified SOLID in v1 (F-1 single-session enumeration; the `effective > 0` byte-identity; `!inner(equipment)` safety; `bodyweightKgAsOf` prior→later→null + order-independence; the fallback rule; the plumbing seam; the Phase-1 chart decisions; F-5 removal; R-7 admin trade-off) is carried forward unchanged below.

## Goal (1 sentence)
Make the canonical volume kernel bodyweight-aware on EVERY surface (Phase 0), and add a weekly per-muscle multi-line chart while removing the per-session chart (Phase 1).

## Approach

Phase 0 introduces ONE pure helper — `effectiveWeightKg(equipment, weight, bodyweightKg)` — that replaces the bare `parseFloat(weight)` step in all **14** kernel sites, plus ONE pure resolver — `bodyweightKgAsOf(measurements, instantMs)` — that turns the measurement timeline into a per-session bodyweight. Both are threaded as **optional inputs** so that when absent the kernels reproduce byte-for-byte the pre-feature numbers (the `windowStartMs?` precedent at `volume-target.ts:138,146-148` / `progress-page-math.ts:43,47-49`). Two data pipelines exist after this: the `WeeklyVolumeRow[]` pipeline (surfaces 1,2,5,6,14 + the week drill-down headline) gets `equipment` from a **widened `stats.ts` SELECT** (`exercises!inner(equipment)`), and resolves bodyweight **per-row** via `row.sessions.started_at` (each row already carries it); the `SetRow`/`SessionSets` pipelines (surfaces 3,4,8,9,10,11,13) are **all single-session at the call site** (F-1, verified below), so they get equipment from a per-exercise map built off `useAllExercises` (already in scope or one cheap hook away) and a **single** `bodyweightKgAsOf` resolved once per session from the session's `started_at`.

Why this seam over alternatives: widening the SELECT touches one query and 6 `WeeklyVolumeRow`-driven sites (4 multi-session kernels + the week-headline reduce + the new chart) inherit `equipment` for free, lower blast radius than threading a `useAllExercises` join into 6 separate surfaces (Discovery #1c). The single `effectiveWeightKg` helper makes the "same number everywhere" invariant *real* (centralised arithmetic) rather than merely documented. The optional-param design means non-bodyweight numbers are provably unchanged because the only new code path is `equipment === "bodyweight"`.

**MAJ-1 fix (the missed 14th site).** `app/(app)/history/week/[isoWeek].tsx:82-93` computes `weekVolumeKg` with its own inline `const w = row.weight ? parseFloat(row.weight) : 0; ... if (Number.isFinite(w) && w>0 && r>0) vol += w*r;` over the lifetime `WeeklyVolumeRow[]` (`weeklyVolumeQ.data`, mounted `:53`). This headline ALSO feeds `avgVolumePerSession` (`:107-108`, displayed at `:163` "Total volume" and `:172` "Avg per session"). The SAME screen already shows per-session row totals via `groupSessionVolumes(weeklyVolumeQ.data)` (`:98-101`, inventory site 7), which IS fixed — so leaving `weekVolumeKg` inline-and-unfixed makes the screen's own headline diverge from its own per-session rows for a bodyweight exercise, AND from the weekly strip bar and the new chart. Fix: route the `w` extraction through `effectiveWeightKg(row.exercises.equipment, row.weight, bw)` where `bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at).getTime())`, memoised per `session_id` via a `Map<string, number | null>` inside the `useMemo`. Mount `useMeasurements` on the screen and add `measurements` to the `weekVolumeKg` `useMemo` deps. `avgVolumePerSession` needs no separate change — it divides the now-corrected `weekVolumeKg` by `endedSessionsCount`.

Phase 1 adds a new `<MultiSeriesChart>` (not an extension of `<ProgressChart>`, to protect its 2 single-series callers) fed by a new presenter `presentWeeklyVolumeByMuscle(...)` that buckets the (already bodyweight-aware) `WeeklyVolumeRow[]` by ISO week × `muscles[0]`, zero-filled across a shared contiguous week axis, with 7 fixed colors and client-state check-all/uncheck-all. It is a TREND viz: it does NOT honor `max_volume_window_weeks` (Discovery #3).

## Verified facts that shaped the design (beyond Discovery)

- **F-1 (load-bearing, Validator-verified).** `SetRow` does NOT carry `sessions.started_at` (`db/types.ts:210-226`). Every `sumLiveVolume(SetRow[])` / `sumPastVolume(SetRow[])` call site is **single-session**: live header `workout/[sessionId].tsx:91-94`, verdict total `verdict/[sessionId].tsx:54`, history detail `history/[id].tsx:133`, `computeCurrentSessionVolumeByExercise` `session-verdict-math.ts:33-48` (groups ONE session's sets by exercise, verified `:36-41`), `computeVolumeTarget` (`volume-target.ts:150` inside a per-past-session loop + `:162` the live session), `presentExerciseSessionRow`/`presentSetVolumeLines` (one session group), `admin/index.tsx:394` (one session). → the `SetRow` pipeline can take a **single** `bodyweightKg: number | null` per call. The per-exercise-progress screen reduces `SessionSets[]` (multi-session) but iterates session-by-session (`progress.tsx:133`), so it resolves bodyweight per `s.started_at` inside the loop. (Validator independently re-grepped all callers and confirmed F-1 holds.)
- **F-2.** `groupSessionVolumes` / `bucketLifetimeWeeklyVolumes` / `computeCurrentWeekVolume` / `computeLifetimeMaxPerExercise` / `computePrsThisWeek` are **multi-session** and each `WeeklyVolumeRow` carries `sessions.started_at` (`stats.ts:25`). The `weekVolumeKg` reduce on the week drill-down (`history/week/[isoWeek].tsx:82-93`) is ALSO multi-session over `WeeklyVolumeRow[]`. → all of these resolve bodyweight **per-row** (memoised per `session_id`).
- **F-3.** `listAllExercises` is `select("*")` (`exercises.ts:36-44`) → `equipment` + `muscles` already load via `useAllExercises`. No new fetch for the exercise→equipment/muscle map.
- **F-4 (restated per MIN-2 — Validator-corrected).** The reason existing volume-assertion e2e numbers do NOT move is NOT "fixtures use barbell." It is the conjunction of TWO conditions: (i) **no** volume e2e spec seeds a `measurement_entries` row (grep of all 8 volume specs = 0 measurement rows), AND (ii) every seeded set carries an explicit **positive** `weight` (`seedFinishedSession` always inserts a positive `weight`, `progress-page.spec.ts:107-118`). Given those, for ANY exercise (even a bodyweight one) `bodyweightKgAsOf → null` (no measurements) → `effectiveWeightKg → addedLoad = the explicit positive weight` → numbers don't move. This matters because 4 specs (`progress-page.spec.ts:70`, `weekly-volume-strip.spec.ts:75`, `max-volume-window.spec.ts:72`, `chart-scroll-week-selector.spec.ts:78`) call `pickCanonicalExercise(admin)` with NO preferred name → take the alphabetically-first canonical row, which COULD be a bodyweight catalog row (Pull-up/Chin-up/Dip/Push-up/Plank/Hanging Leg Raise per `0001_rls_and_seed.sql:70-91`). So the Tester must audit the TWO conditions above, not the exercise type. (See Regression contract e2e audit.)
- **F-5 (Validator-verified).** `presentSessionVolumeChart` has NO unit test (grep of `tests/` = 0; the `progress-page-math.test.ts` describe inventory has no block for it). Removal deletes no test. The progress-page e2e does NOT assert the per-session chart. Removal is clean.
- **F-6 (Validator-verified).** `useFinishSession` invalidates `["stats"]`+`["progress"]` but NOT `["measurements"]` (`use-sessions.ts:103-109`). Acceptable: a finished session does not create a weigh-in, and `useMeasurements` has no `staleTime` (refetch on mount, `use-measurements.ts:17-22`). No invalidation change needed.

## Mudanças por arquivo

### Phase 0 — new pure helpers
| File | Type | Change |
|---|---|---|
| `src/utils/bodyweight.ts` | new | Two pure functions: `effectiveWeightKg(equipment, weight, bodyweightKg)` and `bodyweightKgAsOf(measurements, instantMs)`. No React, no I/O — unit-testable under vitest. Single responsibility: bodyweight-as-load arithmetic + as-of-session resolution. |

### Phase 0 — data plumbing (one query change)
| File | Type | Change |
|---|---|---|
| `src/api/stats.ts` | edited | Widen `SELECT` (`:28-29`) to `... exercise_id, session_id, exercises!inner(equipment), sessions!inner(started_at, ended_at)`. Add `exercises: { equipment: string }` to `WeeklyVolumeRow` (`:18-26`). Single responsibility: carry equipment into the row. (`equipment` typed `string` not `Equipment` — legacy user rows may hold arbitrary strings, `db/types.ts:108-118`; the `=== "bodyweight"` test in `effectiveWeightKg` is the canonical gate.) |

### Phase 0 — kernel sites (route `w` through `effectiveWeightKg`; add optional bodyweight inputs)
| File | Type | Change |
|---|---|---|
| `src/utils/volume-target.ts` | edited | `sumPastVolume` (`:74-85`) + `sumLiveVolume` (`:100-114`) gain optional `bw?: SetBodyweightInput`. `computeVolumeTarget` (`:135-201`) gains `bodyweight?` (see contract) and passes per-session bw into `sumPastVolume` (`:150`), the live bw into `sumLiveVolume` (`:162`), and uses `effectiveWeightKg` in **all three** current-weight spots — the selection gate (`:178-179`), the displayed `currentWeightKg` (`:184-186`), and the `repsToBeat` denominator (`:187-190`). See MIN-1 in contract. |
| `src/utils/progress-page-math.ts` | edited | `bucketLifetimeWeeklyVolumes` (`:41-59`, `w*r` at `:52-55`), `computeCurrentWeekVolume` (`:143-158`), `computeLifetimeMaxPerExercise` (`:183-222`), `computePrsThisWeek` (`:306-393`) each gain optional `bodyweight?: WeeklyBodyweightInput` and replace the inline `row.weight ? parseFloat(row.weight) : 0` with `effectiveWeightKg(row.exercises.equipment, row.weight, bw)` where `bw` is resolved per-row from `row.sessions.started_at`, memoised per `session_id`. `groupSessionVolumes` (`:251-265`) gains the same optional input and passes a per-row resolver into `sumLiveVolume`. **REMOVE** `presentSessionVolumeChart` (`:537-586`). |
| `src/utils/weekly-volume-strip-math.ts` | edited | `computeStripModel` (`:47-92`) — the easy-to-miss 4th inline kernel — gains optional `bodyweight?: WeeklyBodyweightInput`; replace `row.weight ? parseFloat(row.weight) : 0` (`:72-76`) with `effectiveWeightKg(row.exercises.equipment, row.weight, bwForRow)`, bw memoised per `session_id`. |
| `src/utils/exercise-session-row-format.ts` | edited | `presentExerciseSessionRow` (`:48-62`) + `presentSetVolumeLines` (`:89-112`) gain optional `bodyweightKg?: number | null` + `equipment?: string`; the `w*r` at `:98-101` (and `sumPastVolume` delegation at `:55`) become bodyweight-aware via `effectiveWeightKg(equipment, s.weight, bodyweightKg)`. The per-set-sum invariant documented at `:71-73` is preserved because BOTH functions receive the identical `equipment` + `bodyweightKg` (Regression Invariant C). |
| `src/utils/session-verdict-math.ts` | edited | `computeCurrentSessionVolumeByExercise` (`:33-48`) gains optional `bw?: SetBodyweightInput`; passes it into `sumLiveVolume` per exercise group (single session — F-1). `computePrsForSession` (`:82-133`) passes its `bodyweight?` straight through to `computeLifetimeMaxPerExercise`. |

### Phase 0 — inline-reduce site (per-exercise progress screen) — MAJ-2 fix
| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/[id]/progress.tsx` | edited | The inline `useMemo` reduce (`:138-147`) is split into TWO variables (see `Contratos`): keep `const w = set.weight ? parseFloat(set.weight) : 0` driving `epley1RM(w, r)` under the UNCHANGED guard `w > 0` (e1RM stays logged-weight, OUT OF SCOPE for bodyweight); add `const effW = effectiveWeightKg(exercise.data?.equipment, set.weight, bw)` driving `sessionVolume += effW * r` and `maxVolumeKg`/`maxVolumeSession` (`:154-168`) under its own guard `effW > 0`, where `bw = bodyweightKgAsOf(measurements, parseISO(s.started_at).getTime())`. Mount `useMeasurements`; add `measurements` to the `useMemo` deps. |

### Phase 0 — week drill-down headline (MAJ-1 fix — the missed 14th site)
| File | Type | Change |
|---|---|---|
| `app/(app)/history/week/[isoWeek].tsx` | edited | The inline `weekVolumeKg` reduce (`:82-93`, `w*r` at `:90`) replaces `const w = row.weight ? parseFloat(row.weight) : 0` with `effectiveWeightKg(row.exercises.equipment, row.weight, bw)` where `bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at).getTime())`, memoised per `session_id` via a `Map<string, number | null>` inside the `useMemo`. Mount `useMeasurements` (alongside the existing `useLifetimeWeeklyVolume` `:53`); add `measurements` to the `weekVolumeKg` `useMemo` deps (`:93`). `avgVolumePerSession` (`:107-108`) inherits the fix automatically (it divides the corrected `weekVolumeKg`). NOTE: `groupSessionVolumes(weeklyVolumeQ.data)` (`:98-101`) on the same screen also becomes bodyweight-aware via the `progress-page-math.ts` change — but it needs the same `{ measurements }` input passed in (see wiring table). |

### Phase 0 — surfaces that must pass the new inputs (call-site wiring)
| File | Type | What it passes / mounts |
|---|---|---|
| `app/(app)/workout/[sessionId].tsx` | edited | `:91-94` — `sumLiveVolume(setsQ.data ?? [])` → pass `SetBodyweightInput` = `{ equipmentByExerciseId (from useAllExercises), bodyweightKg: bodyweightKgAsOf(measurements, parseISO(session.data.started_at).getTime()) }`. Mount `useMeasurements` + `useAllExercises`. |
| `app/(app)/workout/verdict/[sessionId].tsx` | edited | `:54` total + `computeCurrentSessionVolumeByExercise` + `computePrsForSession`: pass `equipmentByExerciseId` (from `useAllExercises`, already mounted `:45`) + `bodyweightKgAsOf(measurements, parseISO(session.started_at).getTime())`; for `computePrsForSession`, also pass `{ measurements }` (the lifetime-max walk is multi-session). Mount `useMeasurements`. |
| `app/(app)/history/[id].tsx` | edited | `:133` `sumLiveVolume(rows)`: pass `{ equipmentByExerciseId (mount useAllExercises), bodyweightKg: bodyweightKgAsOf(measurements, parseISO(session.started_at).getTime()) }` (mount `useMeasurements`). |
| `app/(app)/admin/index.tsx` | edited | `:394` admin session-detail total: pass NO bodyweight input → stays non-bodyweight (today's number). The admin views OTHER users' sessions, so the admin's own bodyweight is the wrong number (R-7). Debug surface, not a user-facing volume claim. |
| `src/components/volume-target-slot.tsx` | edited | `:49` `computeVolumeTarget(...)`: pass `bodyweight` = `{ equipmentByExerciseId (from the ExerciseRow the parent <ExerciseBlock> holds — thread an equipment lookup or the single exercise's equipment in), liveBodyweightKg (live session started_at), pastBodyweightBySession (Map resolved by caller from each SessionSets.started_at) }`. Mount `useMeasurements`. |
| `src/hooks/use-progress-page.ts` | edited | `useLifetimeBestWeek` / `useCurrentWeekVolume` / `usePrsThisWeek` (`:45-144`): mount `useMeasurements`, pass ONLY `WeeklyBodyweightInput = { measurements }` into the WVR kernels (equipment arrives on the widened row — MIN-3; NO `equipmentByExerciseId` map here). `useExercisesThisWeek` (`:220-334`): the inline `nowKgByExercise` reduce (`:247-258`) is on the WVR pipeline but builds its own per-exercise sums, so it replaces `parseFloat(r.weight)` with `effectiveWeightKg(r.exercises.equipment, r.weight, bodyweightKgAsOf(measurements, parseISO(r.sessions.started_at).getTime()))` (equipment on the widened row); `computeLifetimeMaxPerExercise` here (`:263-266`) takes `{ measurements }`. Mount `useMeasurements`. |
| `src/components/weekly-volume-strip.tsx` | edited | Pass `WeeklyBodyweightInput = { measurements }` into `computeStripModel` (equipment on the widened row — MIN-3). Mount `useMeasurements`. NO `useAllExercises` / `equipmentByExerciseId` needed here. |
| `src/components/exercise-session-row.tsx` | edited | Thread `equipment` + `bodyweightKg` (resolved from the session's `started_at`) into `presentExerciseSessionRow`. Receives `equipment`/`measurements` from the per-exercise progress screen which already has both. |
| `src/components/set-volume-breakdown.tsx` callers | edited | The two callers of `presentSetVolumeLines` (`progress.tsx` Max-volume callout, `volume-target-slot.tsx`) pass `equipment` + the resolved `bodyweightKg` for the relevant session — IDENTICAL values to what `presentExerciseSessionRow` receives, to preserve the per-set-sum invariant (Regression Invariant C). |

**MIN-3 clarification.** The `WeeklyVolumeRow`-driven kernels (`bucketLifetimeWeeklyVolumes`, `computeCurrentWeekVolume`, `computeLifetimeMaxPerExercise`, `computePrsThisWeek`, `computeStripModel`, `groupSessionVolumes`, the `weekVolumeKg` reduce, and the new chart presenter) read `equipment` directly from `row.exercises.equipment` (the widened SELECT) and therefore take ONLY `WeeklyBodyweightInput = { measurements }`. The `equipmentByExerciseId: Map<string, string>` is needed ONLY where the data is `SetRow`/`SessionSets` (no embedded `exercises` join): the `sumLiveVolume`/`sumPastVolume`/`computeVolumeTarget`/`computeCurrentSessionVolumeByExercise` call sites and the muscle-join in the chart presenter (which needs `muscles`, not equipment, from the lib). Do NOT thread `equipmentByExerciseId` into the WVR hooks.

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
| `app/(app)/progress/index.tsx` | edited | Remove `<SessionVolumeChartSection />` import (`:6`) + mount (`:70`); add `<WeeklyMuscleVolumeSection />` in the same slot (between `<WeeklyVolumeStrip>` `:66-69` and `<ExercisesThisWeekList>` `:71`). |

### Tests
| File | Type | Change |
|---|---|---|
| `tests/unit/bodyweight.test.ts` | new | Unit tests for `effectiveWeightKg` (bodyweight addend, weighted pull-up, non-bodyweight passthrough, null/empty/0 weight, legacy `"Bodyweight"` non-trigger) + `bodyweightKgAsOf` (all three fallback branches: prior, later, none→null; null-`weight_kg` skip; DESC-input order independence; exact-instant tie). |
| `tests/unit/weekly-muscle-volume.test.ts` | new | Unit tests for `presentWeeklyVolumeByMuscle` (bucketing, zero-fill, `muscles[0]` attribution, "Other", bodyweight contribution, dangling exercise_id skip, empty input). |
| `tests/unit/volume-target.test.ts` | edited | Add bodyweight cases (bw addend, weighted pull-up, null-bw passthrough) AND the MIN-1 cases: a bodyweight `chasing`/`surpassed` state where `currentWeightKg` reflects the effective bodyweight (not 0) and `repsToBeat` is computed against it. Fixtures building `WeeklyVolumeRow` literals default `exercises: { equipment: "barbell" }` (MIN-4). |
| `tests/unit/weekly-volume-bucketing.test.ts` | edited | MIN-4: add `exercises?` to `RowInput` (`:17`, currently omits `set_type\|exercise_id\|session_id\|sessions` — add `exercises` to the `Omit` and to the optional union) and default `exercises: input.exercises ?? { equipment: "barbell" }` in `buildRow` (`:24-37`); add a bodyweight bucket case. |
| `tests/unit/session-verdict-math.test.ts` | edited | MIN-4: default `exercises: { equipment }` in any `WeeklyVolumeRow` fixture builder. Add a bodyweight-PR creation case + a bodyweight-PR erasure case. |
| `tests/unit/progress-page-math.test.ts` | edited | MIN-4: `mkRow` (`:55-77`) defaults `exercises: { equipment: "barbell" }`. Add bodyweight cases to `bucketLifetimeWeeklyVolumes`/`computeLifetimeMaxPerExercise`/`computePrsThisWeek`; **no** `presentSessionVolumeChart` block exists to delete (F-5). |
| `tests/e2e/weekly-muscle-volume.spec.ts` | new | New chart smoke (renders, lines toggle, check-all/uncheck-all). |
| `docs/features.md` | edited | Move both phases from "## Open" to "## Done"; keep leverage-factors + secondary-muscle deferred entries. |

## Contratos de I/O

### `src/utils/bodyweight.ts`

```ts
import type { MeasurementEntryRow } from "~/db/types";

/**
 * Effective per-set load in kg. The single arithmetic seam for the
 * "same number everywhere" invariant.
 *
 *   - equipment === "bodyweight": effective = (bodyweightKg ?? 0) + addedLoad
 *   - any other equipment (incl. legacy strings, null): effective = addedLoad
 *
 * addedLoad = weight == null ? 0 : parseFloat(weight)  (NaN-safe: a
 * non-finite parse → 0). bodyweightKg is the resolved as-of-session
 * bodyweight or null. The bodyweight addend ONLY fires on the exact canonical
 * token "bodyweight" (Decision #7) — a 0-weight machine set stays 0
 * (Decision #6). Returns a finite number >= 0; never NaN.
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

### Shared bodyweight-input shapes

```ts
// For the WeeklyVolumeRow[] kernels (multi-session). Equipment arrives on
// row.exercises.equipment (widened SELECT), so this carries ONLY measurements.
export type WeeklyBodyweightInput = {
  measurements: MeasurementEntryRow[];
};
// Inside each WVR kernel: resolve bw once per session_id and cache.
//   const bwCache = new Map<string, number | null>();
//   function resolveSessionBw(sessionId, startedAt): number | null {
//     if (bwCache.has(sessionId)) return bwCache.get(sessionId)!;
//     const v = bodyweightKgAsOf(input.measurements, parseISO(startedAt).getTime());
//     bwCache.set(sessionId, v); return v;
//   }

// For the SetRow / single-session kernels (F-1: one session per call).
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

`sumLiveVolume`'s `Pick` gains `"exercise_id"` (already present on both `SetRow` and `WeeklyVolumeRow`, verified `db/types.ts:214` / `stats.ts:23`) so the equipment lookup works for both shapes without a cast. **When `bw` is `undefined`, both functions execute the exact pre-feature predicate** (`w = weight ? parseFloat(weight) : NaN; if (Number.isFinite(w) && w>0 && r>0) total += w*r`) — byte-for-byte (Decision #6/#9, the `windowStartMs?` precedent). When `bw` is provided, `w = effectiveWeightKg(bw.equipmentByExerciseId.get(set.exercise_id), set.weight, bw.bodyweightKg)` and the guard becomes `effective > 0 && r > 0` — byte-identical for non-bodyweight (Validator-verified Invariant A).

### `computeVolumeTarget` signature delta (MIN-1 — all THREE spots)

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
    /** session_id → bodyweight-as-of for past sessions (resolved by the caller
     *  from each SessionSets.started_at). */
    pastBodyweightBySession: Map<string, number | null>;
  };
};
```

`computeVolumeTarget` body changes — when `bodyweight` is provided:
- `previousMaxKg` loop (`:142-155`): `sumPastVolume(session.sets, { equipmentByExerciseId, bodyweightKg: pastBodyweightBySession.get(session.id) ?? null })`.
- `runningKg` (`:162`): `sumLiveVolume(currentSessionSets, { equipmentByExerciseId, bodyweightKg: liveBodyweightKg })`.
- **The three current-weight spots, all consistently (MIN-1):**
  1. **Selection gate** (`:177-182`, currently `const w = s.weight ? parseFloat(s.weight) : NaN; if (!Number.isFinite(w) || w <= 0) return best;`): replace `w` with `effectiveWeightKg(equipmentByExerciseId.get(s.exercise_id), s.weight, liveBodyweightKg)` so a bodyweight set with `addedLoad=0` still qualifies as a candidate "current set."
  2. **Displayed `currentWeightKg`** (`:184-186`, currently `currentSet ? parseFloat(currentSet.weight) : null`): replace with `currentSet ? effectiveWeightKg(equipmentByExerciseId.get(currentSet.exercise_id), currentSet.weight, liveBodyweightKg) : null` so a Pull-up shows its effective bodyweight, NOT 0.
  3. **`repsToBeat` denominator** (`:187-190`): `currentWeightKg` is now the effective weight, so `gapKg / currentWeightKg` is correct; the `currentWeightKg != null && currentWeightKg > 0` guard holds because effective bodyweight > 0.

When `bodyweight` is `undefined`, all three spots execute the exact current code (logged weight) — byte-for-byte unchanged.

### Per-exercise progress screen — two-variable split (MAJ-2)

The inline `useMemo` reduce at `app/(app)/exercises/[id]/progress.tsx:138-147` is currently:

```ts
for (const set of s.sets) {
  if (set.set_type === "warmup") continue;
  const w = set.weight ? parseFloat(set.weight) : 0;   // :140 — ONE variable
  const r = set.reps ?? 0;
  if (w > 0 && r > 0) {                                  // :142 — ONE guard
    const est = epley1RM(w, r);                          // :143 — e1RM
    if (est > sessionBestE1rm) sessionBestE1rm = est;
    sessionVolume += w * r;                              // :145 — volume
  }
}
```

This shares a single `const w` and a single guard between e1RM (`:143`) and volume (`:145`). v1's instruction ("replace `const w = ...`") would have fed effective bodyweight into `epley1RM` and changed its inclusion guard — silently making e1RM bodyweight-aware, which is OUT OF SCOPE. The v2 split:

```ts
// Resolve once per session (outside the set loop):
const bw = bodyweightKgAsOf(measurements, parseISO(s.started_at).getTime());

for (const set of s.sets) {
  if (set.set_type === "warmup") continue;
  const r = set.reps ?? 0;

  // e1RM — logged weight ONLY, guard UNCHANGED (out of scope for bodyweight).
  const w = set.weight ? parseFloat(set.weight) : 0;
  if (w > 0 && r > 0) {
    const est = epley1RM(w, r);
    if (est > sessionBestE1rm) sessionBestE1rm = est;
  }

  // Volume — effective (bodyweight-aware) weight, separate guard.
  const effW = effectiveWeightKg(exercise.data?.equipment, set.weight, bw);
  if (effW > 0 && r > 0) {
    sessionVolume += effW * r;
  }
}
```

**The guards intentionally diverge for a bodyweight set.** A Pull-up logged `weight=0` with `bw>0`:
- `w = 0` → `w > 0` is false → produces **NO e1RM point** (e1RM(0, reps) would be meaningless; e1RM stays a logged-weight strength metric).
- `effW = bw + 0 > 0` → `effW > 0` is true → produces a **volume point** of `bw * reps`.

The downstream `maxVolumeKg`/`maxVolumeSession` computation (`:154-168`) uses `sessionVolume` (now effective), so the "Max volume session" callout is consistent with the volume trend chart and the live `<VolumeTargetSlot>` "Max." The `sessionBestE1rm > 0` gate (`:149`) and the e1RM chart (`e1rmData`) are unchanged. For a non-bodyweight set, `effW === w`, so both guards fire identically and the numbers are byte-for-byte unchanged.

Mount `useMeasurements` on the screen; add `measurements` to the `useMemo` deps (`:179`). `exercise.data?.equipment` is already in scope (`useAllExercise(id)` loads the single exercise — surface 8 in Discovery's table).

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

RLS: `exercises` is already RLS-readable to the owner (`user_id is null or auth.uid()=user_id`, `0011_rls...:29-30`, no `deleted_at` filter). FK `sets_exercise_id_exercises_id_fk ... ON DELETE restrict` (`0000_schema.sql:88`) proves no set can reference a hard-deleted exercise. `!inner` is provably row-preserving (Validator-strengthened). No new RLS, no migration (Discovery #7).

### Test-fixture migration (MIN-4)

Making `WeeklyVolumeRow.exercises` a required field breaks every fixture that builds a `WeeklyVolumeRow` literal:

- `tests/unit/weekly-volume-bucketing.test.ts` — `RowInput` (`:17`) currently `Omit<WeeklyVolumeRow, "set_type" | "exercise_id" | "session_id" | "sessions">`. Add `exercises` to the `Omit` list AND to the optional-field union (`exercises?: { equipment: string }`). `buildRow` (`:24-37`) adds `exercises: input.exercises ?? { equipment: "barbell" }` to the returned literal.
- `tests/unit/progress-page-math.test.ts` — `mkRow` (`:55-77`): same default `exercises: { equipment: "barbell" }`.
- `tests/unit/session-verdict-math.test.ts` — any `WeeklyVolumeRow` fixture builder: same default.

With `"barbell"` defaults, `effectiveWeightKg` returns `addedLoad` for every existing fixture → all existing assertions stay green. Bodyweight cases explicitly construct `exercises: { equipment: "bodyweight" }` + a measurements timeline.

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
 *   memoised per session_id. (Equipment read from the lib here since the
 *   presenter already joins lib for muscles; equivalent to row.exercises.equipment.)
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

Y-domain spans `max` across ALL **visible** series (min pinned to 0 — volume is non-negative, so 0-baseline reads honestly). One `<Polyline>` per visible series colored by `series.color`; dots per point. X positions derived from the shared `xLabels.length` (index spacing), so a muscle that is 0 in week W still aligns to W's x (zero point, not a gap — Decision #4). Renders an empty-state when no series is visible or all values are 0. Defines its 1-week behavior explicitly: with a single week (`xLabels.length === 1`) render a single dot per visible series (do NOT return null the way `<ProgressChart>` does at `<2` points, `progress-chart.tsx:32`) so the chart is not blank for a user in their first training week.

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

**#1 — Plumbing seam.** DECISION: single `effectiveWeightKg` helper + `bodyweightKgAsOf` resolver. `WeeklyVolumeRow` pipeline gets `equipment` via a widened `stats.ts` SELECT (`exercises!inner(equipment)`) and resolves bw per-row from `row.sessions.started_at`. `SetRow`/`SessionSets` pipelines get equipment from an `equipmentByExerciseId` Map (built off `useAllExercises`, F-3) and a single per-session `bodyweightKg` (F-1 proves they're all single-session). RATIONALE: one query touched; the WVR-driven sites inherit equipment for free; the helper centralises the arithmetic so the invariant is real. REJECTED: client-side `useAllExercises` join threaded into all WVR surfaces — more wiring points vs 1 SELECT, higher blast radius (Discovery #1c). REJECTED: server-side bodyweight resolution via a SQL lateral join on `measurement_entries` — no FK, temporal join is awkward in PostgREST and would not be reusable by the `SetRow` pipeline. (Validator verified this seam SOLID.)

**#2 — Bodyweight fallback (central correctness).** DECISION: (1) nearest PRIOR finite `weight_kg`; (2) else nearest LATER finite `weight_kg`; (3) else `null` → contribution 0 (no NaN). For a `bodyweight` set with `addedLoad=0` and `null` bw, effective = 0 → contributes 0 = today's behavior. RATIONALE: prior-first is the honest "what did I weigh then"; later-fallback rescues early sessions before the first weigh-in; null→0 guarantees no silent NaN and means a measurement-less user sees exactly today's numbers (safe degrade). REJECTED: prior-only-else-0 — leaves the bug unfixed for everyone before their first weigh-in. REJECTED: nearest-by-absolute-distance — back-dates today's bodyweight onto years-old sessions; prior-priority avoids that. (Validator verified prior→later→null + order-independence SOLID.)

**#3 — Honor `max_volume_window_weeks`?** DECISION: NO. The per-muscle chart is a full-history trend viz (its job is "make a silent weekly drop visible," prompt `state.md:23`). RATIONALE: PR/Max surfaces honor the pref; trend charts deliberately do not (`exercises/[id]/progress.tsx:29-31`). REJECTED: a chart-local 12/26/52/all selector — adds chrome the owner didn't ask for; deferred to Out of scope (presenter already takes `now`). (Validator verified SOLID.)

**#4 — Zero/untrained weeks.** DECISION: zero-fill across a shared contiguous week axis (first-trained Monday → current Monday), zero point (not a gap). RATIONALE: mirrors `computeStripModel` zero-fill; a drop to zero is the signal the owner wants; all 7 lines share one axis. REJECTED: per-series gap — `<ProgressChart>` has no gap concept and a gap hides the very drop the chart exists to surface. (Validator verified SOLID.)

**#5 — Retroactive PR/max blast radius.** DECISION: documented as the Regression contract (below). Invariant: non-bodyweight numbers byte-for-byte unchanged; bodyweight PRs/max change as expected. RATIONALE/VERIFICATION: F-4 (restated per MIN-2) — no e2e spec seeds measurements + every seeded set has explicit positive weight, so `bodyweightKgAsOf → null → effective = addedLoad`; the Tester must audit those TWO conditions per spec. REJECTED: scoping the kernel change to only the new chart — forbidden by the owner's pre-confirmed Decision (a).

**#6 — `addedLoadKg` for non-bodyweight `weight=0`.** DECISION: only `equipment === "bodyweight"` gets the addend; every other equipment keeps the `w>0` guard. A 0-weight machine set stays 0. The predicate is `effective = effectiveWeightKg(eq, weight, bw); if (effective > 0 && r > 0) total += effective * r`. RATIONALE: preserves today's behavior for non-bodyweight. The `effective > 0` guard is byte-identical to `w > 0` for non-bodyweight because `effective === addedLoad` there (Validator verified across `""`/`"0"`/`null` edge cases). REJECTED: treating any `weight=0` set as bodyweight — would silently inflate sloppy machine logs.

**#7 — Legacy/unknown equipment.** DECISION: exact `=== "bodyweight"` (lowercase canonical, post-0014). Legacy mixed-case "Bodyweight" does NOT trigger. RATIONALE: 0014 normalised canonical rows; owner is sole user; the `Equipment` union is lowercase (`db/types.ts:80-85`). `WeeklyVolumeRow.exercises.equipment` typed `string` (not `Equipment`) to tolerate legacy without a cast. REJECTED: case-insensitive match — over-broad.

**#8 — New component vs extend `<ProgressChart>`.** DECISION: new `<MultiSeriesChart>`. RATIONALE: `<ProgressChart>` is single-series with 2 callers (measurements strip `measurements-progress-strip.tsx:61-67`, per-exercise page `progress.tsx:229-243`); extending it risks regressing both for zero benefit. "Other" bucket GETS an 8th line (gray) only when it has data — the owner cares about total visibility and "Other" can hide a real drop. Check-all/uncheck-all = client state, not persisted. REJECTED: extend `<ProgressChart>` with an optional `series` prop — couples two unrelated render contracts. REJECTED: exclude "Other" — would silently drop volume for exercises with empty/unknown primary muscle, the opposite of the chart's purpose. (Validator verified the new-component choice SOLID.)

**#9 — Refactor `computeStripModel` + per-exercise inline reduce onto the kernel?** DECISION: route BOTH (and all 14 sites) through `effectiveWeightKg`. `computeStripModel` gains the bodyweight input; the per-exercise screen's inline reduce calls `effectiveWeightKg` directly (with the two-variable split of MAJ-2). RATIONALE: the prompt's "canonical kernel" framing requires it. I do NOT extract the per-exercise inline reduce or the `weekVolumeKg` reduce into named functions (out-of-scope churn) — they just adopt the helper. REJECTED: leave them inline-and-unfixed — breaks the invariant at exactly the strip / per-exercise / week-headline surfaces. REJECTED: full extraction of every inline kernel into `volume-target.ts` — scope creep.

## Kernel-site inventory (the "change once" map — all 14 sites routed through `effectiveWeightKg`)

| # | Site | File:line | Pipeline | bw input |
|---|---|---|---|---|
| 1 | `sumPastVolume` | `volume-target.ts:74-85` | SetRow | `SetBodyweightInput?` |
| 2 | `sumLiveVolume` | `volume-target.ts:100-114` | SetRow/WVR | `SetBodyweightInput?` |
| 3 | `computeVolumeTarget` current-weight (3 spots: gate, display, repsToBeat) | `volume-target.ts:177-190` | SetRow | via `bodyweight?` |
| 4 | `bucketLifetimeWeeklyVolumes` | `progress-page-math.ts:52-55` | WVR | `WeeklyBodyweightInput?` |
| 5 | `computeCurrentWeekVolume` | `progress-page-math.ts:151-155` | WVR | `WeeklyBodyweightInput?` |
| 6 | `computeLifetimeMaxPerExercise` | `progress-page-math.ts:191-193` | WVR | `WeeklyBodyweightInput?` |
| 7 | `groupSessionVolumes` (via `sumLiveVolume`) | `progress-page-math.ts:251-265` | WVR | `WeeklyBodyweightInput?` |
| 8 | `computePrsThisWeek` | `progress-page-math.ts:328-330` | WVR | `WeeklyBodyweightInput?` |
| 9 | `computeStripModel` (easy-to-miss) | `weekly-volume-strip-math.ts:72-76` | WVR | `WeeklyBodyweightInput?` |
| 10 | per-exercise inline reduce — VOLUME only via two-var split (MAJ-2); e1RM stays logged-weight | `progress.tsx:138-147` (`effW` line) | SessionSets | inline `effectiveWeightKg` + `bodyweightKgAsOf` |
| 11 | `presentSetVolumeLines` | `exercise-session-row-format.ts:98-101` | SetRow | `equipment?`+`bodyweightKg?` |
| 12 | `presentExerciseSessionRow` (via `sumPastVolume`) | `exercise-session-row-format.ts:55` | SetRow | `equipment?`+`bodyweightKg?` (identical to #11 — Invariant C) |
| 13 | `useExercisesThisWeek` `nowKgByExercise` reduce | `use-progress-page.ts:247-258` | WVR | inline `effectiveWeightKg` (equipment from `row.exercises.equipment`) |
| **14 (NEW)** | **`weekVolumeKg` headline reduce (MAJ-1 — was missed)** | **`history/week/[isoWeek].tsx:82-93` (`w*r` at `:90`)** | **WVR** | **`{ measurements }` + per-row `bodyweightKgAsOf` memoised per session_id; `avgVolumePerSession` `:107-108` inherits** |
| — | `presentSessionVolumeChart` | `progress-page-math.ts:537-586` | — | **REMOVED** (Phase 1) |
| — | `presentWeeklyVolumeByMuscle` (NEW chart presenter) | `weekly-muscle-volume.ts` (new) | WVR | `{ exercises, measurements }` |

After this, every volume number flows through `effectiveWeightKg`; the single-kernel invariant holds.

### Re-grep proof that the inventory is now exhaustive (MAJ-1 close-loop)

I re-walked the kernel patterns (`* r` volume accumulation, `parseFloat(...weight)`, `weight ? parseFloat`) across `app/` and `src/` by reading every site the inventory and the Validator reference, and confirm:

- The Validator's audit found EXACTLY ONE site missing from v1's 13-site inventory — `history/week/[isoWeek].tsx:82-93` (`weekVolumeKg`) — and explicitly stated "I found none beyond this" (`validation-v1.md:31,56`). I independently read `history/week/[isoWeek].tsx:1-216` and confirm: (a) the `weekVolumeKg` reduce at `:82-93` is the inline `w*r` site (now inventory #14); (b) `avgVolumePerSession` (`:107-108`) is NOT a second kernel — it divides `weekVolumeKg` by `endedSessionsCount`, so it inherits the fix; (c) the only other volume read on that screen is `groupSessionVolumes(weeklyVolumeQ.data)` (`:98-101`), already inventory #7. No third kernel on that screen.
- All other `* r` / `parseFloat(...weight)` accumulation sites map 1:1 to inventory rows 1-13. Re-confirmed by reading: `volume-target.ts:135-200` (rows 1-3), `progress-page-math.ts:41-59` (row 4), `:143-158` (row 5), `:183-222` (row 6), `:251-265` (row 7), `:306-393` (row 8), `weekly-volume-strip-math.ts:47-92` (row 9), `progress.tsx:138-147` (row 10), `exercise-session-row-format.ts:48-62,89-112` (rows 11-12), `use-progress-page.ts:247-258` (row 13). `computeCurrentSessionVolumeByExercise` (`session-verdict-math.ts:33-48`) is NOT a separate kernel — it delegates to `sumLiveVolume` (row 2).
- The ONLY remaining `w*r`-shaped site is `presentSessionVolumeChart` (`progress-page-math.ts:537-586`), which is being REMOVED in Phase 1.

**Conclusion: the inventory is exhaustive at 14 active sites (+1 removed + 1 new chart presenter). No 15th site exists.** Confidence HIGH (independently read every site; Validator independently confirmed no 15th).

## Regression contract (for the Tester — Discovery #5)

- **Invariant A (non-bodyweight byte-identity):** for any exercise whose `equipment !== "bodyweight"`, EVERY volume readout (all 14 sites + the new chart) is byte-for-byte identical to baseline. Provable: the only new branch is `equipment === "bodyweight"`; for all else `effectiveWeightKg` returns `addedLoad` and the guard `effective > 0` ≡ `addedLoad > 0` ≡ the old `w > 0` (Validator-verified across `""`/`"0"`/`null`). Tester asserts non-bodyweight unit-test numbers and the 8 e2e volume specs stay green.
- **Invariant B (bodyweight shifts):** for a `bodyweight` exercise, volume becomes `(bw + addedLoad) * reps`. PRs/max for such exercises CAN appear/disappear and max-volume numbers shift — assert one create + one erase case in unit tests (`session-verdict-math.test.ts`, `progress-page-math.test.ts`).
- **Invariant C (per-set-sum holds for bodyweight — MIN-5):** the in-code invariant at `exercise-session-row-format.ts:71-73` — `sum(presentSetVolumeLines.volumeKg) === sumPastVolume(sets)` (equivalently `presentExerciseSessionRow.volumeKg`) — must still hold for a BODYWEIGHT exercise. This holds ONLY if `presentSetVolumeLines` and `presentExerciseSessionRow` (and the `sumPastVolume` it delegates to) receive the IDENTICAL `equipment` + `bodyweightKg`. The wiring passes identical values from the same session resolution (`exercise-session-row.tsx` + `set-volume-breakdown.tsx` callers). Tester adds a unit/e2e assertion: for a bodyweight exercise with a measurement fixture, the per-set lines sum exactly to the session total.
- **Invariant D (per-exercise e1RM vs volume divergence — MAJ-2):** for a Pull-up logged `weight=0`, `bw>0`: the per-exercise progress screen produces a VOLUME point (`bw*reps`) but NO e1RM point. Tester asserts (unit on the extracted logic OR e2e) that the e1RM chart has no point for a 0-weight bodyweight session while the volume chart does.
- **e2e audit (F-4, MIN-2):** the Tester MUST audit each of `soft-deleted-session-volume-leak.spec.ts`, `session-total-volume-header.spec.ts`, `end-of-session-verdict.spec.ts`, `volume-target.spec.ts`, `progress-page.spec.ts`, `weekly-volume-strip.spec.ts`, `max-volume-window.spec.ts`, `chart-scroll-week-selector.spec.ts` for the TWO conditions that keep numbers stable: (i) does the spec seed any `measurement_entries` row? (ii) does every seeded set carry an explicit positive `weight`? If BOTH hold (expected per F-4), numbers don't move regardless of exercise type. If a spec seeds a measurement AND uses a bodyweight pick (e.g. `pickCanonicalExercise(admin)` with no preferred name landing on a bodyweight catalog row), its expected numbers shift and the spec must be updated. The Tester reports the audit result per spec, not an assumption.

## Riscos

- **Data integrity (R-1, MEDIUM/LOW — downgraded after Validator strengthening).** `exercises!inner(equipment)` join in `stats.ts` could in theory drop rows if a set referenced an RLS-hidden exercise. Mitigation: FK `ON DELETE restrict` (`0000_schema.sql:88`) + deleted_at-agnostic exercises RLS (`0011:29-30`) PROVE `!inner` is row-preserving (Validator verified). Verify in the e2e smoke that lifetime row count is unchanged.
- **Data integrity (R-2, HIGH/MEDIUM).** Retroactive PR/max shifts for bodyweight exercises (the whole point). Mitigation: Regression Invariants A/B + unit create/erase cases. Intended, not a defect, but irreversible-looking to the user (a past "PR" badge may vanish) — acceptable per owner Decision (a).
- **UX regression (R-3, MEDIUM/LOW).** `currentWeightKg`/`repsToBeat` on `<VolumeTargetSlot>` for a bodyweight exercise: with `addedLoad=0` the effective current weight = bodyweight, so "≈ N reps @ {bodyweight} kg" reads correctly (MIN-1 ensures all three spots use the effective weight, so `currentWeightKg` is the bodyweight, not 0). Verify the copy isn't misleading. No regression for weighted exercises.
- **UX regression (R-4, MEDIUM/LOW).** MAJ-1 fix changes the week drill-down headline + "Avg per session" for any week containing a bodyweight exercise — this is the intended consistency fix (the headline now matches the per-session rows on the same screen, the strip, and the chart). For weeks with no bodyweight exercise, numbers are unchanged (Invariant A).
- **UX regression (R-5, LOW/LOW).** Removing the per-session chart removes a surface the user had. Owner explicitly asked for removal; the new chart supersedes it.
- **Platform (R-6, LOW/LOW).** `<MultiSeriesChart>` is `react-native-svg` like `<ProgressChart>` — same web+native path, width via `Dimensions`/`useWindowDimensions`. No iOS/Android divergence. Verify the 7-color legend wraps on narrow widths.
- **Performance (R-7, LOW/LOW).** `bodyweightKgAsOf` is O(M) per session (M = measurement count, small). Memoising per `session_id` inside each kernel keeps total cost O(N + S·M) where S = sessions; same class as today's O(N). `presentWeeklyVolumeByMuscle` is O(N + W·G). No SQL change beyond the `!inner` join (no extra round-trips).
- **Correctness (R-8, MEDIUM/MEDIUM — admin trade-off, Validator-accepted).** Admin session-detail (`admin/index.tsx:394`) shows OTHER users' sessions — the admin's own measurements are the wrong bodyweight. DECISION: admin total passes NO bodyweight input → stays non-bodyweight (today's number). It's a debug surface, not a user-facing volume claim. (Validator confirmed acceptable.)
- **Correctness (R-9, MEDIUM/LOW).** Timezone: `bodyweightKgAsOf` compares UTC instants (`parseISO(...).getTime()`), NO local-day rounding — matches Discovery's "nearest prior weigh-in" rule (`discovery.md:110`). ISO-week bucketing stays device-local (unchanged). (Validator verified order-independence + null-skip.)

## Alternativas descartadas

1. **Resolve bodyweight at the API layer** (compute effective weight server-side / materialise on `WeeklyVolumeRow`) — descartada porque there is no FK between sets and measurements; a temporal lateral join in PostgREST is brittle and not reusable by the `SetRow` pipeline; keeping the arithmetic in one pure TS helper is testable and shared.
2. **Single flat `bodyweightKg: number` for all kernels** — descartada porque the `WeeklyVolumeRow` kernels (and the `weekVolumeKg` reduce) are multi-session (F-2); one number can't be correct across sessions. The per-row resolver (memoised per `session_id`) is required there; the flat number is correct ONLY for the single-session `SetRow` callers (F-1).
3. **v1's single-variable `const w` in the per-exercise reduce** — descartada (MAJ-2) porque it would silently make e1RM bodyweight-aware and change the e1RM inclusion guard. The two-variable split keeps e1RM logged-weight while volume is effective-weight.
4. **Leave `weekVolumeKg` inline-and-unfixed** — descartada (MAJ-1) porque the week drill-down headline + "Avg per session" would diverge from the per-session rows on the SAME screen, the strip, and the chart, breaking "same number everywhere."
5. **Extend `<ProgressChart>` for multi-series** — descartada porque it has 2 single-series callers; coupling them to a `series[]` contract risks regressions for no benefit (Decision #8).
6. **Exclude the "Other" bucket from the chart** — descartada porque it would silently hide volume drops for exercises with empty/unknown primary muscle — the opposite of the chart's purpose (Decision #8).
7. **Prior-only-else-0 fallback** — descartada porque it leaves the bug unfixed for every session before a user's first weigh-in (Decision #2).
8. **Thread `equipmentByExerciseId` into the WVR hooks** — descartada (MIN-3) porque the widened SELECT already carries `equipment` on `row.exercises.equipment`; the map is needed only on the `SetRow`/`SessionSets` path + the muscle-join.
9. **Make the new chart honor `max_volume_window_weeks`** — descartada porque it's a trend viz, not a PR/Max surface (Decision #3).
10. **Bodyweight-aware admin totals** — descartada porque admin views other users' sessions and the admin's own bodyweight is the wrong number (R-8).

## Response to Validator issues (v1 no-go)

- **MAJ-1 (RESOLVED).** Added `history/week/[isoWeek].tsx:82-93` as inventory site #14 + a dedicated file-change row + a wiring entry. Routed `weekVolumeKg` through `effectiveWeightKg(row.exercises.equipment, row.weight, bw)` with `bw = bodyweightKgAsOf(measurements, parseISO(row.sessions.started_at).getTime())` memoised per `session_id`; mounted `useMeasurements`; confirmed `avgVolumePerSession` inherits the fix. Re-grepped/re-read every kernel site and proved the inventory is now exhaustive at 14 (see "Re-grep proof"). Independently confirmed no 15th, matching the Validator's finding.
- **MAJ-2 (RESOLVED).** Replaced the single-`w` instruction with an explicit two-variable split in `Contratos > per-exercise progress screen`: `const w` (logged) drives `epley1RM` under the UNCHANGED `w > 0` guard; `const effW = effectiveWeightKg(...)` drives `sessionVolume` and `maxVolumeKg`/`maxVolumeSession` under its own `effW > 0` guard. Stated explicitly that for a bodyweight set (`weight=0`, `bw>0`) the guards diverge: VOLUME point, NO e1RM point (Invariant D).
- **MIN-1 (RESOLVED).** Enumerated all three `computeVolumeTarget` spots — selection gate (`:177-182`), displayed `currentWeightKg` (`:184-186`), `repsToBeat` denominator (`:187-190`) — all route through `effectiveWeightKg` so a Pull-up does not yield `currentWeightKg=0 → repsToBeat=null`.
- **MIN-2 (RESOLVED).** Restated F-4: the invariant is "no volume e2e spec seeds a `measurement_entries` row AND every seeded set carries explicit positive `weight`," not "fixtures use barbell." Tester audits those two conditions per spec (some specs use `pickCanonicalExercise` with no preferred name → could land on a bodyweight catalog row).
- **MIN-3 (RESOLVED).** WVR hooks (`useLifetimeBestWeek`/`useCurrentWeekVolume`/`usePrsThisWeek`) take ONLY `WeeklyBodyweightInput = { measurements }`; `equipmentByExerciseId` is reserved for the `SetRow`/`SessionSets` path + the muscle-join. Wiring prose corrected.
- **MIN-4 (RESOLVED).** Test-fixture migration spelled out: add `exercises?` to the `RowInput`/`Omit` in `weekly-volume-bucketing.test.ts` and default `exercises: { equipment: "barbell" }` in `buildRow`/`mkRow` (`progress-page-math.test.ts`) + the verdict fixtures so existing assertions stay green.
- **MIN-5 (RESOLVED).** Added Regression Invariant C: per-set lines sum to the session total for a bodyweight exercise (both receive identical `equipment` + `bodyweightKg`) — a Tester assertion.

## Out of scope

- Bodyweight leverage factors (push-up ≈ 0.64 BW) — deferred (`features.md`); full-BW approximation only.
- Secondary-muscle fractional attribution — deferred; primary-only `muscles[0]`.
- e1RM strength chart + favorites — deferred. **e1RM stays computed from logged weight (NOT bodyweight-adjusted)** — the MAJ-2 two-variable split enforces this; making e1RM bodyweight-aware is a separate strength-semantics question.
- "Hard sets per muscle/week" dose metric — deferred.
- A chart-local window selector for the per-muscle chart — easy future add (presenter takes `now`); not requested.
- Editing/backfilling bodyweight history or prompting weigh-ins — read whatever exists.
- Bodyweight-aware admin session totals (R-8).
- Extracting the per-exercise / `weekVolumeKg` / `useExercisesThisWeek` inline reduces into named functions — they adopt the helper in place.
