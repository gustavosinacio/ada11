# Discovery — 2026-05-20_0302_exercise-progress-graph

## Feature prompt
Item #5 from `docs/features.md`:

> "when clicking on an exercise, i want to see a progress graph showing important info"

## Scope summary
A working `Progress` screen for a single exercise **already exists** at `app/(app)/exercises/[id]/progress.tsx` (e1RM + total-volume line charts over session history, with unit toggle and empty state). It is reachable today only via a secondary "View progress" CTA buried mid-form inside the exercise *edit* screen (`app/(app)/exercises/[id]/index.tsx:185-194`). The user prompt — *"when clicking on an exercise, I want to see a progress graph"* — is therefore primarily a **navigation / IA fix**: tapping an exercise should land on the progress view (or surface it prominently), not drop straight into the edit form. Possible secondary polish on the chart content itself is in scope, but the existing chart is non-trivial and not a stub.

## Affected files (verified)
- `app/(app)/exercises/index.tsx:58-69` — exercise list `FlatList`. Row `onPress` currently routes to `/(app)/exercises/${item.id}` (the edit screen). This is the literal "click on an exercise" entry point named in the prompt.
- `app/(app)/exercises/[id]/index.tsx:1-219` — exercise detail = edit form (RHF + zod). Contains the **only** existing CTA to the progress screen at lines 185-194 (`<Link href={'/exercises/${id}/progress'}>`). Uses `Stack.Screen` with title "Edit exercise" and no `headerRight`.
- `app/(app)/exercises/[id]/progress.tsx:1-124` — **already-implemented progress screen.** Renders two `<ProgressChart>` blocks: estimated 1RM and total volume, both per session, x-axis = `M/D` short date (line 12-19). Header: `Stack.Screen options={{ title: exercise.name }}`. Empty state at line 96-102. Loading state at 70-77.
- `app/(app)/exercises/_layout.tsx:1-5` — exercises stack with `headerShown: false` at the layout level; per-screen headers opt back in via `Stack.Screen options`.
- `src/components/exercise-list-item.tsx:1-35` — list row primitive. Single `onPress` prop, `ChevronRight` affordance. No secondary action / long-press / icon button today.
- `src/components/progress-chart.tsx:1-137` — SVG line chart primitive (react-native-svg 15.12.1). Handles: 0 points → "No data yet", 1 point → big-number readout with date, ≥2 points → polyline + dots + y-axis ticks + x-axis labels.
- `src/api/progress.ts:1-36` — `listSetsForExercise(exerciseId)` → `SessionSets[]`. Joins `sets!inner(sessions)`, filters `ended_at IS NOT NULL` and `deleted_at IS NULL`, orders by `completed_at ASC`, then groups in JS into one bucket per session sorted by `started_at` ASC.
- `src/hooks/use-progress.ts:1-12` — `useExerciseProgress(id)` thin TanStack Query wrapper. Cache key `["progress", id]`. No filter / range params today.
- `src/utils/formulas.ts:1-5` — `epley1RM(weight, reps)` = `weight * (1 + reps/30)`; returns 0 if reps≤0 or weight≤0.
- `src/utils/units.ts:14-47` — `formatWeight` (one decimal) and `formatVolume` (round + ≥1000 abbrev to "1.2k"). The current progress screen uses inline `.toFixed(1)` / `>=1000 ? /k : toFixed(0)` rather than these helpers — minor inconsistency, see "Unknowns".
- `src/db/types.ts:32, 110-126` — `SetType = "warmup" | "working" | "dropset"`. Progress kernel at `progress.tsx:41` skips `set_type === "warmup"`; dropsets *are* counted (matches `weekly-volume-strip` and the volume-kernel convention).

## Relevant conventions (verified by reading code)

**Data flow for per-exercise progress.** Component → `useExerciseProgress(exerciseId)` → `listSetsForExercise` → Supabase query with `sessions!inner(...)` join and `.not("sessions.ended_at", "is", null)` to keep only finished sessions. Soft-deleted sets are excluded via `.is("deleted_at", null)`. RLS is uniform `auth.uid() = user_id` per `docs/architecture.md:65`; no extra auth code in the screen.

**Volume kernel (shared convention).** Sum of `parseFloat(weight) * reps` for `set_type !== "warmup"`, guarded `weight > 0 && reps > 0`. Identical kernel in `progress.tsx:41-48` and `weekly-volume-strip.tsx:42-47`. Dropsets count. Server already filters warmups in the weekly stat; the per-exercise progress filters client-side because it returns raw set rows.

**Chart embedding precedents.**
- `src/components/measurements-progress-strip.tsx:55-71` — embeds **one** `<ProgressChart>` as a list header. Computes a single series via a pure helper (`entriesToWeightSeries` in `src/utils/measurements-chart.ts:30-50`) inside `useMemo`. Returns `null` (no chrome) on error / <2 points. Loading skeleton renders before data. This is the freshest in-list pattern.
- `app/(app)/exercises/[id]/progress.tsx:104-120` — embeds **two** stacked `<ProgressChart>` inside a `ScrollView`. Series built inline in `useMemo` (not extracted to a helper). Empty state replaces the whole chart block, not per-series.
- `src/components/weekly-volume-strip.tsx:62-132` — bar-chart strip, also as a list header. Same three branches: loading skeleton → null on error/empty → real chrome. Sets the "what an embedded mini-chart looks like" precedent if Designer wants a *teaser* on the list/detail rather than a full screen.

**Routing convention.** `expo-router` file-based. Edit screen path is `/exercises/${id}` (i.e. `[id]/index.tsx`), progress is `/exercises/${id}/progress`. Header chrome is set per-screen via `<Stack.Screen options={...}>`; the `_layout.tsx` itself hides headers. `headerRight` icon buttons exist for "new exercise" in `exercises/index.tsx:19-29` (Plus icon, `lucide-react-native`) — that's the canonical pattern for a header CTA in this app.

**Chart dimensions.** `chartWidth = Math.min(screenWidth - 48, 500)`. Repeated identically in `progress.tsx:27` and `measurements-progress-strip.tsx:25` — treat as a convention.

**Cache invalidation.** Sets/sessions writes do **not** invalidate `["progress", exerciseId]` anywhere I can find — verified by grepping `qc.invalidateQueries`. After a workout, the progress screen will be stale until refetched. (Flagging in Constraints.)

## Constraints

- **Data**:
  - `sets` and `sessions` both have RLS = `auth.uid() = user_id`; no extra filter needed.
  - `listSetsForExercise` already filters finished + non-deleted, and groups per session. Sort key is **`started_at` ASC** (api/progress.ts:33-35), not `completed_at` — they should match for a normal workout but in pathological cases (long-running session split across days) the x-axis label and the sort key disagree.
  - `weight` is `string | null` (PostgREST numeric); always `parseFloat`. Existing kernel does this.
  - No `started_at` index on `sets` is needed because the query is by `exercise_id` + RLS user scope; this is a low-cardinality query in practice.
- **UI**:
  - NativeWind classes; `bg-white dark:bg-black`, `text-gray-500`, etc. Match existing palette.
  - `<Stack.Screen options={{ title: ..., headerShown: true }}>` to opt back into a header inside the `headerShown: false` layout.
  - Header chrome convention: use `lucide-react-native` icons; tap target ≥40×40 by padding the `<Pressable>`.
  - `Link href={...} asChild`-wrapped `<Pressable>` is the established navigation pattern (see exercises/[id]/index.tsx:185).
- **Platform**:
  - `react-native-svg` 15.12.1 is in deps (package.json:57) — works on iOS, Android, and web. Existing progress chart already renders on all three.
  - No platform-specific divergence in any of the files touched.
- **Auth**: Standard `auth.uid()`-scoped queries; no special handling. `useExercise` and `useExerciseProgress` both hit the user-scoped session.
- **Performance**:
  - Worst case `listSetsForExercise` returns all sets ever logged for one exercise. For a heavy user (3 working sets × 2 sessions/week × 2 years ≈ 600 rows) this is fine in one request.
  - Chart polyline is O(N). `useMemo` keys on `[progressQ.data, unit]` — correct.
  - No virtualization on the chart; not needed at this scale.
  - Stale-cache risk: completing a workout does NOT invalidate `["progress", *]`. Acceptable for v1 (TanStack Query will refetch on focus / mount per its defaults) but worth flagging if Designer wants real-time refresh after a workout.

## Existing precedents

- **The progress screen itself already exists.** This is the strongest precedent — and it's the thing the Designer should reuse, not rebuild. Two stacked charts (e1RM + volume), empty state, unit-aware. Lines 21-124 of `app/(app)/exercises/[id]/progress.tsx`.
- **Header CTA pattern** — `exercises/index.tsx:18-30` shows the `Plus`-in-`headerRight` for "new exercise". Same shape works for a `LineChart`-in-`headerRight` to jump to progress, or for any icon button on the detail screen.
- **Embedded mini-chart as list-header card** — `MeasurementsProgressStrip` in `src/components/measurements-progress-strip.tsx`. If Designer prefers an inline "teaser" on the list/detail rather than full navigation, this is the prior art.
- **Pure series helper** — `src/utils/measurements-chart.ts:30-50` (`entriesToWeightSeries`). The progress screen builds its series inline; if Designer touches it, extracting into a pure helper would match the freshest precedent and be unit-testable.
- **Weekly-volume bucketing for "this week" stat** — `src/components/weekly-volume-strip.tsx:34-60`. Demonstrates the loading-skeleton → null-on-empty → chrome+chart three-branch pattern, plus `computeStripModel` co-located pure helper.

## Unknowns (require Designer judgment or human decision)

1. **Reading A vs B confirmation.** The existing progress screen is functional; this is overwhelmingly a Reading A (wire / surface, not rebuild) feature. Designer should confirm and pick one of these IA fixes:
   - **A1**: Make exercise-list-row tap go directly to `/exercises/${id}/progress`; move "Edit" behind a header icon. Strongest reading of the literal prompt.
   - **A2**: Keep list-row → edit; add a `headerRight` chart-icon button on the edit screen that pushes to `/progress`. Smallest change, but barely solves the user's complaint.
   - **A3**: Replace the current `[id]/index.tsx` (edit form) layout so it becomes a *detail screen* — chart at top (embedded `MeasurementsProgressStrip`-style strip), metadata + Edit button below. Best UX outcome; bigger blast radius.
   - **A4** (hybrid): list-row → progress screen; progress screen gets `headerRight` pencil icon → edit screen. Mirrors how iOS Contacts / Photos handle "view vs edit". Likely the right answer.
2. **Which metrics count as "important info"?** The screen today shows: estimated 1RM (Epley) per session + total volume per session. Two reasonable additions: heaviest working set per session, total reps per session, working sets count, PR markers. Designer should decide the metric set or explicitly hold the current two.
3. **X-axis range.** Today the chart shows **all** finished sessions for this exercise (no slicing). For a 2-year user this means dozens of points crammed across ~300px. Compare to `MeasurementsProgressStrip` which caps at `maxPoints=12`. Designer call: cap to last N, add a range toggle, or accept all-time.
4. **Empty-state threshold.** Today: "0 working sets" → text "No working sets recorded yet" (progress.tsx:96-102). `<ProgressChart>` itself handles 0/1/≥2 differently. With exactly 1 session logged, the current screen *will* render but the chart shows only a single big-number readout (chart primitive lines 67-77). Is that the desired behavior or should we show an empty state until ≥2 sessions?
5. **Cache invalidation after a workout.** Should completing a workout invalidate `["progress", exerciseId]` for every exercise touched in that session? Currently it does not (verified by grep). Out-of-scope for the prompt, but the Designer should at least decide whether to fold it in.
6. **Tap-target on the exercise-list row vs detail screen.** If A4: do we also surface a chart icon on the list row (right side, replacing the chevron) for a one-tap drill-in? Probably no — adds clutter — but flag it.
7. **Native parity / Web parity.** The chart already works on all three platforms (react-native-svg is universal). No known native bug, but neither I nor Tester has confirmed visually on a device. The previous measurements run shipped its chart; precedent suggests this is fine.
8. **iOS edit screen still reachable.** If A1 or A4 changes the list-row destination, the edit/delete entry point must remain discoverable. Currently the *only* path to delete an exercise is `/exercises/${id}` → "Delete exercise" button (lines 209-214). Don't strand it.
9. **"showing important info"** — the prompt is vague. Designer should pick a metric set and write the rationale; otherwise this becomes a back-and-forth with the human.

## Out-of-scope flags

- **Cross-exercise comparison** (e.g. bench vs OHP on one chart). Not requested.
- **Per-routine progress dashboards** (e.g. "Push day volume over time"). Separate feature.
- **1RM goal-setting / target lines on the chart.** Not requested.
- **Per-muscle aggregate progress** (e.g. "chest volume over time"). Distinct, larger feature.
- **PR / personal-record badges or notifications.** Possibly tempting, but not in this prompt.
- **Date-range picker UI.** Unless Designer wants it for unknown #3 above, defer.
- **Replacing `epley1RM` with a different formula (Brzycki, etc.).** Not requested.
- **Refactoring `useExerciseProgress` to paginate.** Unnecessary at current scale.
- **Cache invalidation on workout-complete.** Adjacent fix; flagged in Unknown #5 but not in scope unless Designer explicitly pulls it in.
