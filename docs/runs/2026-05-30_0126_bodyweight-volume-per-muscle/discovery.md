# Discovery — 2026-05-30_0126_bodyweight-volume-per-muscle

## Feature prompt

Two-phase feature for the Progress page (shipping together):

**PHASE 0** — Make the canonical volume kernel bodyweight-aware, applied canonically across EVERY volume surface (owner decision: preserve the "same volume number everywhere" invariant). Current kernel is `weight * reps` guarded by `w > 0 && r > 0`. Bodyweight exercises (`equipment = "bodyweight"`) are logged with `weight = 0`, so they contribute ZERO volume everywhere today. Fix: a bodyweight-equipment set contributes `(bodyweightKgAsOfSession + addedLoadKg) * reps`. Bodyweight-as-of-session = nearest PRIOR non-null `weight_kg` from `measurement_entries`. Document a fallback when no weigh-in precedes the session. Leverage factors are OUT OF SCOPE (deferred in `docs/features.md` "## Open").

**PHASE 1** — New "weekly volume per muscle group" chart on the Progress page; REMOVE the existing per-session chart (`SessionVolumeChartSection` + `presentSessionVolumeChart`). New chart: per-muscle-group weekly volume over time, ISO-week bucketed, primary-muscle attribution (`muscles[0]`), selectable muscle lines (multi-series) with check-all/uncheck-all. Must use the Phase 0 bodyweight-aware kernel.

(Full prompt verbatim in `state.md:3-25`.)

## Scope summary

Phase 0 is a **read-side data-plumbing** change to a single arithmetic predicate (`weight * reps`) that is currently **duplicated inline across ~9 sites** (the prompt named 6; this discovery found more — see the kernel inventory). The crux is that the predicate is fed by THREE distinct data pipelines (`WeeklyVolumeRow[]` from `stats.ts`, `SessionSets[]`/`SetRow[]` from `progress.ts`, and live-session `SetRow[]`), and NONE of them currently carries exercise `equipment` or the user's bodyweight timeline. Phase 1 adds a new multi-series chart component (today's `<ProgressChart>` is single-series only) plus a new per-muscle weekly bucketing presenter, and removes the per-session chart. Both phases are read-only; **no migration is needed** (confirmed below).

## Affected files (verified)

### The volume kernel(s) and EVERY call site (Required output #1)

There is **one named kernel pair** plus **a discriminated-state computer** in `volume-target.ts`, and **at least 6 inline re-implementations** of the same `w * r` predicate elsewhere. All apply the identical guard `Number.isFinite(w) && w > 0 && r > 0` and skip warmups.

**Named kernel (`src/utils/volume-target.ts`):**
- `sumPastVolume(sets)` — `volume-target.ts:74-85`. Predicate: skip warmup, `parseFloat(weight)`, guard `w>0 && r>0`. No `completed_at` filter.
- `sumLiveVolume(sets)` — `volume-target.ts:100-114`. Same predicate + leading `completed_at == null` skip. Accepts `Pick<SetRow,"completed_at"|"set_type"|"weight"|"reps">` so `WeeklyVolumeRow` feeds it without a cast.
- `computeVolumeTarget(input)` — `volume-target.ts:135-201`. Reduces `pastSessions` via `sumPastVolume` for `previousMaxKg`; reduces live sets via `sumLiveVolume` for `runningKg`; also picks `currentWeightKg` by `max(set_number)` for the "reps to beat" projection (`:177-190`).

**Inline kernels (each its own copy of `w*r`):**
- `bucketLifetimeWeeklyVolumes` — `progress-page-math.ts:41-59` (`:52-55` is the `w*r`).
- `computeCurrentWeekVolume` — `progress-page-math.ts:143-158` (`:151-155`).
- `computeLifetimeMaxPerExercise` — `progress-page-math.ts:183-222` (`:191-193`, groups by `(exercise_id, session_id)`).
- `groupSessionVolumes` — `progress-page-math.ts:251-265` (delegates to `sumLiveVolume` per session group).
- `computePrsThisWeek` — `progress-page-math.ts:306-393` (`:328-330`, running-priorMax PR walk).
- `presentSessionVolumeChart` — `progress-page-math.ts:558-586` (delegates to `groupSessionVolumes`). **TO BE REMOVED in Phase 1.**
- `computeStripModel` — `src/utils/weekly-volume-strip-math.ts:47-92` (`:72-76`). **The prompt did NOT list this one — it is a 4th independent inline kernel powering the weekly strip.**
- Per-exercise progress page inline reduce — `app/(app)/exercises/[id]/progress.tsx:138-147` (`:145` is the `w*r`; also computes e1RM in the same loop). **NOT a function — inlined in the screen's `useMemo`.** Drives the "Total volume" trend chart, the "Max volume session" callout (`:154-168`), and `maxVolumeKg`.
- `presentSetVolumeLines` — `src/utils/exercise-session-row-format.ts:89-112` (`:98-101`). Per-set breakdown; `volumeKg` sums to the session total by construction. Used by `<VolumeTargetSlot>` + the progress-page Max-volume callout.
- `presentExerciseSessionRow` — `src/utils/exercise-session-row-format.ts:48-62` (delegates to `sumPastVolume`).

**Downstream callers of the named kernel (verified by grep):**
- `sumLiveVolume`: `app/(app)/workout/[sessionId].tsx:91-94` (live session header total), `app/(app)/workout/verdict/[sessionId].tsx:54-56` (verdict headline total), `app/(app)/history/[id].tsx:133` (history-detail total), `app/(app)/admin/index.tsx:394` (admin session detail), `session-verdict-math.ts:44` (`computeCurrentSessionVolumeByExercise`), `progress-page-math.ts:262` (`groupSessionVolumes`).
- `sumPastVolume`: `exercise-session-row-format.ts:55` only (then surfaced by `presentExerciseSessionRow`).
- `computeVolumeTarget`: `src/components/volume-target-slot.tsx:49`.
- `presentSessionVolumeChart`: `src/components/session-volume-chart-section.tsx:49`.

### Phase 1 files to REMOVE / change
- `src/components/session-volume-chart-section.tsx` — full file (remove). Mounted at `app/(app)/progress/index.tsx:6,70`.
- `presentSessionVolumeChart` — `progress-page-math.ts:537-586` (remove). **No unit test exists for it** (grep of `tests/unit` returned zero matches; the `progress-page-math.test.ts` describe inventory at `:98-1578` has no `presentSessionVolumeChart` block). The prompt's "plus its tests" is inaccurate — there are no tests to delete. The progress-page e2e (`tests/e2e/progress-page.spec.ts`) does NOT assert the per-session chart (grep for "Volume per session"/"12w"/"26w"/"52w" returned zero), so removal has no e2e fallout there.
- `app/(app)/progress/index.tsx` — remove the `<SessionVolumeChartSection />` mount + import (`:6,70`); add the new per-muscle chart section.

### Phase 1 files the new chart will build on / join against
- `src/components/progress-chart.tsx:24-141` — single-series chart (one `<Polyline>`, hardcoded `stroke="#3b82f6"` at `:117`, one dot color at `:123`). See gap analysis (#5).
- `groupExercisesByPrimaryMuscle` — `progress-page-math.ts:430-452` (groups `ExerciseRow[]` by `muscles[0]` into `MuscleGroup | "Other"`).
- `MUSCLE_GROUPS` — `src/db/types.ts:129-137` (the 7: Chest, Upper back, Lower back, Shoulders, Arms, Legs, Core).
- ISO-week helpers — `src/utils/dates.ts`: `isoWeekStart` (`:40-42`), `weekKeyOf` (`:48-56`), `lastNIsoWeeks` (`:62-76`), `isoWeekContaining` (`:83-92`), `isoWeeksBetween` (`:105-126`). `weekKeyToMondayLabel` lives privately in `progress-page-math.ts:122-133` (not exported).

## Relevant conventions (verified by reading code)

- **Single-kernel invariant.** Every "volume" readout is meant to come from the same arithmetic — documented at `volume-target.ts:53-67` and `progress-page-math.ts:8-19`. The owner's "apply bodyweight canonically" decision is precisely to keep this invariant. Verified fact: the predicate is duplicated, not centralized, so a canonical change must touch ALL ~9 sites or the invariant breaks at exactly the un-fixed surfaces.
- **Three data pipelines feed the kernel** (verified):
  1. `WeeklyVolumeRow[]` — `src/api/stats.ts:18-26`, fetched by `useLifetimeWeeklyVolume` (`use-stats.ts:20-29`, cache key `["stats","weekly-volume","lifetime"]`, staleTime 60s). Selects `completed_at, weight, reps, set_type, exercise_id, session_id, sessions!inner(started_at, ended_at)` (`stats.ts:28-29`). **Has `exercise_id` but NOT `equipment`; no measurements.**
  2. `SessionSets[]` — `src/api/progress.ts:4-40` (`listSetsForExercise`), fetched by `useExerciseProgress` (`use-progress.ts:5-11`, key `["progress", exerciseId]`). Returns `SetRow[]` grouped by session via `select("*, sessions!inner(...)")`. Scoped to ONE exercise. **Has full `SetRow` but NOT exercise `equipment`; no measurements.**
  3. Live `SetRow[]` — `useSetsForSession` cache on the workout screen (`workout/[sessionId].tsx:91-94`) and verdict (`verdict/[sessionId].tsx:54`). **Has `SetRow` but NOT equipment; no measurements.**
- **Measurements pipeline** — `src/api/measurements.ts:100-108` (`listMeasurements`: `select("*")`, `deleted_at IS NULL`, **`.order("measured_at", { ascending: false })` → DESC**), fetched by `useMeasurements` (`use-measurements.ts:17-22`, key `["measurements"]`). `weight_kg` is `numeric(6,2)` → returned as a **`string | null`** (`db/types.ts:233`). Verified null-handling precedent: `entriesToWeightSeries` (`src/utils/measurements-chart.ts:22-42`) filters `row.weight_kg == null` and `!Number.isFinite(parseFloat(...))` (`:29-31`) — this is the canonical "skip null/non-finite weight" pattern to mirror.
- **Timezone handling** (verified): all timestamps are `timestamp(..., { withTimezone: true })` (`schema.ts:131-132,164,197`). PostgREST returns them as UTC ISO strings (`+00:00`/`Z`). The app uses `parseISO` (re-exported from `dates.ts:128-129`) then `.getTime()` for numeric compares; ISO-week bucketing is **device-local** (`dates.ts:12-19,40-42` explicitly use local `getDay`/`setDate` so a Sunday-23:30-BRT set lands in the local week). The unique index on `measurement_entries` is keyed on the **UTC calendar day** (`measurements.ts:55-58`, `schema.ts:221`) — relevant only to dedupe, NOT to the "nearest prior weigh-in" math.
- **Window preference plumbing** (verified): `computeWindowStart(weeks, now)` (`src/utils/window-utils.ts:41-49`) returns a numeric ms threshold or `undefined` (lifetime). Every windowed kernel takes an optional `windowStartMs` and filters at the **session level** on `started_at` (never per-set) so a session is one indivisible unit. The new per-muscle chart should decide whether it honors this pref (see Unknowns #3).
- **Tests** (Required output #6, verified):
  - Vitest unit tests only run under `tests/unit/**/*.test.ts` (`vitest.config.ts:9-12`); script `npm run test:unit` → `vitest run` (`package.json:17`). `~` alias maps to `src` (`vitest.config.ts:13-17`).
  - **No React Testing Library / RNTL** — all unit tests are pure-function tests on `.ts` files; components/screens are NOT unit-tested (verified: no `@testing-library` in `package.json`; `vitest.config.ts:1-8` comment says unit tests avoid RN). Component behavior is covered by Playwright e2e (`package.json:18` → `playwright test`, specs in `tests/e2e/*.spec.ts`).
  - **Date-pinning pattern**: `progress-page-math.test.ts:42-49` uses `beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-22T12:00:00-03:00")); })` + `afterEach(() => vi.useRealTimers())`. Fixtures built via `mkRow` (`:55-77`) and `mkExercise` (`:79-92`). Describe-per-helper structure (`:98,171,217,583,777,...`). Other timer users: `dates.test.ts`, `measurements-chart.test.ts`, `format-display-date.test.ts`.
  - Related existing unit suites to extend/regress: `volume-target.test.ts` (22.6K), `group-session-volumes.test.ts`, `session-verdict-math.test.ts`, `weekly-volume-bucketing.test.ts`, `window-utils.test.ts`, `session-header-total-volume.test.ts`, `measurements-chart.test.ts`.

## Constraints

- **Data**: `measurement_entries.weight_kg` is **nullable** (`schema.ts:200`; circumference-only entries) — must pick nearest PRIOR non-null. `measured_at` is `NOT NULL DEFAULT now()` (`schema.ts:197-199`). `weight_kg` is `numeric(6,2)` so it arrives as a string → `parseFloat`. No FK between `sets`/`sessions` and `measurement_entries`; the "as-of-session" join is purely temporal (`session.started_at` vs `measured_at`). RLS already scopes all three tables to the owner; no new RLS.
- **UI**: NativeWind classes; charts are `react-native-svg`. Multi-series requires extending `<ProgressChart>` or a new component (#5). The new section sits on `app/(app)/progress/index.tsx` between `<WeeklyVolumeStrip>` (`:66-69`) and `<ExercisesThisWeekList>` (`:71`) where the removed `<SessionVolumeChartSection>` is now (`:70`).
- **Platform**: Web + native (Expo Router). `ProgressChart` already handles `width` via `Dimensions`/`useWindowDimensions`. No known iOS/Android divergence in this area.
- **Auth**: single user (owner). All reads are RLS-scoped to `auth.uid()`.
- **Performance**: `useLifetimeWeeklyVolume` paginates the full lifetime sets read (`stats.ts:72-91`, 1000/page). Per-muscle weekly bucketing is O(N) in-memory over that cached set — same cost class as the existing strip. Adding equipment + measurements means EITHER widening the `stats.ts` select with an `exercises!inner(equipment, muscles)` join OR a client-side join against `useAllExercises` (which already loads `equipment` + `muscles`, `api/exercises.ts:36-44`) plus a `useMeasurements` fetch. See Unknowns #1.

## Surface-by-surface data-availability table (Required output #2)

Every surface that renders a volume number, the hook/query feeding it, and whether it currently has `equipment` + measurements. **"Has equipment?" / "Has measurements?" = NO everywhere today** — that is the entire data-plumbing problem.

| # | Surface | File:line | Hook / query | Pipeline | Kernel used | Has equipment? | Has measurements? |
|---|---------|-----------|--------------|----------|-------------|----------------|-------------------|
| 1 | History list rows (per-session volume) | `app/(app)/history/index.tsx:22-25,60` | `useLifetimeWeeklyVolume` | `WeeklyVolumeRow[]` | `groupSessionVolumes` | NO (`exercise_id` only) | NO |
| 2 | History week drill-down rows | `app/(app)/history/week/[isoWeek].tsx:53,205` | `useLifetimeWeeklyVolume` | `WeeklyVolumeRow[]` | `groupSessionVolumes` | NO | NO |
| 3 | History detail total | `app/(app)/history/[id].tsx:45,133` | `useSetsForSession` | live `SetRow[]` | `sumLiveVolume` | NO | NO |
| 4 | End-of-session verdict total + PR list | `app/(app)/workout/verdict/[sessionId].tsx:54,58-84` | `useSetsForSession` + `useLifetimeWeeklyVolume` | `SetRow[]` + `WeeklyVolumeRow[]` | `sumLiveVolume` + `computePrsForSession`→`computeLifetimeMaxPerExercise` | NO | NO |
| 5 | Weekly volume strip (8-bar + best overlay) | `src/components/weekly-volume-strip.tsx:82,99-102` | `useLifetimeWeeklyVolume` | `WeeklyVolumeRow[]` | `computeStripModel` (`weekly-volume-strip-math.ts:72-76`) | NO | NO |
| 6 | Progress hero (PRs this week, weekly Max·Now·To PR, all-time best) | `src/components/progress-hero.tsx` (consumes `useLifetimeBestWeek`, `useCurrentWeekVolume`, `usePrsThisWeek` from `use-progress-page.ts:45-144`) | `useLifetimeWeeklyVolume` | `WeeklyVolumeRow[]` | `bucketLifetimeWeeklyVolumes`, `computeCurrentWeekVolume`, `computePrsThisWeek` | NO | NO |
| 7 | Exercises-this-week list (per-row Max·Now·To PR) | `src/components/exercises-this-week-list.tsx:37` ← `useExercisesThisWeek` (`use-progress-page.ts:220-334`) | `useLifetimeWeeklyVolume` + `useAllExercises` | `WeeklyVolumeRow[]` + `ExerciseRow[]` | inline `w*r` (`use-progress-page.ts:251-258`) + `computeLifetimeMaxPerExercise` | **PARTIAL** — `useAllExercises` is already joined here, so `muscles`/`equipment` ARE in scope (`:270`); but the volume math at `:251-258` doesn't read equipment | NO |
| 8 | Per-exercise progress page (trend chart, Max-volume callout) | `app/(app)/exercises/[id]/progress.tsx:59,124-179` | `useExerciseProgress` + `useAllExercise` | `SessionSets[]` | inline `w*r` (`:138-147`) | **PARTIAL** — `useAllExercise(id)` loads the single exercise's `equipment` (`:58`), but the volume loop doesn't read it | NO |
| 9 | Live workout `<VolumeTargetSlot>` (Max·Now·To PR) | `src/components/volume-target-slot.tsx:39,49` (mounted via `exercise-block.tsx:240-241`, gated `showVolumeTarget` from `workout/[sessionId].tsx:507`) | `useExerciseProgress(exerciseId)` + live sets | `SessionSets[]` + `SetRow[]` | `computeVolumeTarget` | **PARTIAL** — slot receives `exerciseId` and the parent `<ExerciseBlock>` has the `ExerciseRow`; equipment reachable but not currently read | NO |
| 10 | Live session header total | `src/components/session-header.tsx` (presentational) ← `workout/[sessionId].tsx:91-94` | `useSetsForSession` | live `SetRow[]` | `sumLiveVolume` | NO | NO |
| 11 | Per-set breakdown (live slot + progress callout) | `src/components/set-volume-breakdown.tsx` ← `presentSetVolumeLines` (`exercise-session-row-format.ts:89-112`) | (passed sets) | `SetRow[]` | inline `w*r` | NO | NO |
| 12 | Admin session detail total | `app/(app)/admin/index.tsx:394` | admin query | `SetRow[]`-like | `sumLiveVolume` | NO | NO |
| 13 | Exercise-progress "Sessions" rows ("N × total") | `exercise-session-row-format.ts:48-62` via `<ExerciseSessionRow>` | `useExerciseProgress` | `SessionSets[]` | `sumPastVolume` | NO | NO |
| 14 (NEW) | **Weekly per-muscle chart** (Phase 1) | (new component on `progress/index.tsx`) | `useLifetimeWeeklyVolume` + `useAllExercises` (+ measurements) | `WeeklyVolumeRow[]` + `ExerciseRow[]` | new presenter (bodyweight-aware) | needs the exercise→muscle+equipment join | needs measurements |

**Key fact for the Designer**: surfaces 7, 8, 9 already have an exercise-library join in scope (`useAllExercises`/`useAllExercise`), so they can read `equipment` with no new fetch. Surfaces 1, 2, 5, 6 run purely off `WeeklyVolumeRow[]` (which has `exercise_id` but no equipment) — they need EITHER a widened `stats.ts` select OR a client-side join. **The cleanest single lever** is to make the bodyweight enrichment happen once at the data layer (or in one shared "effective weight" step) so all `WeeklyVolumeRow[]`-driven surfaces (1,2,5,6, and the new chart 14) inherit it, while the `SetRow`/`SessionSets`-driven surfaces (3,4,8,9,10,11,13) get a parallel enrichment. Design must pick the seam.

## How `measurement_entries` is queried today (Required output #3)

- API: `listMeasurements()` — `src/api/measurements.ts:100-108`. `select("*")`, `deleted_at IS NULL`, **DESC by `measured_at`**. Returns `MeasurementEntryRow[]` (`db/types.ts:228-246`).
- Hook: `useMeasurements()` — `use-measurements.ts:17-22`, key `["measurements"]`, no `staleTime` set (default 0 → refetch on mount).
- `weight_kg`: `numeric(6,2)` → `string | null` (`db/types.ts:233`, `schema.ts:200`).
- **Null-weight handling precedent**: `entriesToWeightSeries` (`measurements-chart.ts:22-42`) — skips `weight_kg == null` (`:29`) and `!Number.isFinite(parseFloat(...))` (`:31`). This is the exact filter the "nearest prior non-null weigh-in" lookup should reuse.
- **Timezone of `measured_at`**: stored UTC (`timestamptz`, `schema.ts:197`), arrives as a UTC ISO string. For "nearest prior weigh-in" the only correct compare is `parseISO(measured_at).getTime() <= parseISO(session.started_at).getTime()` (both UTC instants) — do NOT introduce local-day rounding (the local-day rule applies only to ISO-week bucketing and the dedupe index, neither of which governs this lookup).
- No existing helper does "bodyweight as of date" — this is greenfield. The nearest analog is `entriesToWeightSeries` (series for a chart, not a point lookup).

## The exercise→muscle join story for per-muscle volume (Required output #4)

- `WeeklyVolumeRow` exposes `exercise_id` (`stats.ts:24`) but **NOT** `muscles` or `equipment`. The `SELECT` (`stats.ts:28-29`) joins only `sessions!inner(...)`.
- `groupExercisesByPrimaryMuscle` (`progress-page-math.ts:430-452`) operates on `ExerciseRow[]` (full library), keying by `muscles[0]`; unknown/empty primary → `"Other"` bucket (`:442-443`). It does NOT touch set rows — it's a library-side grouping.
- **Precedent for the join already exists**: `useExercisesThisWeek` (`use-progress-page.ts:220-334`) builds `libById = new Map(lib.data.map(...))` (`:270`) from `useAllExercises` and joins each set row's `exercise_id` → `ExerciseRow` to derive the primary-muscle `group` (`:278-283`). The new per-muscle weekly chart should mirror this exact join: bucket `WeeklyVolumeRow[]` by `weekKeyOf(completed_at)` AND by `libById.get(row.exercise_id).muscles[0]` → `MuscleGroup | "Other"`. So **no new fetch is needed for muscles** — `useAllExercises` is the precedent and already loads `muscles` + `equipment` (`api/exercises.ts:36-44`). A server-side `exercises!inner(...)` join on `stats.ts` is an alternative but not required.
- Dangling `exercise_id` (soft-deleted/missing) precedent: `use-progress-page.ts:275` skips rows whose exercise isn't in the library (`if (!ex) continue;`). Mirror this.

## `<ProgressChart>` multi-series gap analysis (Required output #5)

`src/components/progress-chart.tsx` is **single-series only**. Concrete gaps:
- `DataPoint = { label, value }` (`:5-8`) — one value per x. No series dimension.
- One `<Polyline>` with hardcoded `stroke="#3b82f6"` (`:113-120`); one dot color `#3b82f6` (`:122-124`). No color-per-series.
- Y-domain computed from the single `values` array (`:33-37`); for multi-series the domain must span the max across ALL selected series.
- X-axis assumes uniform index spacing over `data.length` (`:42-44,57-58`); per-muscle weekly series share the same week buckets, so x positions must be derived from a **shared week axis**, not per-series indices (a muscle untrained in week W must still align to W's x position, or be a gap).
- `title` is a single string (`:14,87`); legend / series-selection chrome is absent.
- **No existing multi-line chart in the codebase** — verified: `grep Polyline/stroke=` across `src/components` matches only `progress-chart.tsx`. So multi-series + check-all/uncheck-all is greenfield. Design choice: extend `<ProgressChart>` to accept `series: { label, color, points }[]` (risk: complicates the 2 existing single-series callers — measurements strip `measurements-progress-strip.tsx:61-67` + per-exercise page `exercises/[id]/progress.tsx:229-243`) OR build a new `<MultiSeriesChart>` and leave `<ProgressChart>` for the single-series callers. The latter is lower-risk for the single-component invariant.

## Migrations (Required output #7)

**Confirmed NO migration is needed for either phase.** Verified facts:
- All required columns already exist: `exercises.equipment` (`Equipment` union `db/types.ts:80-85`, `ExerciseRow.equipment` `:151`), `exercises.muscles` (`ExerciseRow.muscles`, `db/types.ts:149`), `measurement_entries.measured_at` + `weight_kg` (`schema.ts:197-200`). Canonical exercises were already backfilled with `muscles` + lowercased `equipment` in `0014_backfill_exercise_muscles.sql` (per `docs/features.md:33`).
- Both phases are pure read-side computation. Phase 1 removes a component + presenter and adds a new component + presenter. No schema, no RLS, no new column.
- Optional (NOT a migration): the Designer MAY choose to widen the `stats.ts` PostgREST `SELECT` to join `exercises!inner(equipment, muscles)` — that's a query change, not a DB migration, and is one of the two plumbing options.

## Existing precedents

- **Windowed-kernel plumbing** (`window-utils.ts` + every `windowStartMs` param) — precedent for threading a new optional dependency through ALL kernels at once without breaking the `weeks===0`/`undefined` default. The bodyweight enrichment is structurally analogous: an optional input that, when absent, must reproduce byte-for-byte the old numbers for non-bodyweight exercises.
- **Exercise-library client-side join** — `use-progress-page.ts:270-283` (`useExercisesThisWeek`) is the template for joining `exercise_id` → `equipment`/`muscles` without a server change.
- **Null-weight skip** — `measurements-chart.ts:29-31`.
- **ISO-week bucketing + zero-fill** — `weekly-volume-strip-math.ts:47-92` (`computeStripModel`) is the closest template for the new per-muscle weekly buckets (contiguous weeks first-session→now, zero-filled).
- **Multi-window selector UI** — `session-volume-chart-section.tsx:10-94` (the chip selector being removed) is a reusable visual idiom for the check-all/uncheck-all + per-muscle toggles, even though the component itself is deleted.
- **Cross-surface volume regression discipline** — `tests/e2e/soft-deleted-session-volume-leak.spec.ts`, `session-total-volume-header.spec.ts`, `end-of-session-verdict.spec.ts` already assert specific volume numbers; these are the e2e suites whose fixtures could shift if a bodyweight exercise is in their data (see Unknowns #5).

## Unknowns (require Designer judgment or human decision)

1. **(a) Plumbing seam: server-join vs client-join vs shared enrichment step.** (b) `WeeklyVolumeRow[]` (surfaces 1,2,5,6,14) lacks `equipment` and the bodyweight timeline; the `SetRow`/`SessionSets` pipelines (3,4,8,9,10,11,13) also lack equipment. (c) **Recommended default**: introduce a single pure "effective weight" helper — `effectiveWeightKg(set, equipment, bodyweightKgAsOf)` returning `equipment === "bodyweight" ? bodyweightKg + addedLoad : addedLoad` — and have BOTH the `stats.ts` consumers (via a widened `exercises!inner(equipment)` join on `stats.ts:28-29`, so `WeeklyVolumeRow` gains `equipment`) and the `SetRow` consumers route their `w` through it. Widening the select is lower-blast-radius than threading a `useAllExercises` join into 4 separate surfaces. Bodyweight timeline must still be fetched (`useMeasurements`) and passed to each kernel. Designer to confirm the exact signature so all ~9 sites change once.

2. **(a) Bodyweight fallback when NO weigh-in precedes the session.** (b) The prompt names candidates (nearest-later entry, else 0/skip) and says "Design decides, but state it explicitly." This is THE central correctness decision. (c) **Recommended default**: (i) nearest PRIOR non-null `weight_kg`; (ii) if none, nearest LATER non-null `weight_kg` (a user who weighs in shortly after starting still has a meaningful bodyweight); (iii) if the user has NEVER logged a non-null `weight_kg`, treat bodyweight contribution as **0** (so a bodyweight set with `addedLoad=0` contributes 0 = today's behavior, no silent NaN). State the chosen rule in design + cover all three branches in unit tests. Risk if wrong: a fallback that picks "0" too eagerly leaves the bug unfixed for users with sparse measurements; picking "nearest-later" too eagerly back-dates today's bodyweight onto years-old sessions.

3. **(a) Does the new per-muscle chart honor the `max_volume_window_weeks` preference?** (b) The per-session chart being removed used its OWN local 12/26/52/all selector (`session-volume-chart-section.tsx:10-17`), independent of the pref (`:30-31` comment). PR/Max surfaces honor the pref; trend charts deliberately do NOT (`exercises/[id]/progress.tsx:29-31`). (c) **Recommended default**: the per-muscle chart is a TREND visualization (its job is "make a silent weekly drop visible," per prompt), so it should show full history (or a chart-local window selector like the removed one), NOT the PR/Max `max_volume_window_weeks` pref. State explicitly.

4. **(a) How are weeks with zero volume for a selected muscle rendered?** (b) A muscle untrained in week W: gap in the line, zero point, or line skips W? `<ProgressChart>` currently has no gap concept (`:42-44` assumes a value per index). (c) **Recommended default**: zero-fill contiguous weeks (mirror `computeStripModel`'s zero-fill at `weekly-volume-strip-math.ts:66-77`) so all 7 muscle lines share one week axis and read honestly (a drop to zero is the signal the owner wants to see). Confirm.

5. **(a) Retroactive PR / max blast radius — WHICH surfaces' numbers move.** (b) Making the kernel bodyweight-aware retroactively changes historical volume for bodyweight exercises everywhere, which can CREATE or ERASE past PRs and shift max-volume. (c) **Verified blast list** (surfaces whose numbers change for any bodyweight-equipment exercise): #1 history rows, #2 week rows, #3 history detail total, #4 verdict total + PR detection (`computePrsForSession`→`computeLifetimeMaxPerExercise`), #5 weekly strip bars + best-week overlay, #6 hero PRs-this-week + weekly Max·Now·To PR + all-time best (`computePrsThisWeek`, `bucketLifetimeWeeklyVolumes`, `computeCurrentWeekVolume`), #7 exercises-this-week Max/Now/PR, #8 per-exercise trend chart + Max-volume callout, #9 `<VolumeTargetSlot>` Max/Now/To PR, #10 live header, #11 per-set breakdown, #14 the new chart. **Regression contract for the Tester**: (i) non-bodyweight exercises' numbers must be byte-for-byte unchanged; (ii) bodyweight exercises' PRs/max must change as expected; (iii) e2e suites with hard-coded volume assertions (`soft-deleted-session-volume-leak.spec.ts`, `session-total-volume-header.spec.ts`, `end-of-session-verdict.spec.ts`, `volume-target.spec.ts`, `progress-page.spec.ts`, `weekly-volume-strip.spec.ts`, `max-volume-window.spec.ts`, `chart-scroll-week-selector.spec.ts`) must be audited — if any fixture uses a `bodyweight` exercise, its expected numbers shift. Designer should specify whether e2e fixtures use bodyweight exercises (likely they use barbell/dumbbell with explicit weights, so numbers DON'T move — but this must be verified, not assumed).

6. **(a) `addedLoadKg` semantics for non-bodyweight rows with `weight=0`.** (b) The fix is scoped to `equipment === "bodyweight"`. A non-bodyweight set logged with `weight=0` (sloppy/placeholder) still contributes 0 under the current guard. (c) **Recommended default**: only bodyweight-equipment sets get the bodyweight addend; every other equipment keeps `w*r` with the `w>0` guard intact. So a 0-weight machine set stays 0 (today's behavior). The new predicate must be `effective = isBodyweight ? bw + addedLoad : addedLoad; if (effective>0 && r>0) ...` — confirm the guard restructure preserves the `w>0` skip for non-bodyweight.

7. **(a) Legacy/unknown `equipment` strings.** (b) `db/types.ts:108-118` notes user-owned legacy rows MAY hold arbitrary equipment strings; only `"bodyweight"` (lowercase canonical) should trigger the addend. (c) **Recommended default**: exact `=== "bodyweight"` match (canonical token post-0014). A legacy mixed-case "Bodyweight" would NOT trigger — acceptable since 0014 normalized canonical rows and the owner is the sole user. State the exact predicate.

8. **(a) Multi-series chart: extend `<ProgressChart>` or new component?** (b) See #5 — single-series today, 2 existing single-series callers. (c) **Recommended default**: new `<MultiSeriesChart>` (or extend with an optional `series` prop that the 2 existing callers don't pass), to avoid regressing the measurements strip + per-exercise charts. 7 fixed colors keyed to `MUSCLE_GROUPS` order; check-all/uncheck-all toggles series visibility (client state, not persisted — mirror the removed chart's local-state pattern at `session-volume-chart-section.tsx:36`). Decide whether `"Other"`-bucket exercises (empty/unknown primary muscle) get an 8th line or are excluded.

9. **(a) Should `computeStripModel` and the per-exercise inline reduce be refactored onto the shared kernel as part of Phase 0, or left inline-but-fixed?** (b) The prompt's "canonical kernel" framing implies centralization, but `computeStripModel` (`weekly-volume-strip-math.ts`) and `exercises/[id]/progress.tsx:138-147` are independent copies the prompt did NOT enumerate. (c) **Recommended default**: route ALL ~9 sites through the shared `effectiveWeightKg` helper so the single-kernel invariant becomes real (not just documented). At minimum, every inline copy MUST get the bodyweight fix or the "same number everywhere" invariant breaks at exactly the strip + per-exercise-page surfaces. Flag the `computeStripModel` + per-exercise-page sites explicitly to the Designer as easy-to-miss.

## Out-of-scope flags

- Bodyweight **leverage factors** (push-up ≈ 0.64 BW, etc.) — explicitly deferred (`docs/features.md:7`). Full-BW approximation only.
- **Secondary-muscle** fractional attribution — deferred (`docs/features.md:8`); primary-only `muscles[0]`.
- e1RM strength chart + favorites — deferred (`docs/features.md:5-6`).
- "Hard sets per muscle/week" dose metric revisit — deferred (`docs/features.md:9`).
- Consistency-over-time framing for the chart — prompt says this is a separate FUTURE concern, not this build (`state.md:23`).
- Editing/backfilling bodyweight history or prompting the user to log weigh-ins — not in scope; the feature reads whatever measurements exist.
