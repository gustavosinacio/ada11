# Implementation — 2026-05-30_0126_bodyweight-volume-per-muscle

Based on: `design-v2.md` (final approved) and `validation-v2.md` (`go`, with the
carry-in MAJ-3-NEW must-fix).

## Files changed

### Phase 0 — bodyweight-aware canonical kernel

- `src/utils/bodyweight.ts` (new) — the two pure helpers: `effectiveWeightKg(equipment, weight, bodyweightKg)` (NaN-safe; addend fires ONLY on exact `=== "bodyweight"`) and `bodyweightKgAsOf(measurements, instantMs)` (prior → later → null fallback, order-independent, null-`weight_kg` skip, exact-instant counts as prior).
- `src/api/stats.ts` (edited) — widened SELECT to `exercises!inner(equipment), sessions!inner(...)`; added `exercises: { equipment: string }` to `WeeklyVolumeRow`.
- `src/utils/volume-target.ts` (edited) — added `SetBodyweightInput` type. Sites 1–3: `sumPastVolume`/`sumLiveVolume` gain `bw?: SetBodyweightInput` (and `sumLiveVolume`'s `Pick` gains `"exercise_id"`); `computeVolumeTarget` gains `bodyweight?` and routes the `previousMaxKg` loop, `runningKg`, and **all three** current-weight spots (selection gate, displayed `currentWeightKg`, `repsToBeat` denominator) through `effectiveWeightKg` (MIN-1).
- `src/utils/progress-page-math.ts` (edited) — added `WeeklyBodyweightInput` + module-private `makeSessionBwResolver` (per-`session_id` memo). Sites 4–8: `bucketLifetimeWeeklyVolumes`, `computeCurrentWeekVolume`, `computeLifetimeMaxPerExercise`, `groupSessionVolumes`, `computePrsThisWeek` (+ `computePrExerciseIdsThisWeek` passthrough) each gain `bodyweight?`. `groupSessionVolumes` does its OWN per-row `effectiveWeightKg(row.exercises.equipment, ...)` reduce (MIN-NEW-1) instead of delegating to `sumLiveVolume`. **Removed** `presentSessionVolumeChart` (F-5) and the now-unused `sumLiveVolume` import.
- `src/utils/weekly-volume-strip-math.ts` (edited) — site 9: `computeStripModel` gains `bodyweight?`; inline per-`session_id`-memoised bw resolver + `effectiveWeightKg`.
- `src/utils/exercise-session-row-format.ts` (edited) — sites 11–12: `presentSetVolumeLines` + `presentExerciseSessionRow` gain `equipment?` + `bodyweightKg?`. `presentExerciseSessionRow` builds a one-entry `SetBodyweightInput` for `sumPastVolume`. Both receive identical values from callers (Invariant C).
- `src/utils/session-verdict-math.ts` (edited) — `computeCurrentSessionVolumeByExercise` gains `bw?: SetBodyweightInput`; `computePrsForSession` gains `bodyweight?` plumbed straight to `computeLifetimeMaxPerExercise`.
- `app/(app)/exercises/[id]/progress.tsx` (edited) — MAJ-2 two-variable split: `const w` (logged) drives `epley1RM` under unchanged `w>0`; separate `const effW = effectiveWeightKg(exercise.data?.equipment, set.weight, bw)` drives `sessionVolume`/`maxVolumeKg`/`maxVolumeSession` under its own `effW>0` guard. Mounted `useMeasurements`; bw resolved per `s.started_at`. Max-volume callout's `presentSetVolumeLines` gets `equipment` + the max session's bw (Invariant C). "Sessions" list `<ExerciseSessionRow>` gets `equipment` + `measurements`.
- `app/(app)/history/week/[isoWeek].tsx` (edited) — MAJ-1 site #14: `weekVolumeKg` routes through `effectiveWeightKg` with per-`session_id`-memoised bw; `groupSessionVolumes` gets `{ measurements }`. Mounted `useMeasurements`. `avgVolumePerSession` inherits the fix.
- `app/(app)/history/index.tsx` (edited) — **MAJ-3-NEW carry-in must-fix**: mounted `useMeasurements`, pass `{ measurements }` into `groupSessionVolumes(weeklyVolumeData ?? [], …)` so the History-list per-session totals match the week drill-down / verdict / strip / chart for bodyweight exercises.
- `app/(app)/workout/[sessionId].tsx` (edited) — live header `totalVolumeKg`: built `equipmentByExerciseId` from `useAllExercises`, resolved live bw from `session.data.started_at`, passed `SetBodyweightInput` into `sumLiveVolume`. Forwards `liveSessionStartedAt` to `<ExerciseBlock>`.
- `app/(app)/workout/verdict/[sessionId].tsx` (edited) — built `equipmentByExerciseId` + session bw; passed `SetBodyweightInput` into `sumLiveVolume` + `computeCurrentSessionVolumeByExercise`; passed `{ measurements }` into `computePrsForSession`.
- `app/(app)/history/[id].tsx` (edited) — session-detail total: built equipment map + session bw, passed `SetBodyweightInput` into `sumLiveVolume`.
- `src/components/volume-target-slot.tsx` (edited) — accepts `equipment` + `liveSessionStartedAt`; mounts `useMeasurements`; builds the `computeVolumeTarget` `bodyweight` input (one-entry equipment map, per-past-session bw from each `SessionSets.started_at`, live bw); both max-session `presentSetVolumeLines` calls get `equipment` + the max session's bw (Invariant C).
- `src/components/exercise-block.tsx` (edited) — added optional `liveSessionStartedAt` prop; forwards `exercise.equipment` + `liveSessionStartedAt` to `<VolumeTargetSlot>`.
- `src/components/exercise-session-row.tsx` (edited) — accepts `equipment` + `measurements`; resolves THIS session's bw from `session.started_at` (MIN-NEW-2: per-row, multi-session list); threads identical bw into both presenters (Invariant C).
- `src/components/weekly-volume-strip.tsx` (edited) — mounts `useMeasurements`; passes `{ measurements }` into `computeStripModel`.
- `src/hooks/use-progress-page.ts` (edited) — added memoised `useWeeklyBodyweightInput` helper. `useLifetimeBestWeek`/`useCurrentWeekVolume`/`usePrsThisWeek` mount `useMeasurements` and pass ONLY `{ measurements }` (MIN-3). `useExercisesThisWeek`: the `nowKgByExercise` reduce uses `effectiveWeightKg(row.exercises.equipment, …)` with a per-`session_id`-memoised bw; `computeLifetimeMaxPerExercise` gets `{ measurements }`.

### Phase 1 — weekly per-muscle chart + remove per-session chart

- `src/utils/weekly-muscle-volume.ts` (new) — `presentWeeklyVolumeByMuscle` (bucketing by ISO week × `muscles[0]`, zero-filled shared axis, "Other" bucket, bodyweight-aware via the kernel, dangling-id skip, drop all-zero series, empty→`{weeks:[],series:[]}`, injectable `now`).
- `src/components/multi-series-chart.tsx` (new) — `<MultiSeriesChart>` (SVG multi-line, y-domain 0→max of visible series, index-spacing x so 0-weeks are zero-points not gaps, single-dot for 1-week, empty-state when nothing visible / all-zero).
- `src/components/weekly-muscle-volume-section.tsx` (new) — mounts data hooks, owns check-all/uncheck-all + per-muscle toggle local state (re-seeds "all on" when the series set changes), 7 fixed colors + gray "Other", `formatVolume`-based unit conversion.
- `src/components/session-volume-chart-section.tsx` (deleted) — superseded.
- `app/(app)/progress/index.tsx` (edited) — swapped `<SessionVolumeChartSection />` for `<WeeklyMuscleVolumeSection />` in the same slot.

### Tests

- `tests/unit/bodyweight.test.ts` (new) — 21 cases: both helpers, all `effectiveWeightKg` edge cases + legacy non-trigger, all `bodyweightKgAsOf` fallback branches + order independence + exact-instant tie.
- `tests/unit/weekly-muscle-volume.test.ts` (new) — 9 cases: bucketing, zero-fill, `muscles[0]`, "Other", multi-series ordering, bodyweight contribution, dangling-id skip, all-zero drop, 1-week.
- `tests/unit/volume-target.test.ts` (edited) — bodyweight addend / weighted pull-up / MIN-1 (0-weight set drives `currentWeightKg` = bodyweight + `repsToBeat`) / Invariant A byte-identity.
- `tests/unit/progress-page-math.test.ts` (edited) — MIN-4 `mkRow` default; bodyweight cases for `bucketLifetimeWeeklyVolumes`/`computeLifetimeMaxPerExercise`/`computePrsThisWeek` (create + erase) + Invariant A.
- `tests/unit/session-verdict-math.test.ts` (edited) — MIN-4 `mkRow` default; bodyweight PR create + erase (Invariant B).
- `tests/unit/weekly-volume-bucketing.test.ts` (edited) — MIN-4 `RowInput`/`buildRow` migration; bodyweight bucket cases.
- `tests/unit/group-session-volumes.test.ts` (edited) — MIN-4 `mkRow` default (extra builder beyond the Validator's 3 — see Deviations).
- `tests/unit/exercise-session-row-format.test.ts` (edited) — Invariant C (per-set lines sum to row total for a bodyweight exercise) + 0-weight positive line + Invariant A.
- `tests/e2e/weekly-muscle-volume.spec.ts` (new) — section renders / old chart gone, check-all/uncheck-all, per-muscle chip toggle (via class, see Deviations), bodyweight exercise feeds the chart.

## Deviations from design

1. **`computeVolumeTarget` past-session bw key — `session.session_id`, not `session.id`.** The design contract (`design-v2.md:214`) wrote `pastBodyweightBySession.get(session.id)`, but `SessionSets` exposes `session_id` (not `id`) — `src/api/progress.ts:5`. Used `session.session_id`. Correctness unchanged; the design's `.id` was a field-name slip.

2. **MIN-4 migrated a 4th fixture builder: `tests/unit/group-session-volumes.test.ts` `mkRow`.** The Validator's MIN-4 audit named 3 builders (`weekly-volume-bucketing`, `progress-page-math`, `session-verdict-math`) and asserted "no other `WeeklyVolumeRow` literal builders found." `group-session-volumes.test.ts:27-46` also constructs a full `WeeklyVolumeRow` literal and would have failed typecheck once `exercises` became required. Applied the identical `exercises: overrides.exercises ?? { equipment: "barbell" }` default. Justified extension of MIN-4, same shape.

3. **e2e per-muscle-chip toggle asserts on the `opacity-40` NativeWind class, not `aria-checked`.** react-native-web 0.21 does NOT translate `accessibilityState` to `aria-*` DOM attributes (documented precedent at `set-row-menu.spec.ts:141-145`, which asserts `bg-emerald-500` instead of `aria-selected`). Following that sibling precedent, the chip is located via its `aria-label` (`getByLabel("Toggle Chest")`) and visibility is asserted via the dimmed-state class the section toggles. The component keeps `accessibilityRole="checkbox"` + `accessibilityState` for native a11y.

4. **`groupSessionVolumes` seeds a 0 entry per session_id eagerly.** To preserve the pre-feature behaviour that the existing `group-session-volumes.test.ts` locks ("a session with only warmups still appears in the map with total 0"), the new per-row reduce seeds `out.set(session_id, 0)` before applying guards. This matches the old `sumLiveVolume`-per-group semantics exactly (verified: all 12 existing `group-session-volumes` tests still pass).

5. **Threaded `liveSessionStartedAt` through `<ExerciseBlock>` to `<VolumeTargetSlot>`.** The design's wiring row for `volume-target-slot.tsx` said to pass the live session's `started_at`, but the slot is mounted by `<ExerciseBlock>` which did not previously carry it. Added an optional `liveSessionStartedAt` prop on `<ExerciseBlock>` (forwarded from the live workout screen's `session.data.started_at`) so the slot can resolve the live bodyweight. The slot mounts `useMeasurements` itself (per the design's "Mount `useMeasurements`").

## Soft callbacks made (during this implementation pass)

- None. design-v2 was decision-dense enough to implement without escalation. Soft-callback budget unused (2/2).

## Quality gates

- [x] `npm run typecheck` passed — `tsc --noEmit`, 0 errors.
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning (auto-generated `.expo/types/router.d.ts`, baseline-unchanged; none of my files flagged).
- [x] Relevant unit tests pass — `npm run test:unit`: **431/431 passed** (was 384 at baseline; +47 new). 26 test files.
- [x] No new `any` — grep clean in all new/edited files.
- [x] No new `// @ts-ignore` / `eslint-disable` — grep clean.
- [x] No stray `console.log` in source — clean. (e2e spec uses the `[screenshot]` log, matching `progress-page.spec.ts` convention.)

## Notes for Reviewer / Tester

- **Invariant A (Tester focus).** Non-bodyweight numbers must be byte-for-byte unchanged. The mechanism: every kernel takes an OPTIONAL bw input; when present, `effectiveWeightKg(eq, weight, null/bw)` returns `addedLoad` for any non-bodyweight equipment, and the guard `effective > 0` ≡ the old `w > 0`. Unit tests assert this (`volume-target.test.ts` "Invariant A", `progress-page-math.test.ts` "byte-identical"). The 8 volume e2e specs should stay green — audit the two F-4 conditions (no spec seeds `measurement_entries`; every seeded set has a positive `weight`). The 4 specs that use `pickCanonicalExercise(admin)` with NO preferred name take the alphabetically-first canonical row — verify it is not a bodyweight row that also has a seeded measurement (per F-4 neither condition holds today, so numbers don't move).
- **e2e "Pull-up" dependency.** `weekly-muscle-volume.spec.ts` test 4 calls `pickCanonicalExercise(admin, "Pull-up")`, which throws loudly if the canonical "Pull-up" row is missing/renamed (helper contract). Confirmed in the seed migrations (`0004_exercise_muscles_array.sql:65`: Pull-up, `bodyweight`, primary `Upper back`). If the Tester's DB lacks it, that's a seed-state issue surfaced as a clear error, not a 15s UI timeout.
- **e2e weighing convention.** Test 4 seeds a `measurement_entries` row (weight_kg = "80") BEFORE the session, so `bodyweightKgAsOf` resolves to the prior weigh-in and the unweighted pull-ups (`weight: 0`) get `80 × reps` volume → the "Upper back" line exists (pre-feature it would have been 0). This is the only e2e in the suite that seeds a measurement (relevant to the F-4 audit: it does NOT touch the other 8 volume specs).
- **`groupSessionVolumes` shape change (MIN-NEW-1).** Reviewer: confirm the new optional second arg is `WeeklyBodyweightInput?` (not the SetRow `equipmentByExerciseId` map) and that both callers (`history/index.tsx`, `history/week/[isoWeek].tsx`) pass `{ measurements }`.
- **R-8 admin trade-off honored.** `admin/index.tsx:394` `sumLiveVolume(detailQ.data.sets)` passes NO bw input → stays non-bodyweight (today's number). Untouched on purpose.
- **e1RM stays logged-weight (Invariant D).** The per-exercise split keeps `epley1RM(w, r)` on the logged `w` under `w>0`; a 0-weight bodyweight set yields NO e1RM point but DOES yield a volume point. Verified by the split's two divergent guards; Tester can assert via the per-exercise progress charts.
- **`docs/features.md` left untouched** (per scope — the Conductor moves entries to "## Done" at finalize). The working tree shows a pre-existing `## Open` addition from run setup; not my edit.

## Round 2 (test-only fix) — 2026-05-30 BRT

Test report v1 returned a NARROW, surgical FAIL: every static gate green (typecheck 0, lint 0, unit 431/431), the feature verified working end-to-end by the Tester (a weight=0 Chin-up + 80 kg prior weigh-in → 2,560 kg real "Upper back" volume across chart/hero/strip). The ONLY failure was a broken TEST shipping in `weekly-muscle-volume.spec.ts` test 4: `pickCanonicalExercise(admin, "Pull-up")` threw `Canonical exercise 'Pull-up' not found` because the live canonical catalog has Chin-up / Dip / Hanging Leg Raise / Push-up but no "Pull-up" row.

**Root-cause correction to my round-1 note.** My round-1 `## Notes` block (above) cited `0004_exercise_muscles_array.sql:65` (the per-user trigger seed) as proof "Pull-up exists." That was the WRONG source: `0004` seeds rows **per user via a trigger**; the canonical catalog (`user_id IS NULL`) that `pickCanonicalExercise` queries comes from migration `0011_canonical_exercises.sql`, which flipped the original user's seeded rows to canonical. The Conductor-verified live canonical set does NOT include "Pull-up". `pickCanonicalExercise` requires a canonical (`user_id IS NULL`) row, so the per-user `0004` seed is not the source of truth here.

**The fix (one exercise swap + prose tidy — test-data correction only):**
- `tests/e2e/weekly-muscle-volume.spec.ts:307` — `pickCanonicalExercise(admin, "Pull-up")` → `pickCanonicalExercise(admin, "Chin-up")`. This is the only behavioral change. "Chin-up" is a canonical bodyweight row that exists in the live catalog, with `muscles[0] = "Upper back"` (verified `0004_exercise_muscles_array.sql:66`: `Chin-up, array['Upper back','Arms'], 'bodyweight'`), so the test's intent and the `getByText("Upper back")` assertion at `:340` hold unchanged.
- Prose tidy for accuracy (cosmetic): `:12`, `:14` (header comment), `:306` (inline pick comment), `:310` (weigh-in comment), `:320` (the inline note now spells out Chin-up's `muscles[0]`), `:337` (the assertion comment) — all "Pull-up"/"pull-up"/"pull-ups" → "Chin-up"/"chin-up"/"chin-ups". `grep -i "pull-up"` on the file returns 0 matches after the edit.

**Scope discipline:** touched ONLY `tests/e2e/weekly-muscle-volume.spec.ts` (no source file, no other test, not `docs/features.md`). Did NOT touch or attempt to fix the 2 `chart-scroll-week-selector.spec.ts` failures — the Tester proved (via `git stash` to baseline `5a2382b`) they are PRE-EXISTING and out of scope.

**Verification (observed):**
- `npm run typecheck` — **0 errors** (exit 0), unchanged.
- `npm run lint` — **0 errors, 1 warning** (auto-generated `.expo/types/router.d.ts`, baseline-unchanged), unchanged.
- e2e: started a fresh Expo web server on `:8081` (the Tester's was torn down; health-checked HTTP 200), then ran `npx playwright test tests/e2e/weekly-muscle-volume.spec.ts`. **4/4 PASS** — `{"expected":4,"skipped":0,"unexpected":0,"flaky":0}` (20.7 s). Test 4 ("bodyweight exercise feeds the chart via the Phase-0 kernel"), the round-1 blocker, now passes: the Chin-up seed resolves and the "Upper back" line renders. `test-results/.last-run.json` → `{"status":"passed","failedTests":[]}`.

**Soft-callbacks:** none consumed (2/2 remaining). Re-implements this Test cycle: 1/2.
