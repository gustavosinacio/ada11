# Discovery — 2026-05-21_1505_exercise-volume-target

## Feature prompt

From `docs/features.md:3` and `state.md`:

> "While training, each exercise should show the amount of total volume left to achieve the previous max volume of that exercise. It should also calculate, using the current used weights, the amount of reps left to surpass that volume. Those reps can be shown with floating points like '7.2 reps'."

Conductor context: for each exercise on the live workout screen, surface two computed numbers — (1) **volume gap**: how much more `weight × reps` is needed in this session to surpass the user's prior best single-session volume for that exercise; (2) **reps left**: at the current weight, how many additional reps surpass that volume (fractional is fine, e.g. "7.2 reps").

## Scope summary

Add a per-exercise progress strip inside `<ExerciseBlock>` on the live-workout screen (`app/(app)/workout/[sessionId].tsx`) that compares the running session-volume for that exercise to the user's previous best single-session volume of the same exercise, and displays both a "kg to beat" number and a "reps left at current weight" number. **No schema change, no new API call required** if we reuse the existing `useExerciseProgress(exerciseId)` cache (already finished-session-scoped and grouped per session, ready to `Math.max` over). The work is roughly: (a) one pure helper to compute `previousMaxKg` / `runningKg` / `repsToBeat` from the two existing data sources, (b) one new presentational component slotted into `<ExerciseBlock>`, (c) a guard for the read-only branch (history detail uses the same `<ExerciseBlock>` but should NOT show the strip), and (d) one e2e probe.

## Affected files (verified)

### Will likely change

- `src/components/exercise-block.tsx:1-245` — host for the new strip. Accepts `sets: SetRow[]` (session-scoped, this exercise) at line 11. Already branches on `showCheckable` (lines 28-32, 48, 159, 178) to differentiate live vs history rendering — same flag should gate the new strip, or a sibling `showVolumeTarget?: boolean` if Designer wants them decoupled. Header lives at lines 94-114 (exercise name + muscle/equipment subtitle); column header at 154-170; sets list at 172-187; add-set actions at 189-242. Logical insertion point for a "target strip": between the header (line 114) and the column header (line 155), so it reads as a callout above the table.
- `app/(app)/workout/[sessionId].tsx:298-380` — live workout screen. Maps `orderedExercises` → `<ExerciseBlock>` (line 316). The strip is per-exercise so no new top-level fetching is needed here, BUT see Unknown #8: if the strip's previous-max data is loaded inside `<ExerciseBlock>` via `useExerciseProgress(exercise.id)`, we get one TanStack Query per exercise per render — N=`orderedExercises.length` (typically ≤8). Acceptable; see Performance.
- `app/(app)/history/[id].tsx:240-272` — history detail also renders `<ExerciseBlock>` but does NOT pass `showCheckable` (verified: only `exercise`, `sets`, `unit`, `onAddSet`, `onUpdateSet`, `onDeleteSet` are passed). The new strip must be similarly gated off here — a past session isn't a "live target" surface.

### New files expected (per architecture boundaries)

- `src/utils/volume-target.ts` (new) — pure helper. Takes `sessionsForExercise: SessionSets[]`, `currentSessionId: string`, `currentSessionSets: SetRow[]`, and returns `{ previousMaxKg, runningKg, gapKg, currentWeightKg, repsToBeat } | null`. Pure, unit-testable. Mirrors the precedent of `src/utils/measurements-chart.ts:entriesToWeightSeries` (Discovery on F5 specifically called this pattern out as the freshest).
- `src/components/exercise-volume-target.tsx` (new) OR inline JSX inside `<ExerciseBlock>` — small presentational component that renders the strip. Designer call (see Unknown #3). If new file, mirrors `weekly-volume-strip.tsx` for layout chrome.
- (optional) `tests/e2e/exercise-volume-target.spec.ts` — Tester decision.

### Read-only references

- `src/api/progress.ts:1-39` — `listSetsForExercise(exerciseId)`. Returns `SessionSets[]` (one entry per finished session) with `sets: SetRow[]` already grouped. **This is the source for `previousMaxKg`** — running `Math.max` over `sum(weight × reps)` per group, skipping warmups (same kernel as `app/(app)/exercises/[id]/progress.tsx:62-93`). Already filters `.is("deleted_at", null)` + `.not("sessions.ended_at", "is", null)`.
- `src/hooks/use-progress.ts:1-12` — `useExerciseProgress(exerciseId)` thin TanStack Query wrapper, cache key `["progress", exerciseId]`. Already invalidated on `useFinishSession.onSuccess` (`src/hooks/use-sessions.ts:63`) and on `useUpdateSessionTimes.onSuccess` (line 109). NOT invalidated on `useLogSet` / `useCheckSet` / `useDeleteSet` (verified — `src/hooks/use-sets.ts:42-90`, only `["sets", sessionId]` and `["stats"]` are invalidated). **This is by design**: the active session is excluded from `["progress"]` until Finish, so the cache stays stable during the workout — the new strip's "previous max" denominator does not change mid-session.
- `src/api/sets.ts:22-35` — `listSetsForSession(sessionId)`. Already loaded in the workout screen via `useSetsForSession` (`[sessionId].tsx:50`). The "running volume in this session" series is derived from `setsByExercise.get(ex.id) ?? []` (`[sessionId].tsx:176-184`) — exactly the `sets` prop already passed to `<ExerciseBlock>`. **No new query needed for the running-volume number.**
- `src/utils/units.ts:36-47` — `formatVolume(kg, unit)`: rounds to whole, abbreviates ≥1000 → "1.2k". Used by `weekly-volume-strip.tsx:106` and `history/week/[isoWeek].tsx:179`. Canonical formatter for aggregate volume readouts. The "gap" number should use this.
- `src/utils/units.ts:14-18` — `formatWeight(kg, unit)`: one decimal, single-set scale. Alternative if Designer wants a less abbreviated readout.
- `src/hooks/use-preferences.ts:15-18` — `useWeightUnit()`. The strip must respect the user's unit preference. Already in scope (`exercise-block.tsx:11` receives `unit: WeightUnit` as a prop today, threaded from the live screen at `[sessionId].tsx:321`).
- `src/db/types.ts:112-128` — `SetRow.weight: string | null` (PostgREST numeric → string). Always `parseFloat`; guard with `Number.isFinite` before multiplying. Existing kernel does this.
- `src/db/types.ts:32` — `SetType = "warmup" | "working" | "dropset"`. Volume kernel convention: include `working` + `dropset`, exclude `warmup`. (Verified across `exercises/[id]/progress.tsx:74`, `api/stats.ts:28`, `history/week/[isoWeek].tsx`.)
- `app/(app)/exercises/[id]/progress.tsx:62-93` — **the volume kernel this feature reuses**. Iterates `sessions[].sets`, skips warmups, accumulates `w*r`. The new pure helper should be structurally identical.
- `app/(app)/history/[id].tsx:130-150` — second precedent for per-session volume aggregation; this one counts ALL set types (a known minor divergence from the canonical kernel, flagged in F1's discovery). Not a model to follow.
- `src/components/weekly-volume-strip.tsx:62-132` — the cleanest precedent for a stat-strip component layout: loading skeleton → null-on-empty → main render with `formatVolume`. Treat as the visual template if the new strip becomes its own file.
- `src/components/measurements-progress-strip.tsx:21-71` — second strip precedent. Returns `null` on empty/error/<2 datapoints (no chrome). Sets the "render nothing if there's no story to tell" pattern.
- `src/lib/query-client.ts:8-12` — TanStack defaults: `staleTime: 30s`, `gcTime: 24h`. `["progress", exerciseId]` cache stays warm across the whole live session by default — re-mounting `<ExerciseBlock>` (e.g. when the user reorders exercises mid-session) will hit cache, not network.

### Tests potentially impacted

- `tests/e2e/crud.spec.ts` — quick-start → log set → finish flow. The new strip will appear in the live-workout view. If the strip uses an `accessibilityLabel` or testID, no spec change required (the existing assertions don't depend on the strip's presence). Verify Tester confirms.
- `tests/e2e/remove-exercise.spec.ts`, `tests/e2e/soft-deleted-exercises-in-history.spec.ts` — same shape; strip insertion shouldn't break them.
- All e2e specs were updated for the F10 set-check feature (per `2026-05-21_1308_set-check-button` discovery line 41); they now log a set, check it, then finish. The new strip layers on top of that finish-flow without changing it.

## Relevant conventions (verified by reading code)

- **Volume kernel** — single source of truth in this codebase: sum `parseFloat(weight) * reps` for `set_type !== "warmup"`, guarded with `weight > 0 && reps > 0`. Identical in `app/(app)/exercises/[id]/progress.tsx:74-82` and `src/components/weekly-volume-strip.tsx` (consumes server-pre-filtered rows). **The new helper must use this exact kernel.** Strong divergence from `history/[id].tsx:130-150` (counts warmups) is a known pre-existing nit — do NOT replicate it.
- **Previous-best definition (chosen)** — per the Conductor's prompt: previous best **single-session** volume for this exercise (NOT lifetime cumulative). This already maps 1:1 to the `SessionSets[]` shape returned by `listSetsForExercise` — `Math.max(...sessions.map(sessionVolume))`. No schema change, no new query.
- **Active session is excluded from `["progress", *]`** — by `progress.ts:14` (`.not("sessions.ended_at", "is", null)`). This is the property that makes the "previous max" denominator stable during the workout — the current session is automatically not counted against itself.
- **Running session-volume source** — `useSetsForSession(sessionId)` is already loaded and grouped per-exercise in the live screen at `setsByExercise` (`[sessionId].tsx:176-184`). The `sets` prop already passed to `<ExerciseBlock>` at line 320 is the exact subset needed. **Do not introduce a new query for the running number.**
- **Unchecked sets are still real rows post-F10** — `completed_at` is nullable; the row exists in `sets` table until either checked or discarded at Finish. (Confirmed: `src/api/sets.ts:logSet` lines 60-70 insert with `completed_at: null`. Soft-delete cascade for unchecked dropset children lives at `bulkSoftDeleteUncheckedInSession`, lines 210-246.) `useSetsForSession` returns both checked and unchecked. **Designer decision (Unknown #6): should the running-volume number include unchecked drafts?**
  - Aggressive (count all incl. unchecked): motivating, matches what the user sees in the table. But: if the user discards unchecked at Finish, the historical row will show a smaller volume than the live strip showed mid-session.
  - Conservative (count only checked): matches what will actually persist into `["progress"]`. But: less motivating because the gap number won't shrink until you tap check.
- **Unit handling** — all internal math in kg. Convert at formatter boundary via `formatVolume(kg, unit)` or `formatWeight(kg, unit)`. Already standard; the new strip plugs into the existing `unit` prop on `<ExerciseBlock>` and the `useWeightUnit()` hook used everywhere.
- **Weight input string ↔ kg** — `src/components/set-input.tsx:39-43` (`kgFromInputString`) converts user-entered values in `unit` to kg before storing. By the time a `SetRow.weight` lands in our running-volume number, it's already in kg. No conversion needed for the math, only for the display.
- **Soft delete** — every read filters `.is("deleted_at", null)`. `listSetsForExercise` already does this (`progress.ts:16`); `listSetsForSession` does too (`sets.ts:27`). No work needed for the helper — both inputs are already deleted-filtered.
- **NativeWind tokens** — `bg-white dark:bg-black`, `text-black dark:text-white`, `text-gray-500` muted, `border-gray-200 dark:border-gray-800` dividers, `px-4 py-3` padding. The strip must match. Precedent for an emphasized number in a card: `weekly-volume-strip.tsx:100-110` uses `text-2xl font-semibold tabular-nums text-black dark:text-white`. Strong's "you have X to go" UX uses a muted leading caption + a bigger value.
- **Color tokens** — `#3b82f6` blue for active/positive (used for checked-row tint at `set-input.tsx:108` and for the message-icon active state at `:180`); `#ef4444` red for destructive; `#9ca3af` muted icon stroke. Green is **not** in use anywhere today. If Designer wants a "PR achieved" celebration tint, palette decision needed (Unknown #5).
- **Accessibility labels** — every Pressable in `<ExerciseBlock>` and `<SetInput>` has `accessibilityRole="button"` + descriptive `accessibilityLabel`. The strip itself is read-only; needs `accessibilityRole="text"` (default) but should expose a readable string (e.g. `accessibilityLabel="Need 120 kilograms more to beat your previous best of 1.2k kilograms"`) so VoiceOver communicates the goal mid-workout. Tap target N/A (no interaction).
- **Stat-strip layout precedents** — `weekly-volume-strip.tsx` (full-width tile, big number + chart), `measurements-progress-strip.tsx` (one big number + line chart), `session-summary-row.tsx:55-66` ("metric · metric · metric" muted row inside list items). The new per-exercise strip is denser-context than the first two (N strips on screen at once) and should probably lean closer to the third — a compact "metric · metric" line, not a tile. Designer call.
- **Component-state vs pure helper** — `<ExerciseBlock>` already has two `useMemo` derivations (`lastWorkingSet` at 56-62, `previousByRowId` at 72-88). New derivations should be `useMemo` keyed on `[sets, progressQ.data, unit]`. Extracting the math into `src/utils/volume-target.ts` makes it unit-testable without React.
- **Cache buster** — `src/lib/query-client.ts:27`, currently `schema-2026-05-21-set-check` (bumped in F10). **No schema change in this feature**, so no buster bump needed.

## Constraints

- **Data**
  - No schema change. No new column, no migration, no `queryCacheBuster` bump. The feature is purely a presentation layer on top of two queries that already exist (`useSetsForSession`, `useExerciseProgress`).
  - RLS: both queries already inherit `auth.uid() = user_id`. No extra auth code.
  - Soft-delete and finished-session filtering already happen in `listSetsForExercise` (`progress.ts:14-16`). No work needed.
  - `SetRow.weight` is `string | null` (PostgREST numeric). Always `parseFloat` + guard with `Number.isFinite` before multiplying. Mirror `progress.tsx:75-81`.
  - `parent_set_id` semantics: a dropset's weight is its own row's `weight`, not the parent's. The volume kernel sums each row independently — already correct.
- **UI**
  - The strip lives inside an existing `<ExerciseBlock>`, which itself sits inside a vertically-scrolled `ScrollView` (`[sessionId].tsx:308`). No platform-specific layout work.
  - Visible only when `showCheckable === true` (live session) — verified by current `showCheckable` gating pattern in `<SetInput>` lines 112-127. (Or via a sibling `showVolumeTarget?: boolean` prop if Designer wants decoupling — they're equivalent today but the sibling prop is future-proofed for a "history strip too" extension.)
  - Empty / first-time state (no previous max): the strip should either hide entirely or render a celebratory "First time logging this — every working set is a PR" message. Designer call (Unknown #5).
  - Surpassed state (running ≥ previous max mid-session): celebratory message ("PR! +X kg over previous best"). Designer call.
  - Dark mode required — every existing strip ships both palettes.
- **Platform**
  - Universal — same RN component tree on iOS / Android / web. No native-only APIs.
  - `tabular-nums` (NativeWind / RN Text style) is the precedent for stat readouts (`session-header.tsx:33`, `weekly-volume-strip.tsx`). Web supports it via CSS `font-variant-numeric: tabular-nums`. No divergence.
- **Auth** — standard JWT-scoped Supabase calls.
- **Performance**
  - **Per-exercise hook usage**: If we call `useExerciseProgress(ex.id)` inside `<ExerciseBlock>` (one hook per render), we get N parallel queries where N = `orderedExercises.length`. Typical N ≤ 8 (a routine usually has 4-8 exercises). At single-user scale and 30s `staleTime`, this is a one-time fetch on workout start, then served from cache for the rest of the session. **Acceptable.** Alternative is a single batched query at the screen level (`useExerciseMaxVolumes(exerciseIds[])`), but that's premature optimization for v1 — and the current `["progress", exerciseId]` key already serves the per-exercise progress screen, so reusing it is the higher-leverage choice (warm cache wins when the user navigates between live workout and exercise progress).
  - **Volume kernel cost**: per render of `<ExerciseBlock>`, we re-reduce `sessionsForExercise` (one number out of `SessionSets[]` of length = total finished sessions touching this exercise). For a heavy user that's ~100-300 sessions over a year — single-digit-millisecond reduce. Memoize with `useMemo` keyed on `[progressQ.data, unit]`.
  - **Running-session volume**: re-reduce `sets` (already passed as prop) per render. `sets.length` ≤ ~10 per exercise. Trivial.
  - **No network round-trip on set-log**: because `["progress", exerciseId]` is NOT invalidated by `useLogSet` (verified `src/hooks/use-sets.ts:42-50`), the "previous max" number is stable for the entire session. The "running" number updates because `useSetsForSession` invalidates → new `sets` prop → new `useMemo` result. Exactly what we want.
  - **No new SQL aggregates** — feature is 100% client-side reduction over already-fetched rows.

## Existing precedents

- **F5 (`2026-05-20_0302_exercise-progress-graph`)** — the per-session volume math this feature reuses lives at `app/(app)/exercises/[id]/progress.tsx:62-93`. Identical kernel; only the reduction (`max` instead of `series`) differs.
- **F1 (`2026-05-19_2144_weekly-volume-stat`)** — established the volume-kernel convention (skip warmups, parse numeric string, guard `weight > 0 && reps > 0`), the `formatVolume` formatter, and the strip-component layout (`src/components/weekly-volume-strip.tsx`). Direct prior art for the visual.
- **F10 (`2026-05-21_1308_set-check-button`)** — set-check is *the* finish-flow change that makes "unchecked drafts can exist in `sets` table during a live session" possible (`completed_at` is now nullable; rows are bulk-soft-deleted or bulk-checked on Finish). The new strip MUST decide whether to include unchecked drafts in the running-volume number (Unknown #6). Also established `showCheckable` as the live-vs-readonly gate inside `<ExerciseBlock>` — the new strip should follow the same gating philosophy.
- **F0 design (Decision 8, `docs/decisions.md:167`)** — "personal records table (compute from `sets` on demand)" was explicitly deferred at architecture time. Computing from `sets` on demand is *exactly* what this feature does. Aligned with original architecture intent; no new "PR" table needed.
- **F1 sister precedent: pure helper extraction** — `src/utils/dates.ts` (week bucketing, shipped in F1) and `src/utils/measurements-chart.ts:30-50` (`entriesToWeightSeries`). The new `src/utils/volume-target.ts` follows the same pattern: small, pure, unit-testable, returns `null` when input is insufficient (no previous sessions / no current weight).
- **`<ExerciseBlock>` showCheckable gating** — the live-vs-readonly distinction inside `<ExerciseBlock>` is already wired (`exercise-block.tsx:48,159,178`, `set-input.tsx:65,108-127`). The strip plugs into the same flag.

## Unknowns (require Designer judgment or human decision)

1. **Data-fetch strategy** — three viable options:
   - **(A) Reuse `useExerciseProgress(exerciseId)` per `<ExerciseBlock>`**. Zero new server code; warm-cache reuse with the exercise progress screen. Pulls all sets ever for the exercise. (Recommendation from Conductor brief.)
   - **(B) New `getMaxSessionVolumeForExercise(exerciseId)` aggregate query**. Single number per exercise, smallest payload. Requires either a Postgres RPC or a client-side aggregate on a leaner select.
   - **(C) Denormalized `exercises.previous_max_volume_kg` column updated on session Finish**. Heaviest; requires schema, trigger or app-layer write. **Inconsistent with Decision 8** ("compute from sets on demand"). Not recommended.
   - **Discovery recommendation**: (A). Cache reuse with the per-exercise progress screen is a real win; payload is bounded by the user's actual training history. (B) is the right v2 if and only if profiling shows real lag — premature today.

2. **"Current weight" semantics** — the prompt says "using the current used weights" but doesn't define which weight that is. Options:
   - **(a) Most recently CHECKED set** (post-F10 check semantics) — matches what the user has confirmed they actually did. Stable; doesn't flicker as user types.
   - **(b) Most recently LOGGED set** (regardless of checked) — uses the weight in the most recent row, even if it's an unchecked draft. Updates faster but flickers as the user types.
   - **(c) Top weight of the session so far** — most aspirational; ignores the user's actual programming if they ramp down.
   - **(d) User picks target weight manually** — adds a UI affordance; explicit out-of-scope per Conductor brief.
   - **Discovery lean**: (a) for stability. The user already opted-in to "this happened" by checking. Counterargument: pre-F10 users rarely check until end of exercise, so (a) gives `null` early. **Designer decision required.** Default fallback for any option: when no candidate row has both a weight and reps recorded, hide the reps-left number (show the gap-kg number only).

3. **Display location and density** — three placements inside `<ExerciseBlock>`:
   - **(i) Inline beside the header subtitle** (lines 102-113) — most compact, but loses prominence and may collide with the muscles/equipment line.
   - **(ii) Dedicated strip between header and column-row** (insert between lines 114 and 154) — most visible. Recommendation.
   - **(iii) Below the column-row, above the first set** — least intrusive but easy to miss.
   - **Per-block visual weight**: with N blocks on screen, each strip = N additional lines. Designer should keep the strip ≤ one line tall when not in a special state (PR achieved / first time) to avoid bloating the screen.

4. **Display copy** — possible phrasings:
   - "**X kg** to beat · **7.2 reps** at 80 kg"
   - "Beat your best: **X kg** left (~7 reps @ 80 kg)"
   - Strong-style: "Previous best: **1.2k kg**. **120 kg** to go."
   - **Designer must pick one** and check with Strong-style baseline (`docs/iphone-shakedown.md:3` — every divergence from Strong is candidate friction).

5. **State when no previous max exists (first time training the exercise)** — options:
   - Hide the strip entirely (returns `null`, no chrome — matches `measurements-progress-strip.tsx:43-44`).
   - Show "**First time logging this** — every working set is a PR" caption.
   - Show a placeholder hint ("Log a set to set your baseline").
   - **Designer call.** Default null-on-empty is the lowest-risk option.

6. **State when running session has already surpassed previous max** — options:
   - Hide once `runningKg >= previousMaxKg`.
   - Show celebratory "**New PR!** +X kg over previous best".
   - Show negative gap ("**Already beat by X kg**") + still show reps-left calc.
   - **Designer call.** Recommendation: celebratory message, hide the reps-left number (it's negative / nonsensical).

7. **Should unchecked sets count toward the "running volume"?** — see Constraints above. Trade-off restated:
   - **Aggressive (yes, count drafts)**: motivating; matches what user sees in the table.
   - **Conservative (no, only checked)**: matches what will persist into `["progress"]` after Finish.
   - **Discovery lean**: **aggressive**. The strip's job is mid-workout motivation; the user can see the unchecked-set indicator and knows it's still tentative. The mismatch with post-Finish history detail is acceptable because the strip doesn't exist there anyway.
   - **Edge case**: user logs a 100kg × 8 working set (= 800 kg running), then discards-unchecked at Finish. The strip showed 800 kg of progress mid-session; the history shows 0. Acceptable — the strip is a live signal, not a record.

8. **Per-`<ExerciseBlock>` hook calls — N parallel `useExerciseProgress`** — see Performance. N is typically ≤ 8 and the cache is warm after the first fetch. If Designer worries about cold-start fan-out (e.g. a routine with 12 exercises on first ever workout view), the fallback is to lift the queries to the screen level via a single new `useExerciseMaxVolumes(exerciseIds)` hook that batches into one PostgREST call (`.in("exercise_id", ids)`). **Discovery recommendation**: defer the batched form unless profiling shows real lag.

9. **Dark-mode tokens for the strip** — confirm Designer picks tokens consistent with `weekly-volume-strip.tsx`. Specifically: PR-achieved celebratory state needs a "positive" tint — no green is in use today (`#3b82f6` blue is the closest "active/positive" color). Either reuse blue or introduce a green token (decision affects palette docs).

10. **e2e probe shape** — Tester decision. The deterministic probe is: (i) seed a finished session with one working set 100 kg × 10 = 1000 kg; (ii) start a new session, add the same exercise, log a 100 kg × 5 working set (500 kg); (iii) assert the strip reads "500 kg to beat · 5.0 reps @ 100 kg" (or whatever phrasing Designer picks). Verifies kernel + reps-math + unit display in one shot.

11. **What about supersets / rest-paused sets?** — not modeled in the schema; only `warmup` / `working` / `dropset`. Dropsets get counted in volume (same kernel). No special case.

12. **What about lbs preference?** — same number internally (kg) → `formatVolume(kg, "lbs")` converts on render. Reps-to-beat math should stay in kg internally: `(previousMaxKg - runningKg) / currentWeightKg`. Don't mix units mid-calculation.

## Out-of-scope flags

- **Editing the target manually** (user-picked target weight option d in Unknown #2).
- **Showing the target on the exercise progress page** (`/(app)/exercises/[id]/progress.tsx`) — different surface, different intent. Not requested.
- **Showing the target on history detail** (`/(app)/history/[id].tsx`) — past sessions don't have a "live target" semantics. Verified: history detail doesn't pass `showCheckable` today; the new strip should follow the same gating.
- **Whole-session volume target** (vs per-exercise) — not requested by the prompt.
- **Per-muscle aggregate target** ("chest volume to beat") — adjacent but distinct feature.
- **Cross-exercise PR comparison** ("bench vs ohp PR badges").
- **PR-table denormalization / Postgres triggers** — explicitly counter to Decision 8 (`docs/decisions.md:167`: "compute from `sets` on demand"). Out.
- **Notifications / haptics on PR achievement** — adjacent polish; defer.
- **Estimated-1RM-based targets** (vs raw volume) — different metric. Out of scope.
- **Range-bound previous max** ("best in last 90 days") — prompt says "previous max", treat as all-time. Out.
- **Editing how "current weight" is sourced from a UI menu** — Designer picks one semantics (Unknown #2); the chosen rule is hardcoded for v1.
- **Cache buster bump** — N/A, no schema change.
- **Batched `useExerciseMaxVolumes(ids[])` query** — defer per Performance / Unknown #8.
