# Discovery — 2026-05-24_2233_sessions-list-on-progress-chart

## Feature prompt
Sessions list on exercise progress chart screen. The per-exercise progress screen at `app/(app)/exercises/[id]/progress.tsx` currently shows charts (Best e1RM headline + Estimated 1RM chart + Total volume chart) but does NOT list the actual sessions the exercise was performed in. Add a list below the charts showing the sessions: each row should show the session's date, the working sets logged for THIS exercise (e.g. "4 × 12,400 kg" or per-set "100×8, 100×8, …"), and tap-through to the corresponding history detail. The list should be reverse-chronological (newest first) and use the same `useExerciseProgress(exerciseId)` data the chart already mounts — no new query. Reuse the design idiom of `<SessionSummaryRow>` if it fits, or create an exercise-scoped variant if not.

## Scope summary
Adds a reverse-chronological list of finished sessions to the per-exercise progress screen, below the existing e1RM/volume charts. Each row summarises the working sets logged for THIS exercise in that session and routes to `/(app)/history/{sessionId}`. Reuses the existing `useExerciseProgress(exerciseId)` cache — no new query, no new endpoint, no schema change.

## Affected files (verified)
- `app/(app)/exercises/[id]/progress.tsx:35-160` — host screen. Top-level `<ScrollView>` with `contentContainerClassName="px-6 py-6 pb-12"`. Above the list: title (line 124), summary subline ("N sessions logged · Best est. 1RM: X kg", line 127-130), then either an empty-state block (line 132-138) or the two `<ProgressChart>` charts inside a `<View className="gap-8">` (line 140-156). The new list sits at the bottom of the same `<ScrollView>`, after the charts.
- `src/hooks/use-progress.ts:5-11` — `useExerciseProgress(exerciseId)`. Returns `UseQueryResult<SessionSets[]>`. Already mounted by `progress.tsx:43`; the new list reads from the same query — no extra fetch.
- `src/api/progress.ts:4-39` — `listSetsForExercise` and the `SessionSets` shape: `{ session_id: string; started_at: string; sets: SetRow[] }`. **Two facts that constrain the design**:
  1. The return is sorted **ascending** by `started_at` (`:36-38`). The new list needs DESC — reverse or sort at the consumer.
  2. The row does **NOT** include `name`, `ended_at`, `notes`, `routine_id`, or `user_id`. Only `session_id`, `started_at`, and the sets. The Supabase select inlines only `sessions!inner(id, started_at, ended_at)` (`:13`), and `ended_at` is consumed only as a filter — it's discarded before the row leaves the API. This kills direct `<SessionSummaryRow>` reuse (which expects a full `SessionRow`); see "Constraints" below.
- `src/components/session-summary-row.tsx:1-62` — current `<SessionSummaryRow>`. Props: `{ session: SessionRow; totalSets?: number; totalVolumeKg?: number; unit: WeightUnit; onPress?: () => void }`. Renders `session.name || "Workout"` on line 1, then `formatDisplayDate(started_at, {includeWeekday}) · formatDuration(started_at, ended_at) · totalSets · presentSessionVolumeSlot(...)` on line 2, optional "In progress" badge, ChevronRight. Uses border-bottom row idiom: `border-b border-gray-100 px-4 py-4 active:bg-gray-50 dark:border-gray-900 dark:active:bg-gray-950`.
- `src/db/types.ts:121-151` — `SessionRow` (full session) vs `SetRow` (canonical per-set shape). `SetRow.weight` is `string | null` (numeric stringified). `SetRow.reps` is `number | null`. `SetRow.set_type: "warmup" | "working" | "dropset"`.
- `src/utils/format-display-date.ts:86-114` — `formatDisplayDate(date, { includeWeekday? })`. Year-aware (omits year when current year). Same helper used by `<SessionSummaryRow>`.
- `src/utils/session-row-format.ts:21-28` — `presentSessionVolumeSlot(totalVolumeKg, unit)`. Returns `" · 12,400 kg"` or `null`. Could be reused if the new row keeps the same "kg suffix" idiom.
- `src/utils/units.ts:33-40` — `formatVolume(kg, unit)` — `"12,400 kg"` thousands comma, en-US locale. Same kernel the charts and history rows use.
- `src/utils/volume-target.ts:68-79` — `sumPastVolume(sets)`. Canonical per-session-per-exercise volume kernel for finished sessions: skips `warmup`, requires `w > 0 && r > 0`, no `completed_at` filter (past sessions are implicitly committed — see the comment on lines 53-66 explaining the past-vs-live asymmetry). This is **exactly** the reduction the prompt's "4 × 12,400 kg" needs.
- `src/utils/set-display.ts:41-50, 57-60` — `displayWeight(kgStr, unit)` and `displayReps(reps)` pure helpers used by `<ReadOnlySetRow>`. Reusable for the per-set "100×8" variant if that option is chosen.
- `app/(app)/history/index.tsx:52-66` — precedent for `<SessionSummaryRow>` consumed inside a `FlatList`, with `onPress={() => router.push('/(app)/history/${item.id}')}`. **Same target the new list rows must navigate to.**
- `app/(app)/history/week/[isoWeek].tsx:205-211` — second `<SessionSummaryRow>` consumer, also passes `totalVolumeKg` and routes to history detail. Confirms the navigation idiom.
- `src/hooks/use-sessions.ts:106-109` — `useFinishSession()` invalidates `["progress"]`. The new list inherits this — finishing a workout that includes the exercise will refresh the list automatically (no extra invalidation needed).
- `tests/e2e/exercise-progress-ia.spec.ts:101-103, 175-177, 195-197` — three assertions that read `/No working sets recorded yet/i` (the existing empty-state copy). The new list must either keep this exact string visible for fresh users OR the test must be updated to match an extended empty state.

## Relevant conventions (verified by reading code)
- **Volume kernel canonicity.** The same predicate (`set_type !== "warmup"`, `w > 0 && r > 0`) appears in `progress.tsx:79-86`, `volume-target.ts:68-79` (`sumPastVolume`), and `weekly-volume-strip.tsx:43-51`. The new per-session-per-exercise volume MUST use this same predicate — diverging here would produce a row whose "Total kg" disagrees with the chart's volume point for the same session.
- **Set count.** "Working sets" in this codebase means `set_type !== "warmup"` (not `=== "working"` — dropsets count). The exercise-block subline and verdict screen apply this consistently. The "4 ×" prefix in "4 × 12,400 kg" should use `sets.filter(s => s.set_type !== "warmup").length`.
- **Reverse-chronological sort.** `useSessions()` (history list) sorts DESC at the API layer. `useExerciseProgress` sorts ASC (`progress.ts:36-38`) because charts plot left→right oldest→newest. The new list reads the same data and must reverse it.
- **Navigation idiom.** `router.push('/(app)/history/${sessionId}')` — verified in both `history/index.tsx:61` and `history/week/[isoWeek].tsx:210`. Use `push` (not `replace`) so back returns to progress.
- **Card / row visual idiom.** `<SessionSummaryRow>` and `<ReadOnlySetRow>` both use `border-b border-gray-100 ... dark:border-gray-900` plus `active:bg-gray-50 dark:active:bg-gray-950` for tap feedback. Whatever the new row looks like, it should follow this.
- **Year-aware date display.** Always `formatDisplayDate` (long form) or `formatShortDate` (terse) — `format-display-date.ts:1-149`. Never inline `toLocaleDateString` calls (those were migrated app-wide in commit 895716f).
- **Inside the existing `<ScrollView>`, not a separate `<FlatList>`.** The screen at `progress.tsx:117-159` is a single scrolling surface. Adding a `<FlatList>` inside a `<ScrollView>` is anti-pattern in RN (warns, breaks virtualization). Use `.map()` over the reversed list — the upper bound is "all of this user's finished sessions for this exercise", typically O(10²) for a serious lifter over years. No virtualization concern at this scale.
- **a11y label idiom.** `<SessionSummaryRow>` has no a11y label per se (relies on visible Text). `<ReadOnlyExerciseBlock>` exposes `accessibilityLabel={\`View progress for ${name}\`}` on its name Pressable. The new row should follow `SessionSummaryRow` (no explicit aria-label needed since visible text is descriptive).

## Constraints
- **Data shape mismatch with `<SessionSummaryRow>`**: the existing component requires `SessionRow` (full session row: `name`, `ended_at`, `notes`, `routine_id`, …). `SessionSets.started_at` and `session_id` are the **only** session-level fields `useExerciseProgress` returns (see `src/api/progress.ts:13`). To pass through `<SessionSummaryRow>` unchanged we'd have to either (a) enrich `listSetsForExercise` to select session fields too (NEW query work — the prompt forbids this), or (b) synthesize a fake `SessionRow` with `name: null`/`ended_at: started_at`/etc. (lossy, brittle). **Recommended path**: build an exercise-scoped variant component or a thinner row that takes `SessionSets` + derived totals directly. The prompt explicitly allows this ("create an exercise-scoped variant if not").
- **Session `name` not available** in the current data flow. `<SessionSummaryRow>` shows the session name as the row's title; this row cannot. Options: (1) show the date as the title and the set summary as the subline; (2) extend `listSetsForExercise` to also select `sessions.name, sessions.ended_at`. Option (1) preserves the "no new query" constraint; option (2) requires a minor API change. The Designer should pick.
- **Duration not available** for the same reason (`ended_at` is filter-only). If the row needs to show "1h 5m", the API must be extended.
- **`useExerciseProgress` returns ASC**; the list needs DESC. Reverse in `useMemo` next to the existing chart memo (already `progressQ.data ?? []` on `progress.tsx:68`).
- **UI / NativeWind**: same Tailwind classes as `<SessionSummaryRow>` for visual consistency.
- **Platform**: iOS + Android + web. `<ScrollView>` parent is platform-agnostic; no per-platform divergence.
- **Auth / RLS**: `listSetsForExercise` already inherits Supabase RLS via the authenticated session. No new policy work.
- **Performance**: O(N_sessions × N_sets_per_session) per render for the volume reductions. Memoize alongside the existing `useMemo` block on `progress.tsx:67-106` or do a second `useMemo`. The same hot path already iterates sets twice (once for e1RM, once for volume) — a third pass for the list summary is negligible at typical N.
- **Empty state**: the screen already renders `/No working sets recorded yet/i` (line 134-137) when `e1rmData.length === 0`. The new list inherits this case implicitly — if there are no `e1rmData` points, there are also no sessions to list. The Designer should decide whether the empty-state block subsumes the list section header, or whether the list section appears with its own "no sessions yet" sublabel. Simplest: gate the entire list section behind the same `e1rmData.length > 0` check.

## Existing precedents
- **`<SessionSummaryRow>` consumers** — `app/(app)/history/index.tsx:52-66` (history list) and `app/(app)/history/week/[isoWeek].tsx:205-211` (history-by-week drill-down) both follow the same pattern: `FlatList` (or `.map`) → `<SessionSummaryRow>` per session → `router.push('/(app)/history/${item.id}')` on tap. Date label uses `formatDisplayDate(started_at, { includeWeekday: true })`. Volume slot uses `presentSessionVolumeSlot(totalVolumeKg, unit)`.
- **Per-exercise volume kernel** — `src/utils/volume-target.ts:68-79` (`sumPastVolume`) is THE function for "what was the volume of this exercise in this past session?". Use it; do not re-implement.
- **Read-only set display** — `<ReadOnlyExerciseBlock>` on `app/(app)/history/[id].tsx:301-365` renders sets per-exercise. The "100×8, 100×8, …" option in the prompt is essentially a horizontal compaction of `<ReadOnlySetRow>`'s output. `presentReadOnlySetRow` (`set-display.ts:101-125`) emits the per-set strings.
- **PR list / verdict screen** — `app/(app)/workout/verdict/[sessionId].tsx:38+` builds per-exercise rows with the same volume math and an `onPress → router.push('/(app)/exercises/${id}/progress')` navigation. Same idiom in reverse direction.
- **History-week list within a `FlatList`** — `app/(app)/history/week/[isoWeek].tsx:205-211` shows that "list of summary rows with tap-through to detail" already has a mature, tested precedent.

## Per-session set summary kernel (analysis of the two options)
The prompt suggests two formats:

**Option A — aggregate "4 × 12,400 kg"** (set count × total volume):
- Pros: matches the visual idiom of `<SessionSummaryRow>` (date · duration · volume); single short line; easy to fit at typical mobile widths; consistent with the chart's volume datapoint (same kernel).
- Cons: less informative than per-set; user can't see whether the volume was 4 heavy doubles or 4 sets of 12.
- Implementation: `${setsForExerciseInSession.filter(s => s.set_type !== "warmup").length} × ${formatVolume(sumPastVolume(sets), unit)}`.

**Option B — per-set "100×8, 100×8, 110×6, 100×4"**:
- Pros: full information; mirrors how lifters notate workouts; lets the user spot the heaviest top set or the rep ladder.
- Cons: gets long fast (8-set high-rep day on the row → 60+ chars); needs `numberOfLines={1}` or wrap policy; mixed units (warmups visible? probably not). Need to filter warmups for consistency with the volume kernel.
- Implementation: `sets.filter(s => s.set_type !== "warmup" && s.weight && s.reps).map(s => \`${displayWeight(s.weight, unit)}×${s.reps}\`).join(", ")`. Optionally bracket warmups out, optionally truncate with "…".

**Hybrid (recommended for the Designer to consider)**: title-line shows "4 × 12,400 kg" (Option A) for scannability, secondary line shows per-set "100×8 · 100×8 · 110×6 · 100×4" (Option B) in a smaller `text-xs text-gray-500`. Matches the two-line idiom already used by `<SessionSummaryRow>`. Decision-scope: Designer.

## Unknowns (require Designer judgment or human decision)
- **Title vs subline split for the row.** Without `session.name`, what reads as the row's "title"? Candidates: (a) the date as title, set-summary as subline; (b) "Workout" / "Session" as a constant title with date+sets in the subline; (c) extend the API to include `sessions.name`. The prompt does not specify.
- **Aggregate vs per-set kernel** (see "Per-session set summary kernel" above). Both are reasonable; the prompt presents them as alternatives.
- **Section heading.** Does the list need its own header ("Sessions", "History (N)", "All sessions") above the first row? `<WeeklyVolumeStrip>` is a `ListHeaderComponent` to a list; this is the opposite — a list below charts. Convention is unclear.
- **Section spacing.** The existing `gap-8` only applies between the two charts. Adding a list below needs a deliberate vertical spacing decision (likely `mt-8` and a horizontal rule, or a `border-t border-gray-200 dark:border-gray-800` divider mirroring `app/(app)/history/[id].tsx:244`).
- **Should warmups appear in the per-set rendering?** The volume kernel excludes them, and the rest of the app treats warmups as not-real-sets. Recommended: exclude. But the Designer should confirm — a user looking at "what did I do this day for this exercise" might want to see warmups too (especially for heavy compounds where the warmup ladder is meaningful).
- **Row chevron and tap-through affordance.** `<SessionSummaryRow>` has a `ChevronRight`. The new variant should too, for consistency.
- **Empty state behaviour for the list specifically.** If `e1rmData.length === 0`, the screen already shows the "No working sets recorded yet" copy and renders neither charts nor (by transitive logic) the list. If `e1rmData.length > 0` but somehow no sessions to list (impossible given the same source — included for completeness), no UI behaviour required. Confirmed: the list visibility can be gated by the same `e1rmData.length > 0` check.
- **Soft-deleted exercises**: `useAllExercise(id)` resolves a soft-deleted exercise so the header still renders. `listSetsForExercise(exerciseId)` does not filter by `exercises.deleted_at` — it queries `sets` directly. So the list will continue to show historical sessions for a soft-deleted exercise. Confirm this is the desired behaviour (Designer / human).

## Out-of-scope flags
- **No new query / API change** — the prompt explicitly says "use the same `useExerciseProgress(exerciseId)` data". Extending `listSetsForExercise` to select `sessions.name, sessions.ended_at` is technically a change to the same query (not a new one), but should still be flagged as an API contract change if the Designer picks that path.
- **No new screen / route**. The list lives on the existing `/(app)/exercises/[id]/progress` route. Tap-through goes to the already-existing `/(app)/history/{sessionId}`.
- **No schema change.** No new column, no migration.
- **`max_volume_window_weeks` does NOT apply.** Verified at `app/(app)/exercises/[id]/progress.tsx:22-34` (in-source comment explicitly defers this preference for the per-exercise screen). The new list inherits "all sessions, no window filter".
- **No virtualization** unless the Designer specifically requests it; typical N is comfortably small for a `.map()`.
- **No mutation / no delete affordance** on the row — this is a read-only navigation surface. Delete lives inside the session detail.
- **No editing the row in place.** Same reason.
- **Routine context** is not requested. If a session was performed off a routine, that's not shown in the row (and it isn't available in `SessionSets` anyway).

