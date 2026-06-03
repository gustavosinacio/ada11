# Discovery — 2026-06-03_1124_progress-chart-window

## Feature prompt
> The progress graphs are showing all historycal data. We don't need this. We need to add a date picker and default the date to the selected max-volume window in the profile page.

## Scope summary
The Progress tab (`app/(app)/progress/index.tsx`) hosts two FULL-HISTORY trend charts whose week axis runs from the user's first-ever trained week to "now": the per-muscle weekly-volume chart (`<WeeklyMuscleVolumeSection>`) and the e1RM strength chart (`<E1rmStrengthSection>`). The per-exercise progress screen (`app/(app)/exercises/[id]/progress.tsx`) hosts two MORE full-history charts (e1RM + total-volume, one dot per session). The feature wants to bound these to a recent window, defaulting to the user's existing **max-volume window** profile preference. The windowing infrastructure (`useMaxVolumeWindowWeeks`, `computeWindowStart`, `windowStartMs` filters in the math kernels) already exists and is battle-tested on OTHER surfaces — this feature mostly re-uses it on the chart presenters that today deliberately opt out.

**This is an "apply X (a window filter) to N presenters" feature** — per the standing Discovery lesson, the close-the-set inventory below is exhaustive-by-construction with a "no N+1th chart" verdict.

## Affected files (verified)

### In-scope chart presenters & their components (the charts the prompt targets)
- `src/utils/weekly-muscle-volume.ts:50-128` — `presentWeeklyVolumeByMuscle`. Pure presenter. Axis from earliest `completed_at` (`:59-69`). Docstring `:48` explicitly: *"Does NOT honor max_volume_window_weeks (Decision #3) — full history."* Takes injectable `now` (`:54`). **No `windowStartMs` param today.**
- `src/components/weekly-muscle-volume-section.tsx:39-159` — renders the muscle chart; calls the presenter at `:45-52` with NO window arg; reads `useLifetimeWeeklyVolume`, `useAllExercises`, `useMeasurements`. Local non-persisted `visible` Set state (`:61-71`) — the toggle precedent.
- `src/utils/e1rm-strength.ts:80-251` — `presentTopExerciseE1rm`. Pure presenter. Axis from earliest `completed_at` (`:96-106`). Docstring `:10-11` complement to the volume presenter. LOCF over the week axis (`:214-245`). Takes injectable `now` (`:85`). **No `windowStartMs` param today.**
- `src/components/e1rm-strength-section.tsx:50-185` — renders the e1RM chart; calls the presenter at `:65-72` with NO window arg. Docstring `:23-24`: *"Full-history trend viz: does NOT honor `max_volume_window_weeks`."* Same local `visible` Set + check-all idiom (`:81-91`).
- `app/(app)/exercises/[id]/progress.tsx:170-242` — per-exercise screen. The big `useMemo` builds `e1rmData` + `volumeData` (one `DataPoint` per session, all-history) AND the windowed `maxVolumeSession`. Docstring `:38-46`: both charts are "see all history"; only the "Max volume session" callout honors the window. It ALREADY imports `computeWindowStart` + `useMaxVolumeWindowWeeks` and computes `windowStartMs` (`:77-81`) — used only for the callout (`:224-227`).
- `src/components/multi-series-chart.tsx:40-90+` — the shared SVG line chart consumed by BOTH Progress-tab charts. X positions derive from `xLabels.length` (index spacing). Min pinned to 0. Empty-state when no visible series / all-zero (`:68-78`). **Does NOT own the axis** — the presenter passes `model.weeks` → `xLabels`.
- `src/components/progress-chart.tsx` — the per-exercise screen's single-series chart (`<ProgressChart>`, returns null at `<2` points). Axis = the `data` array order (per-session).

### Window infrastructure (already built — re-use target, NOT to be rebuilt)
- `src/hooks/use-preferences.ts:40-43` — `useMaxVolumeWindowWeeks(): MaxVolumeWindowWeeks`; defaults to `0` (lifetime) until prefs load. `:61-68` `useSetMaxVolumeWindowWeeks` mutation.
- `src/utils/window-utils.ts:41-49` — `computeWindowStart(weeks, now): number | undefined`. Returns `undefined` for `weeks === 0` (= "no filter, keep every row"). For `weeks > 0`: the UTC ms of the local Monday `weeks` ISO-weeks before the current ISO week. INCLUSIVE lower bound (`>=`). Single source of truth for windowing.
- `src/db/types.ts:68` — `type MaxVolumeWindowWeeks = 0 | 10 | 20 | 30 | 40 | 50`. `:74-76` `MAX_VOLUME_WINDOW_OPTIONS = [0, 10, 20, 30, 40, 50]` (the canonical ordered option set). CHECK-constrained server-side (`0009` + `0015` migrations, per `:64-66`).
- `app/(app)/profile.tsx:147-198` — where the window is configured: a segmented control over `MAX_VOLUME_WINDOW_OPTIONS`, labels `{0:"All",10:"10w",...,50:"50w"}` (`:27-34`), writes via `setMaxVolumeWindow.mutate(w)` immediately on tap (`:159`), no save button.
- `src/utils/progress-page-math.ts` — three kernels that ALREADY take an optional `windowStartMs`: `bucketLifetimeWeeklyVolumes(rows, windowStartMs?, bodyweight?)` (`:74-95`; filters on `sessions.started_at >= windowStartMs`, `:82-84`), `computeLifetimeMaxPerExercise(rows, windowStartMs, …)` (`:222`), `computePrsThisWeek({…, windowStartMs, …})` (`:358`). **These are the tested precedent for "add a windowStart filter to a presenter."**
- `src/hooks/use-progress-page.ts` — the three hooks that already plumb the pref into those kernels: `useLifetimeBestWeek` (`:64-88`), `usePrsThisWeek` (`:128-172`), `useExercisesThisWeek` (`:248-380`). Each does `const weeks = useMaxVolumeWindowWeeks(); const windowStartMs = useMemo(() => computeWindowStart(weeks, new Date()), [weeks]);` — the exact wiring template for the in-scope sections.

### Prior-art selector (NOT a date picker — clarified in Unknown 1)
- `src/components/week-selector.tsx:39-305` — the strip's scroll-position selector: `<VisibleRangePill>` (imperative-handle pill) + `<WeekSelectorModal>` (year + month chips bottom-sheet) + `<WeekSelectorHeader>`. **This is a SCROLL-JUMP affordance, not a window/range filter** — it scrolls the strip to a chosen month; it does not bound the data. Useful UI precedent for "tappable pill opens a bottom-sheet of discrete choices."
- `src/components/weekly-volume-strip.tsx:78-350` + `src/utils/weekly-volume-strip-math.ts:49-111` — `computeStripModel`. The 8-bar strip. **Already effectively "windowed" by horizontal scroll** (renders all weeks but viewport shows ~8). NOT in scope per Unknown 9.

### Tests (conventions below)
- `tests/unit/weekly-muscle-volume.test.ts` (fixed `NOW = new Date(2026,4,18,...)`, `:18`), `tests/unit/e1rm-strength.test.ts` (29 KB, `now: NOW` injected throughout), `tests/unit/window-utils.test.ts`, `tests/unit/progress-page-math.test.ts` (60 KB — the windowing kernels' tests).
- `tests/e2e/weekly-muscle-volume.spec.ts`, `tests/e2e/e1rm-strength.spec.ts`, `tests/e2e/exercise-progress-ia.spec.ts`, `tests/e2e/progress-page.spec.ts`, `tests/e2e/max-volume-window.spec.ts`, `tests/e2e/chart-scroll-week-selector.spec.ts`.

## Relevant conventions (verified by reading code)
- **Presenters are pure + take injectable `now: Date`** (default `new Date()`), so tests pin time deterministically (`weekly-muscle-volume.test.ts:8,18`; `e1rm-strength.ts:85`). Any new `windowStartMs` param must keep this purity.
- **Windowing is anchored on `sessions.started_at`, bucketing on `completed_at`** (dual-anchor, `progress-page-math.ts:69-72`; mirrored in the per-exercise callout `progress.tsx:224-226`). The lower bound is INCLUSIVE (`>=`). A new chart-window filter MUST follow the same dual-anchor rule to stay consistent with "Max" numbers, or the same exercise would show inconsistent windows across surfaces. FACT, verified by reading both sites.
- **The window value `0` means "lifetime / no filter"** (`computeWindowStart` returns `undefined`; kernels skip the filter). Verified `window-utils.ts:45`.
- **Local, non-persisted UI state is the established pattern for chart controls** — both sections seed a `visible` Set from the current series and re-seed on series-signature change (`weekly-muscle-volume-section.tsx:61-71`, `e1rm-strength-section.tsx:81-91`). The strip's week-selector keeps modal state local (`week-selector.tsx:286`). FACT.
- **The window is a single shared preference written immediately on tap in Profile** (`profile.tsx:159`) — `setQueryData` updates the cache (`use-preferences.ts:49,66`). It is read by MANY surfaces (Progress hero `progress-hero.tsx:43`, exercises-this-week, per-exercise callout `progress.tsx:77`, end-of-session verdict `verdict/[sessionId].tsx:51`, volume-target slot `volume-target-slot.tsx:53`). FACT — relevant to Unknown 4 (write-back would ripple to all of these).
- **NativeWind segmented-control idiom** for option sets: `flex-1 rounded-md py-2` pressables, active = `bg-black dark:bg-white` (`profile.tsx:78-82,169-173`). The reusable pattern if a discrete weeks-selector is chosen.
- **Axis builder**: both in-scope presenters use `isoWeeksBetween(firstMonday, currentMonday)` (`dates.ts:105`) where `firstMonday = isoWeekStart(new Date(earliestMs))`. So filtering rows BEFORE `earliestMs` is computed auto-shrinks the axis to the first in-window week. FACT, verified.

## Constraints
- **Data**: No new table/column/migration needed — the pref column `user_preferences.max_volume_window_weeks` already exists (`schema.ts:42`, `db/types.ts:64-66`). All reads are client-side over the already-fetched lifetime dataset (`useLifetimeWeeklyVolume`); no new query. The per-exercise screen reads `useExerciseProgress` (per-session sets) — also client-side.
- **UI**: Two Progress-tab charts share `<MultiSeriesChart>`, which derives its x-axis from `model.weeks.length`. **Windowing changes the axis** (fewer weeks) — that is the core seam (Unknown 5). Charts live inside a `<ScrollView>` Progress page; the per-exercise screen is a separate route.
- **Platform**: Expo / React Native + web export (expo-router). **NO native date-picker / calendar library is installed** — verified `package.json`: only `date-fns@4` + `date-fns-tz@3`; no `@react-native-community/datetimepicker`, no `react-native-calendars`, no `react-native-modal-datetime-picker`. A true calendar date picker would require a NEW dependency that must also work on web. FACT — load-bearing for Unknown 1.
- **Auth**: All data is the signed-in owner's; RLS already governs the underlying queries. No auth changes.
- **Performance**: All filtering is in-memory over the lifetime rows already in the TanStack cache; the window only SHRINKS the working set. No new network. The memo dep convention (`new Date()` lives inside the factory, deps = `[weeks, data]`) must be preserved to avoid per-render recompute (`use-progress-page.ts:72-79`).

## Existing precedents
- **The exact wiring to copy** (HIGH confidence): `useLifetimeBestWeek` (`use-progress-page.ts:64-88`) reads `useMaxVolumeWindowWeeks()` → `computeWindowStart(weeks, new Date())` → passes `windowStartMs` into a kernel inside a `useMemo`. Replicate in `<WeeklyMuscleVolumeSection>` and `<E1rmStrengthSection>` (or, cleaner, pass `windowStartMs`/`now` as a prop from the Progress page so a single control governs both — Unknown 3).
- **The kernel param to copy**: `bucketLifetimeWeeklyVolumes`'s `windowStartMs?` filter (`progress-page-math.ts:82-84`) is the precise shape `presentWeeklyVolumeByMuscle` and `presentTopExerciseE1rm` need — a `parseISO(row.sessions.started_at).getTime() >= windowStartMs` skip near the top of the row loop (muscle: before the `:92` loop; e1rm: before the `:119` loop).
- **The per-exercise callout already does session-level windowing inline** (`progress.tsx:224-226`) — the same `inWindow` predicate would extend to gate the `e1rm`/`vol` `DataPoint.push` calls if that screen is brought in scope.
- **Discrete-option control precedent**: the Profile segmented control (`profile.tsx:147-198`) is the natural shape for an in-chart weeks-selector that mirrors the pref options.
- **Bottom-sheet discrete picker precedent**: `<WeekSelectorModal>` (`week-selector.tsx:105-258`) if a more compact pill-opens-sheet affordance is wanted.

## Close-the-set: the "progress graphs" inventory (exhaustive-by-construction)
Every chart/graph surface in the app, with its current windowing status:

| # | Chart | File:line | Today | In scope? |
|---|---|---|---|---|
| 1 | Per-muscle weekly volume (Progress tab) | `weekly-muscle-volume.ts:48` / `weekly-muscle-volume-section.tsx` | FULL history (explicit opt-out) | **YES** |
| 2 | e1RM strength (Progress tab) | `e1rm-strength.ts:10` / `e1rm-strength-section.tsx:23-24` | FULL history (explicit opt-out) | **YES** |
| 3 | Per-exercise e1RM trend | `progress.tsx:170-242,292-297` | FULL history (deliberate `:38-46`) | Unknown 2 — recommend NO |
| 4 | Per-exercise total-volume trend | `progress.tsx:299-306` | FULL history (deliberate `:38-46`) | Unknown 2 — recommend NO |
| 5 | 8-bar weekly volume strip | `weekly-volume-strip.tsx` / `weekly-volume-strip-math.ts` | All weeks, scroll-windowed | Unknown 9 — recommend NO |
| 6 | Measurements chart | `measurements-chart.ts` (Measurements screen, not "progress") | n/a | NO (not a progress graph) |

**Verdict (HIGH confidence)**: charts #1 and #2 are the unambiguous in-scope targets — they are the only two that (a) live on the Progress tab the prompt names AND (b) carry the identical "does NOT honor max_volume_window_weeks" opt-out comment the prompt is reversing. #3/#4 (per-exercise) and #5 (strip) are decision points for the human (Unknowns 2 & 9). No N+1th progress chart exists outside this table — verified by `grep -rn "MultiSeriesChart\|ProgressChart\|computeStripModel\|present.*(E1rm\|Volume)" src/ app/`.

## Unknowns (require Designer judgment or human decision)
Ranked by how much they change the design (most → least).

### 1. "date picker" semantics — discrete weeks-selector vs true calendar range?
- **(a) What**: The prompt says "add a date picker" but also "default the date to the selected max-volume window." A weeks-window (10/20/…) is NOT a calendar date — these are two different controls.
- **(b) Why it matters**: A true calendar date-range picker needs a NEW cross-platform dependency (none installed — FACT, `package.json`), changes the whole math seam from "weeks-window → `windowStartMs`" to "arbitrary start/end → bucket boundaries," and breaks the dual-anchor `started_at`-vs-`completed_at` consistency with the windowed "Max" numbers. A discrete weeks-selector re-uses `MAX_VOLUME_WINDOW_OPTIONS` + `computeWindowStart` verbatim and stays consistent with every other windowed surface.
- **(c) Recommended default (MEDIUM confidence)**: A **discrete weeks-window selector** mirroring `MAX_VOLUME_WINDOW_OPTIONS` (the same `0/10/20/30/40/50` set as Profile), NOT a calendar picker. It satisfies "default to the max-volume window," re-uses tested infra, adds no dependency, and keeps cross-surface number consistency. Read "date picker" as "time-range selector." **Flag to the human if they truly meant arbitrary calendar dates** — that is a materially larger feature (new dep, new lower-bound math, web parity).

### 2. Which charts are in scope — Progress TAB only, or also the per-exercise screen?
- **(a) What**: "The progress graphs" is ambiguous. Candidates: muscle chart + e1RM chart (Progress tab) and/or e1RM + total-volume charts (per-exercise screen).
- **(b) Why it matters**: The per-exercise screen's trend charts are *deliberately* "see all history" by an explicit prior design decision (`progress.tsx:38-46`), and its "Max volume session" callout already windows. Bringing the window to its trend charts contradicts that documented decision and needs the human's intent.
- **(c) Recommended default (MEDIUM confidence)**: Scope to the **two Progress-TAB charts** (`<WeeklyMuscleVolumeSection>` + `<E1rmStrengthSection>`) — those are reached via the "Progress" tab the prompt names, both share `<MultiSeriesChart>`, and both currently carry the identical "does NOT honor max_volume_window_weeks" opt-out the prompt is reversing. Leave the per-exercise screen out unless the human says otherwise. Confirm with the human.

### 3. Per-chart control vs one page-level control?
- **(a) What**: One window selector governing both Progress-tab charts, or an independent control per chart?
- **(b) Why it matters**: Determines where state lives (Progress page vs each section) and how many controls render.
- **(c) Recommended default (MEDIUM-HIGH confidence)**: **One page-level control** on the Progress page, threading `windowStartMs` (or `weeks` + `now`) as a prop into both sections — mirrors how `bestWeekKg`/`bestWeekLabel` are already threaded from the page into `<WeeklyVolumeStrip>` (`progress/index.tsx:70-73`). Simpler mental model ("the whole Progress page shows the last N weeks") and one place to seed the default. Per-chart controls add clutter for no clear benefit.

### 4. Ephemeral local state vs write-back to the stored preference?
- **(a) What**: When the user changes the chart window, is it local UI state (seeded from the pref) or does it persist to `max_volume_window_weeks`?
- **(b) Why it matters**: Writing back would silently change the "Max"/"Best week"/PR numbers across the WHOLE app — Progress hero, exercises-this-week, per-exercise callout, end-of-session verdict, volume-target slot all read this same pref (enumerated in Conventions). That is a surprising side effect of "adjust a chart."
- **(c) Recommended default (HIGH confidence)**: **Ephemeral local state, default-seeded from `useMaxVolumeWindowWeeks()`**, NOT written back. Matches the established non-persisted chart-control pattern (`weekly-muscle-volume-section.tsx:61-71`) and avoids cross-surface side effects. The prompt's "default the date to the selected max-volume window" reads as *seed*, not *bind*. (If the human wants the chart window to ALSO update the profile pref, that's Unknown-4-alt — flag it.)

### 5. Axis-derivation & LOCF when the window shrinks the data — what does the x-axis become?
- **(a) What**: Both presenters derive the LEFT axis edge from the earliest `completed_at` across ALL rows (`weekly-muscle-volume.ts:59-69`, `e1rm-strength.ts:96-106`), then build `isoWeeksBetween(firstMonday, currentMonday)`. If windowing drops old rows, does the axis start at the window's lower bound or at the earliest *remaining* row?
- **(b) Why it matters**: If you filter rows BEFORE computing `earliestMs`, the axis auto-shrinks to the first in-window week (clean). But the e1RM presenter's **LOCF lead-in** (`e1rm-strength.ts:229-243`) back-fills leading weeks with the first real value — windowing changes which value is "first," so a line's flat lead-in shifts. Also: an exercise whose ONLY sets are outside the window drops out of the top-N entirely (changes which lines appear), and the muscle chart could lose a whole muscle series. These are correct behaviors but must be specified and tested.
- **(c) Recommended default (MEDIUM confidence)**: Apply the `started_at >= windowStartMs` filter at the TOP of each presenter's row loop (before `earliestMs` is computed) so the axis naturally starts at the first in-window week and `isoWeeksBetween` does the rest — exactly mirroring how `bucketLifetimeWeeklyVolumes` filters then buckets. Accept that top-N membership and LOCF lead-in recompute over the windowed set (that is the point of the feature). Designer should write explicit unit cases for: (i) axis left-edge = first in-window week, (ii) an exercise with all sets pre-window drops out, (iii) LOCF lead-in over the windowed first week.

### 6. Empty-window state — what renders when the window excludes all data?
- **(a) What**: A user with data only older than the selected window → both presenters return `series: []`, and the sections currently `return null` (`weekly-muscle-volume-section.tsx:85`, `e1rm-strength-section.tsx:109`).
- **(b) Why it matters**: With a page-level control, a `null` section means the control could vanish along with the chart, trapping the user (no way to widen the window back). Today there's no such control, so the null branch is fine.
- **(c) Recommended default (MEDIUM confidence)**: Keep the window control mounted INDEPENDENTLY of the chart's null branch (render the selector above the chart at page level, so it persists even when the chart shows an empty state). Show `<MultiSeriesChart>`'s built-in "No data yet" empty state (`multi-series-chart.tsx:68-78`) rather than a bare `null` when a window is active. Designer to specify.

### 7. Default selector option set — exactly `MAX_VOLUME_WINDOW_OPTIONS`?
- **(a) What**: Should the chart selector offer the identical `0/10/20/30/40/50` set, or a chart-tuned set (e.g. 4/8/12 weeks for a tighter trend view)?
- **(b) Why it matters**: Re-using `MAX_VOLUME_WINDOW_OPTIONS` keeps one source of truth and lets `computeWindowStart` work unchanged; a custom set needs its own constant + possibly a different type.
- **(c) Recommended default (MEDIUM confidence)**: Re-use `MAX_VOLUME_WINDOW_OPTIONS` verbatim so the default seed (the pref value) is always a valid selectable option and `computeWindowStart(weeks, now)` works with zero new math. If product wants finer-grained chart windows, that's a separate type/constant decision — flag it.

### 8. Does the "Max-volume-window" Profile label/semantics need clarifying?
- **(a) What**: The pref is named "Max-volume window — how many recent weeks to compare against" (`profile.tsx:188-190`). If the chart now also uses it as a default view window, its meaning broadens from "Max comparison baseline" to "default chart range."
- **(b) Why it matters**: Minor copy/IA question — could confuse users if one control governs two different things.
- **(c) Recommended default (LOW-MEDIUM confidence)**: No Profile copy change in this run; the chart selector is independent (ephemeral) and merely SEEDS from the pref. If the Designer chooses write-back (Unknown 4-alt), revisit the label. Out of scope for the default plan.

### 9. Is the 8-bar weekly volume strip in scope?
- **(a) What**: `<WeeklyVolumeStrip>` is a "progress graph" too.
- **(b) Why it matters**: It already shows full history but is *windowed by horizontal scroll* (viewport ≈ 8 weeks) and has its own week-selector. Adding a window filter would conflict with its scroll model and the lifetime-best overlay.
- **(c) Recommended default (HIGH confidence)**: **Out of scope.** The strip already solves "don't show everything at once" via scroll, and its overlay/denominator logic (`weekly-volume-strip.tsx:230-240`, plus the intentional NEW-MIN-3 asymmetry note `progress/index.tsx:60-69`) was deliberately designed NOT to shrink to the window. Excluding it avoids re-litigating that decision. Confirm with the human.

## Out-of-scope flags
- **No migration / schema / API change** — the pref column and the `windowStartMs` kernels already exist. This is a presenter + UI-control change only. Do NOT add a column.
- **Do NOT rebuild windowing math** — `computeWindowStart` + the `windowStartMs` kernel pattern are the source of truth; the new presenter params consume them, they are not re-derived.
- **Do NOT add a calendar/date-picker dependency** under the recommended (discrete-weeks) plan — only if the human explicitly confirms Unknown 1 wants true calendar dates.
- **Do NOT touch the Profile control or write back to the pref** under the recommended (ephemeral) plan (Unknown 4).
- **Working-tree noise (ignore for scoping)**: the 5 pre-existing cache-buster edits flagged in `state.md:12-20` (`src/lib/query-client.ts`, `src/utils/progress-page-math.ts`, `src/utils/weekly-volume-strip-math.ts`, `src/hooks/use-progress-page.ts`, `app/(app)/history/week/[isoWeek].tsx`) — confirmed present via `git status`, all unrelated to this feature. Treat as out-of-run noise at diff time.
