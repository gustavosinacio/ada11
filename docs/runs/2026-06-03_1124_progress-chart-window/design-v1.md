# Design v1 — 2026-06-03_1124_progress-chart-window

## Feature
Add a time-range (window) selector to the two Progress-TAB trend charts, defaulting to the user's `max_volume_window_weeks` profile preference. Today both charts deliberately show full history. The window is **view-only / ephemeral** — it never writes back to the stored preference.

Per the human's locked decisions (`state.md:46-51`): discrete weeks selector reusing `MAX_VOLUME_WINDOW_OPTIONS` (`0/10/20/30/40/50`, `0` = "All / lifetime"); scope = `<WeeklyMuscleVolumeSection>` + `<E1rmStrengthSection>` ONLY; ephemeral local state seeded from `useMaxVolumeWindowWeeks()`. No calendar dependency. No Profile change. No migration.

---

## Approach

### The seam (one sentence)
Give each in-scope **presenter** an OPTIONAL `windowStartMs?: number` param that, when present, drops rows whose `sessions.started_at` is strictly before the threshold — exactly mirroring `bucketLifetimeWeeklyVolumes` (`progress-page-math.ts:82-84`); add ONE page-level discrete weeks selector that computes `windowStartMs` once and threads it as a prop into both sections.

### Why a presenter-level optional param (not a section-level pre-filter)
The presenters own the axis derivation (`earliestMs` → `firstMonday` → `isoWeeksBetween`, muscle `:59-69`, e1RM `:96-106`). If the filter lives in the section (pre-filtering `rows` before the presenter call), the axis would auto-shrink correctly **but** we would re-implement the dual-anchor filter (`started_at` inclusion + `completed_at` bucketing) in the component, duplicating tested kernel logic and breaking the purity/testability that lets `progress-page-math.test.ts` pin every window edge. Putting the filter INSIDE the presenter (a) reuses the exact precedent shape, (b) keeps the section thin, (c) lets the new behavior be unit-tested deterministically with the existing injectable-`now` fixtures. This is the same architectural call the prior bodyweight run validated as "new optional dependency that reproduces old numbers when absent" (Designer feedback, bodyweight-volume run).

### Why thread a pre-computed `windowStartMs` (not raw `weeks`) into the sections
Two candidate prop contracts:
- **(A) Pass `windowStartMs?: number`** — Progress page calls `computeWindowStart(weeks, new Date())` ONCE inside a memo, threads the number down. Sections stay free of windowing math; the presenter receives the exact same `number | undefined` the page-math kernels already consume.
- **(B) Pass `weeks` + `now`** — each section calls `computeWindowStart` itself.

**Chosen: (A).** It keeps `new Date()` in exactly ONE place (the page memo), so both charts share an identical threshold for the same render — under (B) the two sections could each capture `new Date()` microseconds apart and (across a midnight Monday rollover) compute different thresholds, silently desyncing the two charts. (A) also matches how the page already threads a single derived value (`bestWeekKg`/`bestWeekLabel`) into `<WeeklyVolumeStrip>` (`progress/index.tsx:70-73`). The presenters keep their injectable `now` for unit tests; `windowStartMs` and `now` are independent inputs (tests pass both explicitly).

### The no-window invariant (Invariant W — load-bearing)
**When `windowStartMs` is absent (`undefined`), each presenter MUST produce byte-for-byte today's full-history output.** This is provable by construction: the only new code is `if (windowStartMs !== undefined) { … continue; }` guards. When `windowStartMs === undefined`, every guard is skipped and both row loops are identical to today. The default seed flows `weeks=0 → computeWindowStart(0, …) → undefined → no filter`, so a user who never opened Profile (default pref `0`) sees the exact pre-feature chart. Unit tests assert this against the existing populated fixtures (case W-0 below).

### Where the two row loops are
**Subtlety Discovery's "filter at the top of the row loop" phrasing under-specifies:** each presenter loops `rows` TWICE — once to compute `earliestMs` (the axis left edge) and once to bucket. The filter must guard **BOTH** loops, or the axis would still start at a pre-window week (computed from the unfiltered `earliestMs`) even though no data lands there. Specifically:
- `presentWeeklyVolumeByMuscle`: loop 1 = `:61-64` (earliest), loop 2 = `:92-113` (bucket).
- `presentTopExerciseE1rm`: loop 1 = `:98-101` (earliest), loop 2 = `:119-150` (aggregate).

The guard is the identical 3-line block in all four loop heads.

---

## Window semantics (restated — must agree with the existing windowed "Max" numbers)

- **Dual anchor (FACT, `progress-page-math.ts:64-72`):** INCLUSION is decided on `sessions.started_at`; BUCKET placement stays on `completed_at`. A session is included or excluded as one indivisible unit (never split mid-session across the boundary). The new chart filter follows this rule verbatim so the same exercise shows the SAME window on the chart as on the "Max" callouts elsewhere.
- **Inclusive lower bound (`>=`)** — `computeWindowStart` returns the Monday-00:00 instant `weeks` ISO-weeks before the current ISO week (`window-utils.ts:41-49`). A session at exactly the threshold counts as in-window. The filter therefore drops only `startedMs < windowStartMs`.
- **`0` → `undefined` → no filter.** `computeWindowStart(0, now)` returns `undefined` (`window-utils.ts:45`); the presenter skips the guard → Invariant W. Verified.
- **Current ISO week sits OUTSIDE the threshold by design** for `weeks > 0` (`window-utils.ts:31-36`). This is intentional and consistent with the Max numbers — not a chart bug.

---

## Exact file changes

| # | File | Type | Responsibility | Change |
|---|---|---|---|---|
| F1 | `src/utils/weekly-muscle-volume.ts` | edited | presenter (PURE) | Add `windowStartMs?: number` to `args`; add the inclusion guard to BOTH row loops (`:61-64` earliest, `:92` bucket); refresh the `:48` docstring line. |
| F2 | `src/utils/e1rm-strength.ts` | edited | presenter (PURE) | Add `windowStartMs?: number` to `args`; add the inclusion guard to BOTH row loops (`:98-101` earliest, `:119` aggregate); refresh the `:23-24`-equivalent docstring. |
| F3 | `src/db/types.ts` | edited | shared constant | Lift the `MAX_VOLUME_WINDOW_LABELS` map (currently private in `profile.tsx:27-34`) into `db/types.ts` next to `MAX_VOLUME_WINDOW_OPTIONS` (`:74-76`) and `export` it, so the new selector and Profile share ONE source of truth. No type/value change. |
| F4 | `app/(app)/profile.tsx` | edited | dedup only | Replace the private `MAX_VOLUME_WINDOW_LABELS` (`:27-34`) with an import from `~/db/types`. Pure refactor — no behavior change. |
| F5 | `src/components/progress-window-selector.tsx` | new | UI control (presentational) | New stateless segmented-control component. Renders `MAX_VOLUME_WINDOW_OPTIONS` as pressables (Profile idiom `profile.tsx:151-187`), highlights the active value, calls `onChange(weeks)`. Owns NO state. |
| F6 | `app/(app)/progress/index.tsx` | edited | page state + wiring | Hold the ephemeral `windowWeeks` state (seeded from `useMaxVolumeWindowWeeks()`), compute `windowStartMs` once via memo, render `<ProgressWindowSelector>` ABOVE the two sections, thread `windowStartMs` into both sections. |
| F7 | `src/components/weekly-muscle-volume-section.tsx` | edited | section wiring | Accept `windowStartMs?: number` prop; pass it into `presentWeeklyVolumeByMuscle`; add it to the model `useMemo` deps. NO local window state (page owns it). |
| F8 | `src/components/e1rm-strength-section.tsx` | edited | section wiring | Accept `windowStartMs?: number` prop; pass it into `presentTopExerciseE1rm`; add it to the model `useMemo` deps. NO local window state. |
| F9 | `tests/unit/weekly-muscle-volume.test.ts` | edited | unit tests | Add the windowed cases (W-0, W-1, W-2, W-3 below). |
| F10 | `tests/unit/e1rm-strength.test.ts` | edited | unit tests | Add the windowed cases (W-0, W-1, W-4, W-5 below). |
| F11 | `tests/e2e/progress-window-selector.spec.ts` | new | e2e | One spec exercising the page-level selector against the two charts (see Test plan). |

**Distinguishing pure vs UI changes:** F1/F2 are PURE presenter changes (testable in isolation, no React). F3/F4 are a constant relocation. F5 is a presentational component (no state). F6 is the only place that holds window STATE + computes `windowStartMs`. F7/F8 are thin prop pass-throughs. F9–F11 are tests.

---

## Contracts

### F1 — `presentWeeklyVolumeByMuscle` signature (new param)
```ts
export function presentWeeklyVolumeByMuscle(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  measurements: MeasurementEntryRow[];
  windowStartMs?: number; // NEW. Absent/undefined → Invariant W (byte-for-byte today's full-history output).
  now?: Date;             // unchanged — injectable for deterministic tests (default new Date()).
}): WeeklyMuscleVolumeModel
```
The inclusion guard, added VERBATIM at the head of BOTH `for (const row of rows)` loops (the earliest-`completed_at` loop `:61` and the bucketing loop `:92`):
```ts
if (windowStartMs !== undefined) {
  const startedMs = parseISO(row.sessions.started_at).getTime();
  if (startedMs < windowStartMs) continue;
}
```
(`WeeklyVolumeRow.sessions.started_at` is guaranteed present — `stats.ts:29`, `!inner` join `stats.ts:34`.)

### F2 — `presentTopExerciseE1rm` signature (new param)
```ts
export function presentTopExerciseE1rm(args: {
  rows: WeeklyVolumeRow[];
  exercises: ExerciseRow[];
  topN?: number;                              // unchanged
  favoriteExerciseIds?: ReadonlySet<string>;  // unchanged
  windowStartMs?: number;                     // NEW. Absent/undefined → Invariant W.
  now?: Date;                                 // unchanged
}): E1rmStrengthModel
```
Same 3-line guard, added VERBATIM at the head of BOTH loops (earliest-`completed_at` loop `:98` and the aggregate loop `:119`).

### F3 — exported shared label map (`db/types.ts`)
```ts
export const MAX_VOLUME_WINDOW_LABELS: Record<MaxVolumeWindowWeeks, string> = {
  0: "All", 10: "10w", 20: "20w", 30: "30w", 40: "40w", 50: "50w",
};
```
Moved verbatim from `profile.tsx:27-34` (identical keys/values). `profile.tsx` (F4) imports it instead of redeclaring.

### F5 — `<ProgressWindowSelector>` prop contract (NEW component, no state)
```ts
export function ProgressWindowSelector(props: {
  value: MaxVolumeWindowWeeks;
  onChange: (weeks: MaxVolumeWindowWeeks) => void;
}): React.JSX.Element
```
Renders `MAX_VOLUME_WINDOW_OPTIONS.map(...)` using the Profile segmented-control classes (`flex-1 rounded-md py-2`, active `bg-black dark:bg-white`, `profile.tsx:169-173`), labelled via `MAX_VOLUME_WINDOW_LABELS`, `accessibilityRole="button"`, `accessibilityState={{ selected: value === w }}`. `onPress` short-circuits when already-active (mirrors `profile.tsx:158`). It is purely presentational — no preference write, no local state.

### F6 — Progress page state + wiring (`progress/index.tsx`)
```ts
const prefWeeks = useMaxVolumeWindowWeeks();           // existing import :11,:40 (already read for bestWeekLabel)
const [windowWeeks, setWindowWeeks] =
  useState<MaxVolumeWindowWeeks>(prefWeeks);           // ephemeral; default-SEEDED from the pref.
// `new Date()` lives INSIDE the factory (matches use-progress-page.ts:76-79) so the
// memo only re-runs when `windowWeeks` changes; threshold is correct for ~24h.
const windowStartMs = useMemo(
  () => computeWindowStart(windowWeeks, new Date()),
  [windowWeeks],
);
```
Render order inside the `<ScrollView>` (Unknown 6 — selector mounted ABOVE the charts, independent of either chart's null branch):
```tsx
<ProgressWindowSelector value={windowWeeks} onChange={setWindowWeeks} />
<WeeklyMuscleVolumeSection windowStartMs={windowStartMs} />
<E1rmStrengthSection windowStartMs={windowStartMs} />
```
New imports: `useState`, `useMemo` from `react`; `computeWindowStart` from `~/utils/window-utils`; `MaxVolumeWindowWeeks` from `~/db/types`; `ProgressWindowSelector` from `~/components/progress-window-selector`. `useMaxVolumeWindowWeeks` is ALREADY imported (`:11`).

**Seed-vs-bind decision (Unknown 4 — locked ephemeral):** `useState(prefWeeks)` reads the pref ONCE on mount. We do NOT re-sync `windowWeeks` to `prefWeeks` on later pref changes (no `useEffect`), because the chart window is now user-owned local state — re-syncing would yank the user's chart view if they changed the Profile pref in another tab. The pref is a SEED, not a BIND. (If the pref hook returns the default `0` before prefs load, then resolves to the stored value, the seed captures `0`; see Risk R-6 for the mitigation.)

### F7 / F8 — section prop contract
Both sections gain an identical optional prop and pass it through:
```ts
// weekly-muscle-volume-section.tsx
export function WeeklyMuscleVolumeSection(props: {
  windowStartMs?: number;
}): React.JSX.Element | null
// model memo:
return presentWeeklyVolumeByMuscle({ rows, exercises, measurements: measurements ?? [], windowStartMs: props.windowStartMs });
// deps: [rows, exercises, measurements, props.windowStartMs]

// e1rm-strength-section.tsx
export function E1rmStrengthSection(props: {
  windowStartMs?: number;
}): React.JSX.Element | null
// model memo:
return presentTopExerciseE1rm({ rows, exercises, favoriteExerciseIds: favoriteSet, windowStartMs: props.windowStartMs });
// deps: [rows, exercises, favoriteSet, props.windowStartMs]
```
**The existing local `visible` Set state stays** in each section (it governs per-series toggles, orthogonal to windowing). It re-seeds on `seriesKeysSig` change (`weekly-muscle-volume-section.tsx:67-71`, `e1rm-strength-section.tsx:87-91`) — which is exactly correct: when the window drops/adds a series, the signature changes and visibility re-seeds to "all on." No new state needed for that; it falls out of the existing mechanism. **Verify:** changing `props.windowStartMs` → `model` recomputes → `seriesKeys` changes → `seriesKeysSig` changes → `visible` re-seeds. (Confirmed by tracing the existing `if (lastSig !== seriesKeysSig)` block.)

### Where the default is seeded / where state lives
- **Seeded** in `progress/index.tsx` via `useState<MaxVolumeWindowWeeks>(useMaxVolumeWindowWeeks())` (F6).
- **State lives** ONLY at the page level (`windowWeeks`). Sections are stateless w.r.t. windowing.
- **`windowStartMs` computed** ONCE at the page level; threaded as a number prop.

---

## Edge cases / behaviors to test

1. **Axis left-edge = first in-window week.** With `windowStartMs` set, both presenters compute `earliestMs` over the FILTERED rows, so `firstMonday` = the Monday of the earliest in-window session and `isoWeeksBetween` builds a shorter axis. (Covered: W-1, W-3.)
2. **An exercise/muscle whose only sets are pre-window drops out.** Muscle: a muscle with all sets before the threshold yields no entry in `byMuscle` → not emitted. e1RM: an exercise with all sets pre-window never enters `byExercise` → never eligible → cannot consume a top-N slot. Top-N membership recomputes over the windowed set (intended). (Covered: W-2, W-4.)
3. **e1RM LOCF lead-in recomputed over the windowed set.** Which value is "first real" changes when leading weeks are filtered out; the flat lead-in (`e1rm-strength.ts:229-243`) backfills from the first in-window real cell. (Covered: W-5.)
4. **Empty-window state with the selector still mounted (Unknown 6).** A window that excludes ALL of a user's data → presenter returns `series: []` → section returns `null` (`weekly-muscle-volume-section.tsx:85`, `e1rm-strength-section.tsx:109`). Because `<ProgressWindowSelector>` is rendered at the PAGE level ABOVE the sections (F6), it stays mounted even when both charts vanish — the user can always widen the window back. **Behavior:** the two sections render nothing; the selector persists. (We do NOT change the sections' `null` branch to render `<MultiSeriesChart>`'s "No data yet" — keeping the selector mounted at page level already solves the trap, and forcing an empty chart frame would add a chart with no data and no axis. Accepted: in an empty window the chart area simply collapses while the selector stays.) (Covered: e2e step 3.)
5. **`0`/"All" reproduces today's output byte-for-byte (Invariant W).** `computeWindowStart(0, now) === undefined` → no guard fires → identical full-history model. (Covered: W-0, the strongest correctness anchor.)

---

## Test plan outline

### Unit — `tests/unit/weekly-muscle-volume.test.ts` (F9)
Fixtures already accept `started_at` overrides (`:27,:29`) and inject `NOW = 2026-05-18 (W21)` (`:18`). No fixture changes needed.
- **W-0 (Invariant W):** call the presenter with `windowStartMs: undefined` over an existing multi-week fixture; assert the result `deepEqual`s the same call WITHOUT the param. Proves byte-for-byte no-change.
- **W-1 (axis shrink):** rows spanning W10..W21; pass `windowStartMs = computeWindowStart(10, NOW)`; assert `model.weeks[0].key` is the first in-window Monday (not the lifetime first) and `weeks.length` shrinks accordingly.
- **W-2 (muscle drops out):** one muscle with all sets pre-window, one in-window; assert the pre-window muscle is ABSENT from `series` and the in-window one is present.
- **W-3 (boundary inclusivity):** a session whose `started_at` === the threshold instant is INCLUDED (its `completed_at` bucket appears); one at `threshold - 1ms` is EXCLUDED.

### Unit — `tests/unit/e1rm-strength.test.ts` (F10)
Same `now: NOW` injection convention (Discovery `:35`).
- **W-0 (Invariant W):** `windowStartMs: undefined` `deepEqual`s the no-param call over a populated fixture.
- **W-1 (axis shrink):** as above for the e1RM axis.
- **W-4 (top-N recompute):** an exercise whose sessions are ALL pre-window must NOT appear in `series` (cannot consume a top-N slot); confirm rank order recomputes over the windowed set.
- **W-5 (LOCF over windowed set):** an exercise with a pre-window value and an in-window value; assert the windowed series' flat lead-in uses the first IN-WINDOW real value (not the dropped pre-window one), and `values[0]` equals that in-window value.

### Unit — `tests/unit/window-utils.test.ts`
No change. `computeWindowStart` is unchanged; existing tests stay green. (Cite-only, no new cases — the helper is reused verbatim.)

### E2E — `tests/e2e/progress-window-selector.spec.ts` (F11)
Warranted: existing e2e specs cover both charts at full history (`weekly-muscle-volume.spec.ts`, `e1rm-strength.spec.ts`); the NEW user-visible behavior (a selector that shrinks both charts in lockstep) needs its own coverage. Mirror the admin-seed + UI-sign-in + navigate-to-`/progress` flow (`e1rm-strength.spec.ts:17-22`). Steps:
1. Seed a user with sessions spread across >50 weeks (some old, some recent). Sign in, go to `/progress`.
2. **Default seed:** assert the selector's active segment matches the user's pref (default "All"); both charts render full history.
3. **Shrink:** tap "10w"; assert BOTH charts' x-axis label count drops (fewer week labels) and old-only series disappear. Assert the selector stays mounted.
4. **Empty window (Unknown 6):** for a user whose data is ALL older than 10 weeks, tap "10w"; assert both sections collapse (no chart) BUT the selector is still present and tappable; tap "All" to confirm the charts return.
5. **Lockstep:** assert the same selected window governs BOTH charts (one control, two charts).
Use `.first()` on navigation locators per the suite convention (`e1rm-strength.spec.ts:21-22`); add a settle-gate (await a stable post-tap state) before count assertions to avoid the cold-`toHaveCount(0)` false-green flagged in the e1rm-strength run.

---

## Risks & alternatives considered

### Risks
- **R-1 — Cross-surface consistency (data integrity). Confidence HIGH / Risk LOW.** The chart window uses the SAME `computeWindowStart` + dual-anchor (`started_at` include / `completed_at` bucket) as the "Max"/"Best week" numbers. If the implementer applies the filter on `completed_at` instead of `started_at`, a session crossing a week boundary would window differently on the chart than on the callouts. Mitigation: the contract pins the exact 3-line guard from `progress-page-math.ts:82-84`; W-3 tests the anchor.
- **R-2 — Axis not shrinking (both-loops bug). Confidence HIGH / Risk MEDIUM.** If the guard is added to only the bucket loop and not the earliest-`completed_at` loop, the axis would still start at a pre-window week with no data plotted (a long flat dead lead-in). Mitigation: the contract explicitly names BOTH loops in each presenter; W-1 asserts `weeks[0]` is the in-window Monday.
- **R-3 — Empty-window trap (UX). Confidence HIGH / Risk LOW.** A window excluding all data makes both sections `return null`. If the selector lived inside a section, it would vanish too. Mitigation (Unknown 6): selector rendered at PAGE level above both sections; e2e step 4 verifies it persists.
- **R-4 — Per-series visibility re-seed surprise (UX regression). Confidence MEDIUM / Risk LOW.** Changing the window changes `model.series`, which re-seeds the `visible` Set to "all on" (existing `seriesKeysSig` mechanism). A user who unchecked a line, then changed the window, sees all lines re-appear. This matches the existing data-refetch behavior (a freshly appearing series should be visible) and is acceptable — but it IS a behavior the window now triggers more often. Noted, not mitigated (intended).
- **R-5 — Platform divergence (iOS / Android / web). Confidence MEDIUM / Risk LOW.** `<ProgressWindowSelector>` reuses the Profile segmented-control markup, which already renders on RN + RN-Web (Profile ships on all three). No SVG/native-only API. The two charts already share `<MultiSeriesChart>` cross-platform. Mitigation: e2e runs on the web export (the existing harness); the markup is identical to the verified Profile control.
- **R-6 — Default seed before prefs load (data integrity / UX). Confidence MEDIUM / Risk LOW.** `useMaxVolumeWindowWeeks()` returns `0` until prefs load (Discovery `:23`), then resolves to the stored value. `useState(prefWeeks)` captures whatever the hook returns on the FIRST render — likely `0` if prefs are still loading. Result: a user with a stored `20w` pref could see the chart default to "All" on a cold mount until they re-tap. Mitigation: this matches `progress/index.tsx`'s EXISTING tolerance — `bestWeekLabel` (`:44-48`) already reads `weeks` the same way and accepts the `0`-then-resolve flicker. Accepted as consistent with the page's existing behavior; NOT worth a `useEffect` re-sync (which would re-introduce the bind we explicitly rejected). If product wants the seed to wait for prefs, that's a follow-up (flag).
- **R-7 — Performance. Confidence HIGH / Risk LOW.** The filter only SHRINKS the working set; it adds one `parseISO(...).getTime()` per row per loop over the already-cached lifetime rows. No new network, no new query. `new Date()` stays inside the page memo (deps `[windowWeeks]`) so there is no per-render recompute. Identical cost profile to the existing windowed kernels.
- **R-8 — Stale pre-existing working-tree noise (process). Confidence HIGH / Risk LOW.** The 5 uncommitted cache-buster edits (`state.md:12-20`) overlap `progress-page-math.ts` and `use-progress-page.ts` — files this design does NOT functionally change. The implementer must not fold those edits into this run's diff. Mitigation: F1–F11 touch NONE of those 5 files' windowing logic; `progress-page-math.ts` is cite-only here. Conductor recommended committing the noise first (`state.md:17-18`).

### Alternatives considered
1. **Section-level filter (pre-filter `rows` before the presenter call).** Rejected: duplicates the dual-anchor filter in two components, can't be unit-tested as a pure function, and risks the `completed_at`-vs-`started_at` anchor drifting from the kernel. The presenter-param approach reuses the tested precedent.
2. **Pass `weeks` + `now` into each section; each calls `computeWindowStart` (contract B).** Rejected: two `new Date()` captures can desync the two charts across a Monday rollover; also pushes windowing math into the components. Passing one pre-computed `windowStartMs` keeps a single source of truth (chosen contract A).
3. **Per-chart selector (one control per chart) instead of one page-level control (Unknown 3).** Rejected: two controls add clutter and let the two charts disagree, contradicting the "show the whole Progress page over the last N weeks" mental model. One page-level control mirrors the existing `bestWeekKg` page-threading (`progress/index.tsx:70-73`).
4. **Persist the chart window to `max_volume_window_weeks` (write-back, Unknown 4-alt).** Rejected (locked ephemeral by the human): writing back would silently shift the "Max"/"Best week"/PR numbers across the Progress hero, exercises-this-week, per-exercise callout, end-of-session verdict, and volume-target slot (all read the same pref — Discovery `:43`). "Adjust a chart" must not mutate global app numbers.
5. **A true calendar date-range picker.** Rejected (locked): needs a new cross-platform dependency (none installed — `package.json` has only `date-fns`), changes the math seam from weeks→`windowStartMs` to arbitrary start/end, and breaks dual-anchor consistency with the Max numbers. "Date picker" reads as "time-range selector."
6. **A chart-tuned option set (e.g. 4/8/12 weeks) instead of `MAX_VOLUME_WINDOW_OPTIONS` (Unknown 7).** Rejected: a custom set needs its own constant + possibly a new type, and the default seed (the pref value) might not be a member. Reusing `MAX_VOLUME_WINDOW_OPTIONS` verbatim guarantees the seed is always a valid option and `computeWindowStart` works unchanged.
7. **Re-sync `windowWeeks` to the pref via `useEffect` when the pref changes (bind, not seed).** Rejected: yanks the user's chosen chart view if the Profile pref changes elsewhere; contradicts "ephemeral, user-owned." Seed-once is the locked behavior.
8. **Change the empty-window section branch to render `<MultiSeriesChart>`'s "No data yet" frame (Unknown 6 alt).** Rejected: keeping the selector mounted at page level already solves the no-way-back trap; forcing an empty chart frame adds a 200px-tall empty box with no axis below the selector. Collapsing the section while the selector persists is cleaner.

---

## Out of scope
- **Per-exercise progress screen** (`app/(app)/exercises/[id]/progress.tsx`) — its e1RM + total-volume trend charts are deliberately full-history (`progress.tsx:38-46`); locked OUT (Unknown 2). Its "Max volume session" callout already windows; untouched.
- **8-bar weekly volume strip** (`<WeeklyVolumeStrip>`) — already scroll-windowed; its lifetime-best overlay/denominator asymmetry was deliberately designed NOT to shrink (`progress/index.tsx:60-69`); locked OUT (Unknown 9).
- **Profile control / write-back to `max_volume_window_weeks`** — no Profile behavior change (the only Profile edit, F4, is a pure import-the-now-shared-constant refactor with zero behavior change). No pref mutation.
- **Migrations / schema / API / new query** — none. The pref column and the `windowStartMs` kernel pattern already exist; all reads are client-side over the already-cached lifetime rows.
- **New dependency** — none (no calendar/date-picker library).
- **Profile label/copy clarification (Unknown 8)** — the chart selector is independent and merely seeds; no Profile copy change this run.
- **Pre-existing uncommitted cache-buster edits** (`src/lib/query-client.ts`, `src/utils/progress-page-math.ts`, `src/utils/weekly-volume-strip-math.ts`, `src/hooks/use-progress-page.ts`, `app/(app)/history/week/[isoWeek].tsx`, + rebuilt `dist/`) — UNRELATED noise from a prior task (`state.md:12-20`). This run does not touch their windowing logic; the Evaluator should treat them as out-of-run noise at diff time.

---

## Peer invocations
None. The locked decisions and the verified source reads (presenter signatures, the exact filter shape, the wiring template, the segmented-control idiom) fully determined the design — no Discovery re-recon needed.
