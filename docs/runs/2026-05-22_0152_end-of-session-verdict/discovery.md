# Discovery — 2026-05-22_0152_end-of-session-verdict

## Feature prompt

> End-of-session verdict screen. When the user taps Finish (after the existing unchecked-sets dialog, if any), show a brief summary screen: `+N PRs · Y kg total volume · Zh Wm duration`, with a list of which exercises hit a new PR. Closes the loop on the in-session `Volume to PR` strip — today, hitting Finish just navigates away with no payoff for the work tracked. Strong's equivalent is the post-workout summary. The verdict screen has a single "Done" button that navigates back to the workout tab.

(BRT-absolute today is 2026-05-22 — the current ISO week is `2026-W21`, Monday 2026-05-18 → Sunday 2026-05-24.)

## Scope summary

Insert a one-shot summary screen into the existing live-workout Finish flow. After `useFinishSession` succeeds (and after the existing `ChooseActionModal` resolves the unchecked-sets choice, when present), navigate the user to a new read-only screen that shows the PR count, total volume, duration, and the list of exercises that hit a new lifetime-best volume in the just-finished session. A single "Done" button drops the user back at the workout tab root. No mutations on this screen, no schema change, no new server query — all data derives from `useSession`, `useSetsForSession`, `useLifetimeWeeklyVolume`, and `useAllExercises`.

## Affected files (verified)

### New files (will be created by Implementer)

- `app/(app)/workout/verdict/[sessionId].tsx` — the verdict screen. Nested under `workout/` mirrors `[sessionId].tsx` co-location and inherits the existing `workout/_layout.tsx` (`<Stack screenOptions={{ headerShown: false }} />`).
- Possibly `src/hooks/use-session-verdict.ts` and/or `src/utils/session-verdict-math.ts` — pure helpers + a hook that joins the four data sources and computes `prExerciseIds`, `totalVolumeKg`, and the PR list rows. Designer call on file split.
- `tests/unit/session-verdict-math.test.ts` — unit tests for the new pure helper(s), mirroring the precedent at `tests/unit/progress-page-math.test.ts:201-561` (`computePrExerciseIdsThisWeek` style).
- `tests/e2e/end-of-session-verdict.spec.ts` — golden-path e2e: seed prior session, log a PR-hitting live set, tap Finish, assert verdict copy, tap Done, land on `/(app)/workout`.

### Existing files that will be edited

- `app/(app)/workout/[sessionId].tsx:225-233` (`finishAfterMutation`) — change `router.replace("/(app)/workout")` to `router.replace(\`/(app)/workout/verdict/${sessionId}\`)` so back-button can't return to the now-stale live screen. Three call sites already converge on `finishAfterMutation`: `onFinish` (zero-unchecked path, line 249), `handleCheckAllAndFinish` (line 266), and `handleDiscardUncheckedAndFinish` (line 304) — editing the one helper covers all three.
- `docs/features.md:3` — move the verdict-screen item from the `[ ]` pending list to the `## Done` section after the feature ships (Conductor responsibility, not Implementer).

### Existing files referenced read-only by the new code

- `src/api/stats.ts:18-26` — `WeeklyVolumeRow` shape (`completed_at: string`, `weight: string | null`, `reps: number | null`, `set_type`, `exercise_id`, `session_id`, `sessions: { started_at, ended_at }`). The verdict screen consumes this via `useLifetimeWeeklyVolume`.
- `src/hooks/use-stats.ts:39-48` — `useLifetimeWeeklyVolume()` returns `UseQueryResult<WeeklyVolumeRow[], Error>` with `staleTime: 60_000` and queryKey `["stats", "weekly-volume", "lifetime"]`. Already invalidated by `useFinishSession.onSuccess` (see `use-sessions.ts:62-63`), so by the time the verdict screen mounts, the lifetime read will refetch including the just-finished session's rows.
- `src/utils/progress-page-math.ts:160-184` — `computeLifetimeMaxPerExercise(rows)`. Computes `Map<exercise_id, maxKg>` by grouping rows by `(exercise_id, session_id)` and taking the per-exercise max. The verdict's PR detection must pass it the lifetime rows MINUS the just-finished session's rows (Question #3).
- `src/utils/progress-page-math.ts:204-253` — `computePrExerciseIdsThisWeek({ rows, currentWeekStartIso, currentWeekEndIso })`. Returns `Set<exercise_id>` of strict-PR exercises in a date window using a running-priorMax algorithm sorted by `sessions.started_at`. The verdict has a different shape (single-session PR detection, not a week window) — see Question #3 / Question #10.
- `src/utils/volume-target.ts:58-69` (`sumPastVolume`) and `:78-90` (`sumLiveVolume`). `sumLiveVolume` is the **canonical** "total volume of checked working sets in the live session" — gates on `completed_at != null` and `set_type !== "warmup"`. The verdict's "Total volume" line should mirror this kernel exactly. (`sumPastVolume` excludes warmups but does NOT filter `completed_at`, used only for finished-session data.)
- `src/components/session-summary-row.tsx:34-42` — `formatDuration(startIso, endIso)` returns `"Xh Ym"` for ≥1h sessions, `"Ym"` otherwise. Returns `"in progress"` if `endIso` is null. Module-private today; the verdict screen needs to either re-import after exporting it, or duplicate. Question #5.
- `src/utils/units.ts:33-40` — `formatVolume(kg, unit)` rounds and applies `en-US` thousands separator. The verdict's `"Y kg total volume"` must use this verbatim to match the in-session strip's display.
- `src/components/max-now-to-pr-line.tsx:23-58` — reusable `MaxNowToPrLine({maxKg, nowKg, gapKg, unit, a11yPrefix?})` component. **Not directly reusable** for the verdict PR list because every verdict-PR row has `Now ≥ Max` strictly (a "To PR" of zero or negative is nonsensical to display); see Question #6.
- `src/api/sessions.ts:14-23` — `getSession(id)` for `started_at` + `ended_at`. Already wrapped by `useSession(id)` in `src/hooks/use-sessions.ts:28-34` with queryKey `["sessions", id]`. `useFinishSession.onSuccess` writes the freshly-stamped row directly via `qc.setQueryData(KEYS.detail(row.id), row)` (`use-sessions.ts:61`), so when the verdict mounts the session's `ended_at` is already cached.
- `src/api/sets.ts:22-35` — `listSetsForSession(sessionId)` already wrapped by `useSetsForSession(id)`. Returns `SetRow[]` ordered by `completed_at` (nulls last) then `set_number`. Used for the "Total volume" computation. Verified: by the time the verdict mounts, every checked set in this session is persisted (either always was, or was bulk-checked by `bulkCheckAllInSession`); unchecked rows were either left alone (zero-unchecked path), bulk-checked, or bulk-soft-deleted by `bulkSoftDeleteUncheckedInSession` (`sets.ts:210-246`). So `sumLiveVolume(setsQ.data)` returns the correct total in all three Finish branches.
- `src/api/exercises.ts` — `listAllExercises()` (includes soft-deleted) via `useAllExercises` (`use-exercises.ts`). PR-list rows need the exercise name; the verdict screen should use the include-deleted variant (precedent: `app/(app)/history/[id].tsx:41-46`).
- `src/hooks/use-sessions.ts:54-66` — `useFinishSession.onSuccess` cache cascade. Important sequencing fact: `qc.setQueryData(KEYS.detail(row.id), row)` writes the row synchronously BEFORE `invalidateQueries({ queryKey: ["sessions"] })` fires the refetch chain. The verdict screen mounts after `await finish.mutateAsync(...)` resolves → at that point `useSession(sessionId)` returns the just-stamped row from cache with zero loading state.
- `app/(app)/workout/_layout.tsx:1-5` — single-line Stack layout. The new verdict screen slots in as a third child route under `workout/` automatically (file-system routing).
- `app/(app)/workout/index.tsx:1-138` — the workout tab root. "Done" navigates here (`/(app)/workout`).
- `src/components/session-header.tsx:36-48` — the "Finish" button's accessibilityLabel is `"Finish workout"`. The e2e test will key off this.
- `src/components/choose-action-modal.tsx:1-108` — `ChooseActionModal`. No edit needed; the verdict screen is downstream of the modal's `onPress` callbacks.
- `src/components/active-session-banner.tsx:7-33` — banner shows when `useActiveSession().data` is non-null. After `useFinishSession.onSuccess` does `qc.setQueryData(KEYS.active, null)` (`use-sessions.ts:59`), the banner hides immediately. So while the verdict screen is mounted, the banner is gone — good, no stale "Resume workout" prompt.
- `src/db/types.ts:59-70` — `ExerciseRow` (need `name`, `muscles`, `id`).

## Relevant conventions (verified by reading code)

- **Volume kernel (LIVE session)**: `sumLiveVolume(sets)` in `src/utils/volume-target.ts:78-90` — `if (s.completed_at == null) continue; if (s.set_type === "warmup") continue; w = parseFloat(weight); r = reps ?? 0; if (Number.isFinite(w) && w > 0 && r > 0) total += w * r`. This is THE canonical "checked working volume of the live session" — the verdict's total volume MUST use it exactly to match the in-session strip's `Now` definition.
- **Volume kernel (PAST session)**: `sumPastVolume` (`volume-target.ts:58-69`) drops the `completed_at` guard because past sessions are loaded by `listSetsForExercise`, which scopes to finished sessions. Within a finished session, `completed_at = null` is technically possible (per migration 0007) but treated as "operational noise"; including it would silently corrupt historical PRs. The verdict's PR comparison reads finished-session data via `useLifetimeWeeklyVolume`, which **server-side filters `completed_at IS NOT NULL`** (`stats.ts:56, 79`) — so the asymmetry is harmonised by the API.
- **Cache invalidation on finish**: `useFinishSession.onSuccess` does (in order) `setQueryData(KEYS.active, null)` → `invalidateQueries(["sessions"])` → `setQueryData(KEYS.detail(row.id), row)` → `invalidateQueries(["stats"])` → `invalidateQueries(["progress"])`. The verdict screen depends on the last two for fresh lifetime data; the cache cascade is automatic.
- **Routing for one-shot post-action screens**: precedent for "navigate away and don't allow back" is `router.replace(...)` (used 4× in the workout flow alone: `[sessionId].tsx:229, 284`; `workout/index.tsx:45, 61`). The verdict screen replaces; the Done button on the verdict also replaces back to `/(app)/workout`.
- **Header style for finished-state screens**: `app/(app)/history/[id].tsx:179` uses `<Stack.Screen options={{ title: headerTitle, headerShown: true }} />` where `headerTitle` is the workout's name. The verdict screen should follow the same idiom (title = session.name?.trim() || "Workout summary" or similar) so the iOS back-chevron is suppressed by `headerShown: true` defaults (no back button when this is the first screen in the stack after a `replace`).
- **NativeWind chrome**: root container = `flex-1 bg-white dark:bg-black`. Big numeric pattern (hero-style) = `text-3xl font-semibold text-black dark:text-white` with eyebrow `text-xs uppercase tracking-wide text-gray-500` (verified at `progress-hero.tsx:48-53` for the "PRs this week" headline). Section divider = `border-b border-gray-200 dark:border-gray-800`.
- **Empty-state copy**: `text-center text-base text-gray-500`, single sentence, calm and action-oriented (verified at `history/index.tsx:40-43`, `exercises/[id]/progress.tsx:128-133`, `exercises-this-week-list.tsx:76-78`). The verdict's "no PRs" state should follow the same idiom.
- **Cross-platform button**: precedent `<Button>` at `src/components/ui/button.tsx`, primary variant = `bg-black dark:bg-white` with `text-white dark:text-black`. The "Done" button should use this.
- **Tabular numerics for stat lines**: `tabular-nums` is applied to every visible numeric column on the Progress page and the live strip (`progress-hero.tsx:53`, `volume-target-slot.tsx:85`, `max-now-to-pr-line.tsx:45`). The verdict's `+N PRs · Y kg · Zh Wm` line should use it too so the digits don't jitter while the screen mounts.
- **Pure helper + co-located unit test**: every math kernel lives in `src/utils/*.ts` with a `tests/unit/*.test.ts` companion (`volume-target.ts` + `volume-target.test.ts`; `progress-page-math.ts` + `progress-page-math.test.ts`; `dates.ts` + `dates.test.ts`). PR detection logic that needs unit-testing should land in `src/utils/session-verdict-math.ts` (or be added as a function inside the existing `progress-page-math.ts` — Designer's call).

## Constraints

- **Data**:
  - Tables read: `sessions`, `sets`, `exercises`. All under RLS `auth.uid() = user_id`. No new policies needed.
  - No schema change, no new column, no new index.
  - The verdict screen relies on the lifetime-set read (`useLifetimeWeeklyVolume`) being **fresh at mount time**. `useFinishSession.onSuccess` invalidates `["stats"]`, which marks the lifetime query stale; the next render triggers refetch. There is a brief window (the refetch wall-clock, typically <500 ms on a normal connection) where the verdict screen has the *stale* lifetime data. Designer must address: render a loading skeleton, or wait for the refetch before computing the PR list.

- **UI**:
  - Single ScrollView screen. No FlatList needed (PR list is small — typically 0-5 entries per session).
  - Header shown (`<Stack.Screen options={{ title: ..., headerShown: true }} />`); back-button suppressed naturally by `router.replace`-arriving with no prior stack entry.
  - Identical look-and-feel on iOS/Android/web; pure React Native + NativeWind.

- **Platform**: nothing iOS/Android-specific. Verified against precedent (the Progress page is platform-neutral and ships on web today).

- **Auth**: All reads via `supabase` JS client; RLS scopes by user. Screen mounted inside `(app)/` group, gated by `app/_layout.tsx` auth check.

- **Performance**:
  - The hero pattern: `useSession(id)` + `useSetsForSession(id)` + `useLifetimeWeeklyVolume()` + `useAllExercises()` — three of those four are already warm in cache by the time the verdict mounts (the live screen subscribed to them). `useLifetimeWeeklyVolume` is the only cold-or-stale-after-invalidate query; same constraint applies to the existing Progress page (`progress-hero.tsx`).
  - PR detection algorithm operates on the lifetime row set (~5-15k rows for a 3-year-active user) — sub-100ms client-side reduction (already proven by the Progress page hero's `usePrsThisWeek` running on the same data).
  - No new server round-trips. Total network cost at verdict mount = 0 (everything is React Query cache hits, plus the invalidate-triggered refetches that would have happened anyway).

## Existing precedents

- **In-flow post-action screen pattern**: there isn't a direct precedent for "tap action → land on a one-shot summary screen". Closest analogue: `app/(app)/measurements/[id]/index.tsx` (read-only detail screen for a freshly-created measurement), but that's reached by tapping a list row, not by a mutation success. The verdict screen breaks new ground; the closest in-spirit precedent is the post-Finish navigation in `[sessionId].tsx:229` (which today goes to `/(app)/workout`).
- **Direct precedent for the prompt's `+N PRs · Y kg total volume · Zh Wm duration` line**: `src/components/session-summary-row.tsx:62-71` already shows `{formatDate(started_at)} · {formatDuration(started_at, ended_at)}{totalSets ? " · " + totalSets + " sets" : ""}{totalVolumeKg ? " · " + formatWeight(totalVolumeKg, unit) + " volume" : ""}` — same `·`-separated stat-strip shape. The verdict's headline can mirror this row's typography. Note: it uses `formatWeight` (per-set, decimal kg), not `formatVolume` (aggregate, rounded with comma). The prompt's "Y kg total volume" is aggregate → use `formatVolume`.
- **Progress page "PRs this week" hero**: `src/components/progress-hero.tsx:48-53` — eyebrow `text-xs uppercase tracking-wide text-gray-500` + headline `text-3xl font-semibold text-black dark:text-white`. Direct template for the verdict's PR-count headline.
- **Per-exercise PR badge**: `src/components/exercises-this-week-list.tsx:111-117` — `<View className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-900"><Text className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">PR</Text></View>`. Reusable as-is for each PR-list row.
- **"New PR" celebration copy**: `src/components/volume-target-slot.tsx:117` — `\`New PR! +${overflowDisplay} over your previous\`` (emerald-600/400). This IS the live strip's celebration; reusing the same copy on the verdict creates continuity ("the strip said New PR while you trained — the verdict confirms it"). Same `"Matched your previous best — one more rep is a PR"` (`:116`) handles the tie case but a tie on the verdict means previous max = current session volume, which is a corner case worth handling.
- **PR list of exercises (per-week)**: the Progress page list (`exercises-this-week-list.tsx`) already has a tested layout for "list of exercises with per-exercise PR badge". The verdict's PR list can adopt the same row shape (exercise name + PR badge + optional `Max · Now · To PR`-style sub-line), filtered to PR-only exercises and stripped of the muscle grouping (a session is typically focused on one or two muscles; grouping adds friction without payoff).
- **One-shot confirmation flow → router.replace**: workout `onCancel` (`[sessionId].tsx:278-292`) does `router.replace("/(app)/workout")` BEFORE awaiting the mutation, explicitly to avoid the now-deleted session re-fetching. The verdict screen reverses this — the mutation succeeds first, the replace happens after — but the lesson is the same: use `replace`, not `push`, when the previous route is dead.

## Answers to specific questions

### 1. Insertion point in the Finish flow

- **Current code** (`app/(app)/workout/[sessionId].tsx:225-233`):
  ```ts
  const finishAfterMutation = async () => {
    if (!sessionId) return;
    try {
      await finish.mutateAsync(sessionId);
      router.replace("/(app)/workout");        // line 229
    } catch (err) {
      console.warn("Finish failed", err);
    }
  };
  ```
  All three Finish branches (zero-unchecked at `:249`, check-all at `:266`, discard-unchecked at `:304`) funnel through `finishAfterMutation`. **One edit covers all three.**
- **Replace target**: `router.replace(\`/(app)/workout/verdict/${sessionId}\`)`. Use `replace` (not `push`) so the back-button can't return the user to the now-dead live-workout screen.
- **Done button behavior**: also `router.replace("/(app)/workout")`. Reasoning: the verdict screen is one-shot; if the user opens History from the workout tab, they shouldn't be able to back-button into the verdict. Verified pattern at `[sessionId].tsx:284` (cancel flow) and `workout/index.tsx:45, 61` (start-from-routine flow).

### 2. File-system layout

- **Recommendation (fact-grounded)**: `app/(app)/workout/verdict/[sessionId].tsx`.
- **Why**: expo-router file-system convention. Nesting under `workout/` (a) inherits the existing `workout/_layout.tsx` Stack (`<Stack screenOptions={{ headerShown: false }} />`) for free, (b) keeps the route close to the screen that navigates here (`workout/[sessionId].tsx`), (c) matches the precedent for nested dynamic routes verified across `app/(app)/exercises/[id]/progress.tsx`, `app/(app)/history/week/[isoWeek].tsx`, `app/(app)/measurements/[id]/{index,edit}.tsx`.
- **Modal alternative (rejected)**: react-native `<Modal>` could host the verdict instead of a route. Rejected because (a) every existing post-action surface in this app is a route, not a modal (no precedent for modal-as-screen); (b) deep-link / back-button semantics are cleaner with a route; (c) the prompt says "screen" not "modal"; (d) e2e tests use `getByText` against the Page DOM — a route is simpler to assert against.

### 3. PR detection semantic (the load-bearing question)

**The trap**: `useLifetimeWeeklyVolume`'s query is invalidated by `useFinishSession.onSuccess` (`use-sessions.ts:62`). When the verdict mounts, the refetch returns rows that **include the just-finished session** (because `sessions.ended_at` is now non-null and the server filter `.not("sessions.ended_at", "is", null)` lets them through). If we naively compute `computeLifetimeMaxPerExercise(lifetimeRows)` and ask "did this session beat that max?", the answer is **always no** — because this session's volume IS the max it's being compared to. Result: zero PRs every time.

**Three options**:
- **(a) Subtract current session volume from each exercise's max before comparing.** Doable but error-prone — for an exercise where the user PR'd today, the max post-mutation IS today's volume; subtracting today's volume from today's max gives the *runner-up* session's volume, but only when the runner-up was the SECOND-best; we'd need to track 2nd-best, not just max.
- **(b) Cache a snapshot of `lifetimeRows` BEFORE the finish mutation fires.** Requires plumbing through the live screen → verdict, a stale cache reference that doesn't get invalidated. Brittle.
- **(c) Filter `lifetimeRows` by `row.session_id !== currentSessionId` before computing the priorMax map.** Cleanest. `WeeklyVolumeRow` already includes `session_id` (`stats.ts:25`). Reduce the row set first, then compute the priorMax map per exercise using the existing `computeLifetimeMaxPerExercise` kernel.

**Recommendation**: **option (c)**. Then PR detection per exercise = `currentSessionVolume[exId] > priorMax[exId] && priorMax[exId] > 0`. The `priorMax > 0` guard mirrors the first-session-doesn't-PR semantic from `volume-target.ts:124-126` and `computePrExerciseIdsThisWeek`'s `priorMax > 0 && s.volume > priorMax` predicate (`progress-page-math.ts:242`).

**Current-session volume per exercise** is derived from the just-finished session's `sets` (via `useSetsForSession`), bucketed by `exercise_id`, summed with the same `w*r` kernel (filtering to `set_type !== "warmup"`, `completed_at != null` — but at this point every saved set has `completed_at != null` by construction).

### 4. Total volume calculation

Verified: `sumLiveVolume(sets)` in `src/utils/volume-target.ts:78-90` is the canonical kernel. Per the multi-metric-strip run's F10 semantic ("checked = committed"), it gates on `completed_at != null` AND `set_type !== "warmup"` AND `parseFloat(weight) > 0` AND `reps > 0`. By the time the verdict mounts:

- **Zero-unchecked path** (`[sessionId].tsx:241-251`): all sets were checked already.
- **Check-all path** (`:257-267`): `bulkCheckAllInSession` stamped every previously-unchecked set with `completed_at`.
- **Discard-unchecked path** (`:295-305`): `bulkSoftDeleteUncheckedInSession` set `deleted_at` on all unchecked rows; `useSetsForSession`'s `.is("deleted_at", null)` filter (`sets.ts:27`) then excludes them.

So `sumLiveVolume(setsQ.data ?? [])` returns the correct "Y kg total volume" in all three Finish branches.

### 5. Duration

`formatDuration(startIso, endIso)` at `src/components/session-summary-row.tsx:34-42` already returns the prompt's `"Xh Ym"` format (or `"Ym"` when <1h). Currently **module-private** — needs to be exported (or duplicated) for the verdict screen. Recommend exporting it (one keyword, zero risk) rather than duplicating. Designer call on whether to move it to `src/utils/format-time.ts` or just `export` it in-place.

`session.ended_at` is non-null by the time the verdict mounts because `useFinishSession.onSuccess` writes the freshly-stamped row directly via `qc.setQueryData(KEYS.detail(row.id), row)` (`use-sessions.ts:61`). No null-handling needed.

### 6. PR list rendering

Per the prompt: "a list of which exercises hit a new PR". For each PR-exercise show at minimum the exercise name. The optional sub-line is a design decision.

`MaxNowToPrLine({maxKg, nowKg, gapKg, unit})` is **structurally wrong** for PR-list rows because:
- `Max` in that component is the lifetime max; on the verdict, "Max" post-mutation IS the current session's volume (using the unfiltered lifetime read).
- `gapKg` is `max(maxKg - nowKg, 0)` — for any PR exercise, `nowKg > previousMax`, so gap is zero (the "To PR" reading is then meaningless: 0 kg to PR, you already did it).

**Recommended PR-row content**:
- Exercise name (large) + PR badge (`bg-emerald-100 ... text-emerald-700` — copy from `exercises-this-week-list.tsx:111-117`).
- Sub-line: `"+X kg over your previous"` (emerald, mirrors `volume-target-slot.tsx:117`), OR `"Now Y kg · Prev Z kg"` (calm, matches the "Prev. Max / Now" line at `volume-target-slot.tsx:131-140` which already ships for the surpassed branch). The `Prev` shows what the user beat, not the lifetime max post-mutation.
- Tie case (`currentVolume === previousMax`, i.e. matched-but-didn't-beat): NOT a PR per `computePrExerciseIdsThisWeek`'s strict-`>` rule (`progress-page-math.ts:242`). So no display needed.

Designer to lock down the exact sub-line copy; both options have in-repo precedent.

### 7. Empty state ("ordinary session, no PRs")

Most sessions won't PR. The verdict still renders the header line — `+0 PRs · Y kg total volume · Zh Wm duration` — followed by:

- **Option A**: no PR list, single line of empty-state copy ("No PRs this session. Good consistency is its own win.") in the `text-base text-gray-500` empty-state idiom.
- **Option B**: hide the PR list entirely, no copy. Just the headline + Done button. Less wordy.

Designer call. Both are in-repo precedent (option A mirrors `history/index.tsx:40-43`; option B mirrors how `<VolumeTargetSlot>` returns `null` when `no-pr`).

### 8. Cache invalidation timing

Sequence (verified in `use-sessions.ts:54-66`):
1. `await finishSession(id)` resolves with the stamped `SessionRow`.
2. `useFinishSession.onSuccess` runs synchronously:
   - `setQueryData(KEYS.active, null)` — banner disappears immediately.
   - `invalidateQueries(["sessions"])` — sessions list/detail queries marked stale; refetches scheduled.
   - `setQueryData(KEYS.detail(row.id), row)` — current session detail populated synchronously with the stamped row (bypasses refetch).
   - `invalidateQueries(["stats"])` — covers `["stats", "weekly-volume", "lifetime"]` (used by `useLifetimeWeeklyVolume`).
   - `invalidateQueries(["progress"])` — covers `["progress", exerciseId]` per-exercise.
3. `router.replace(\`/(app)/workout/verdict/${id}\`)` mounts the verdict screen.
4. Verdict screen consumes `useSession(id)` (cache HIT, no loading flash because of step 2c) + `useSetsForSession(id)` (cache HIT — already subscribed by the live screen's prior mount, still warm) + `useLifetimeWeeklyVolume()` (cache STALE — refetch in flight; data may briefly be the pre-mutation snapshot).

**For option (c) in Q3**: the refetch is a race the screen must handle. If we render before the refetch returns, the lifetime data is missing this session's contribution, AND the PR algorithm is still correct (it computes priorMax from rows where `session_id !== currentSessionId`, which gives the right answer regardless of whether the current session's rows are present or not in the lifetime read). **Therefore the refetch race is benign for PR detection** — but the screen should still show a loading skeleton while `useLifetimeWeeklyVolume().isLoading` is true on the first cold mount, to avoid a flash of "0 PRs" before the real number renders. Designer should specify the loading affordance.

### 9. App reload mid-verdict

The verdict is one-shot, NOT persistent. If the user closes/reloads the app while on `/(app)/workout/verdict/<sessionId>`:
- Cold mount of the app reads the URL → loads the verdict screen → all four hooks fetch from server.
- `useSession(id)` returns the finished session (works).
- `useSetsForSession(id)` returns the saved sets (works).
- `useLifetimeWeeklyVolume()` returns the post-finish lifetime data (which now INCLUDES this session) → the option-(c) `session_id !== currentSessionId` filter still works → PR detection still correct.
- BUT: `useActiveSession().data` is null (this session is finished), so the active-session banner stays hidden — good.

So the verdict screen is self-contained and idempotent. The user can deep-link to it later (e.g. share the URL) and it renders correctly. Designer may want to consider this as a "permanent" surface in History too — but that's scope creep; the prompt only requires the one-shot Finish flow.

**Negative case**: a finished, then deleted session — `useSession` would 406 (because `getSession` uses `.is("deleted_at", null).single()`). Edge case, soft-handled today by `[sessionId].tsx:316-326` rendering the error inline. Verdict screen should mirror this (graceful error fallback).

### 10. Test infrastructure

- **Existing unit tests for PR detection** (`tests/unit/progress-page-math.test.ts:201-561`): 14 tests for `computePrExerciseIdsThisWeek` covering empty input, single PR, dedupe, multi-exercise, first-ever no-PR rule, MAJ-3 strict-`>` boundary, week-window filtering. The verdict's PR algorithm is the same shape with TWO changes:
  - Filter to a single session (the current one), not a week window.
  - Filter out current session from priorMax denominator (option-c above).

  Recommendation: **extract a new pure helper** `computeSessionPrExerciseIds({ currentSessionId, currentSessionVolumesByExercise, lifetimeRows }): Set<string>` in `src/utils/session-verdict-math.ts` (or appended to `progress-page-math.ts`), with its own unit test suite. The current-session per-exercise volume map is a parameter, computed from `useSetsForSession` data via `sumLiveVolume`-like reduction. Keeping it pure (parameters in, Set out) makes it trivially testable without React or Supabase mocks.

- **Existing e2e for live-finish flow**: `tests/e2e/volume-target.spec.ts` (700+ lines) already seeds a session, logs sets via admin API, asserts the live strip's PR celebration. The verdict's e2e can copy the same seeding pattern, plus a click on the Finish button and an assertion on the verdict's headline + Done button. New test file recommended (`tests/e2e/end-of-session-verdict.spec.ts`) since the existing one is already crowded.

- **Existing e2e for the post-Finish flow**: `tests/e2e/crud.spec.ts` (line ~89+) covers "start ad-hoc, log a working set, finish" — currently asserts the user lands back on the workout tab. After this feature ships, that assertion must change to assert the verdict screen first, then a "Done" tap, then the workout tab. Implementer must update this test or risk a regression failure.

## Unknowns (require Designer judgment or human decision)

1. **PR-row sub-line copy** (Q6): `"+X kg over your previous"` (emerald, motivational) vs `"Now Y kg · Prev Z kg"` (calm, factual) vs both. **Assumption**: emerald `"+X kg over your previous"` matches the live strip's `volume-target-slot.tsx:117` celebration phrase; continuity with the in-session experience.
2. **Empty PR list state** (Q7): show empty-state copy ("No PRs this session"), or hide the list entirely. **Assumption**: show one calm line so the screen doesn't look broken/empty.
3. **Loading affordance** for the lifetime refetch (Q8): full-screen `<ActivityIndicator>` vs per-block skeleton vs render-with-stale-data-then-revalidate. **Assumption**: per-block skeleton on the PR list only, headline renders eagerly with the data already in cache (session + sets). Mirrors `progress-hero.tsx:30-39`.
4. **Where the duration helper lives** (Q5): keep `formatDuration` in `session-summary-row.tsx` and `export` it, or move to `src/utils/format-time.ts`. **Assumption**: export in-place — minimal churn, one-line change.
5. **Where the session-PR helper lives** (Q10): new file `src/utils/session-verdict-math.ts` vs appending to `src/utils/progress-page-math.ts`. **Assumption**: new file — single-responsibility, easier to find when the verdict is later iterated. No-op for tests.
6. **Header title for the verdict screen**: `"Workout summary"`, `"Verdict"`, or the session.name. **Assumption**: `"Workout summary"` — descriptive and unambiguous (the literal word "verdict" might read judgmental). No precedent for this surface.
7. **Done button placement**: sticky bottom (always visible while scrolling) vs at the end of the ScrollView. **Assumption**: sticky bottom — single-action screen, the button is the entire user goal. Pattern would be a `<View>` outside the ScrollView with `View className="border-t border-gray-200 px-4 py-4 dark:border-gray-800"`. Designer may prefer in-flow given the typical content is short (1-screen tall).
8. **What happens if the user navigates back from the workout tab to the verdict via browser history (web)**: should the deep-link work? **Assumption**: yes — the verdict is a real route, idempotent against the persisted session. No special handling needed.
9. **The prompt's `+N PRs` phrasing**: `+N` with a leading plus sign (e.g. `+2 PRs`) vs `N PRs` (no sign) vs `N new PRs`. **Assumption**: literal `+N PRs` per the prompt (`+2 PRs · …`); the plus sign emphasises "you gained these". For `N=0`, render `0 PRs` without the plus sign.
10. **e2e update to `tests/e2e/crud.spec.ts`**: the existing "start-log-finish" path expects a specific post-finish state. Implementer must locate the exact assertion (around line 89+) and update it. **Fact** (not assumption): the test exists and will fail without the update — the run will block at the Tester stage if missed.

## Out-of-scope flags

- **Schema change**: prompt is silent but the feature does not need one. No new column, no new index, no migration.
- **Persisting "PR snapshots"**: a `prs` table for historical PR queries was deferred per `docs/roadmap.md:124` (verified via the Progress page discovery). The verdict computes PRs at read time from `sets` — keep it that way.
- **Notifications / haptics on PR achievement** (mentioned as out-of-scope in the Progress page run's discovery, same here).
- **Per-exercise PR animations / confetti**: out of scope. The prompt asks for a plain summary.
- **Sharing the verdict** (screenshot/URL share): out of scope. The route is just a URL today; user can copy if they want, but no share button.
- **Showing the verdict in History as a permanent surface**: the prompt only requires the post-Finish one-shot. The session detail screen at `history/[id].tsx` is the existing permanent surface; do NOT duplicate the verdict there.
- **Showing pre-Finish PR projections**: the live strip (`<VolumeTargetSlot>`) already covers this. No new pre-Finish UI.
- **Re-deriving PR for a session edited after the fact**: if the user edits a finished session in History and the new volume retroactively beats a prior session, no verdict re-fires. Out of scope; the verdict is Finish-flow-only.
- **Comparing against same-routine history** (e.g. "this Push Day vs your last Push Day"): out of scope per the prompt's strict lifetime-max anchor.
- **PR count semantics expansion**: the prompt's "PR" is volume-only. The codebase has no concept of e1RM or single-rep-max PRs — out of scope for this run.
- **Cancel-flow verdict**: cancelled sessions (soft-deleted via `useSoftDeleteSession`) should NOT navigate to a verdict. Verified: `onCancel` (`[sessionId].tsx:269-293`) calls `router.replace("/(app)/workout")` directly, not through `finishAfterMutation`. No change needed.
