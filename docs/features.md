# Features

[ ] **(priority 3) "PRs this week" needs to show WHICH PRs + better in-app context for the numbers in general.** Two related needs:

- The Progress page hero shows `+N PRs · Y · Z` but doesn't surface which exercises hit a PR. Either (a) make the PR count tappable → expands a list of "this week's PR rows" (exercise + new max + previous max), or (b) add a dedicated "PR'd this week" section above the per-muscle list, or (c) tag PR rows in the per-muscle list with a distinct visual treatment. Designer picks. The verdict screen already shows a similar list for the just-finished session — Progress should show the cumulative this-week version.
- Broader UX: review the screens for places where numbers are surfaced without context (e.g., "Volume to PR: 4,900 kg" — what does that mean to a user who hasn't seen the per-exercise live strip? "Max · Now · To PR" — what's "Now"?). Add inline copy / labels / a brief help affordance where helpful. Designer call on scope; minimum bar = the Progress hero PR section.

[ ] rest timer can be activated automatically after a set is checked as done. If another set is checked, timer needs to reset. If done set is unchecked, timer keeps going, no action.

[ ] All dates can be shown as only the month and day, but if the date belongs to a previous year, the year needs to be included in the date. This is noticeable especially on the history and pogress screens.

[ ] BUG: /routines/27a33734-8fd5-4dc9-9863-552bcdf21494?id=27a33734-8fd5-4dc9-9863-552bcdf21494:1 Blocked aria-hidden on an element because its descendant retained focus. The focus must not be hidden from assistive technology users. Avoid using aria-hidden on a focused element or its ancestor. Consider using the inert attribute instead, which will also prevent focus. For more details, see the aria-hidden section of the WAI-ARIA specification at https://w3c.github.io/aria/#aria-hidden.
Element with focus: <button.css-g5y9jx r-1loqt21 r-1otgn73 my-3 mr-4 flex-row items-center gap-1 self-center rounded-md border border-gray-200 px-2 py-1 active:bg-gray-100 dark:border-gray-800 dark:active:bg-gray-900>
Ancestor with aria-hidden: <div.css-g5y9jx r-13awgt0> <div class=​"css-g5y9jx r-13awgt0" style=​"background-color:​ rgb(1, 1, 1)​;​" aria-hidden=​"true">​…​</div>​flex
entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775 POST https://ykrbgpctbfvndxjnpzrg.supabase.co/rest/v1/routine_exercises?select=_ 409 (Conflict)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
await in (anonymous)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
then @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775 POST https://ykrbgpctbfvndxjnpzrg.supabase.co/rest/v1/routine_exercises?select=_ 409 (Conflict)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
await in (anonymous)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
then @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
installHook.js:1 Failed to add exercise {code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "routine_exercises_routine_position_uq"'}code: "23505"details: nullhint: nullmessage: "duplicate key value violates unique constraint \"routine_exercises_routine_position_uq\""[[Prototype]]: Object
overrideMethod @ installHook.js:1
onPick @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:1187
await in onPick
onPress @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:849
onClick @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:267
ef @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
Bn @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
of @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
Fd @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
Td @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775 POST https://ykrbgpctbfvndxjnpzrg.supabase.co/rest/v1/routine_exercises?select=_ 409 (Conflict)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
await in (anonymous)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
then @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775 POST https://ykrbgpctbfvndxjnpzrg.supabase.co/rest/v1/routine_exercises?select=_ 409 (Conflict)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:775
await in (anonymous)
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
then @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:776
installHook.js:1 Failed to add exercise {code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "routine_exercises_routine_position_uq"'}
overrideMethod @ installHook.js:1
onPick @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:1187
await in onPick
onPress @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:849
onClick @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:267
ef @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
(anonymous) @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
Bn @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
of @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
Fd @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103
Td @ entry-3ccbd2e0e1b5c2fdbad02bc793aad7f9.js:103

## Done

[x] Weekly volume strip now scrolls horizontally through full ISO-week history. New `<VisibleRangePill>` (tappable header showing current visible range, year-aware) opens a bottom-sheet `<WeekSelector>` to jump to a year/month. Default position pinned to right edge (most recent week). Lifetime-best dotted overlay stays anchored inside the scroller. Data consolidation: `useWeeklyVolume` (8-week hook) deleted; all consumers use `useLifetimeWeeklyVolume`. New helpers `isoWeeksBetween` + `isoWeekContaining` in `src/utils/dates.ts`. Scroll re-render avoidance: pill owns its own state via `forwardRef` + `useImperativeHandle` so the 260-bar strip parent never `setState`s on scroll. Week-rollover auto-scrolls the right edge while page mounted. Shipped via `docs/runs/2026-05-22_1130_chart-scroll-week-selector/` after 2 D↔V + 2 I↔T rounds (caught: signature drop would break test #43, missing `isoWeeksBetween` helper, modal mockup contradicting bottom-sheet cite, scroll-rerender perf, week-drill-down regex collision + seed gap under dynamic-bucket model).

[x] Set row declutter — RPE + notes moved behind a per-row bottom-sheet menu (`MoreHorizontal` trigger right of the check button, tints blue when data exists). RPE is now a chip selector (12 chips: `—, 5.0, 5.5, …, 10.0`), not a free-form input. Notes is a 4-line textarea inside the same menu. Default row visual: weight + reps + previous placeholder + check + menu trigger. Caught a real data-loss BLK-1 in v2 review: the unchanged `updateSet` was clobbering all 4 columns on every reps/weight blur once `<SetInput>.onCommit` got narrowed to `{reps, weight}`. Fixed at the root by applying the same partial-spread pattern (`if (patch.X !== undefined) payload.X = patch.X`) to `updateSet`. Shipped via `docs/runs/2026-05-22_1000_set-row-declutter/` after 3 D↔V + 2 I↔T rounds.

[x] End-of-session verdict screen. After Finish (and the existing unchecked-sets dialog, if any), `router.replace` lands on `/(app)/workout/verdict/{sessionId}` with `+N PRs · Y kg · Zh Wm` headline + PR list (each row `{exercise} PR! +X kg (was Y kg)`, tap → exercise progress chart). Done button returns to `/workout`. Cancel flow bypasses. PR detection filters lifetime rows by `session_id !== currentSessionId` before computing per-exercise max (first-ever session NOT a PR; strict `>` tie not a PR). Empty-state copy splits on `totalVolumeKg === 0` vs normal no-PR. Caught a real cache race in MAJ-2: `useBulkCheckAllInSession.onSuccess` was fire-and-forget invalidation; "Check all and finish" branch raced the verdict mount → stale `completed_at = null` rows filtered out → verdict would have rendered `0 kg`. Fixed by awaiting `refetchQueries`. E2E Case A's `600 kg` headline assertion is the load-bearing regression guard. Shipped via `docs/runs/2026-05-22_0152_end-of-session-verdict/`.

[x] New Progress tab + page. `TrendingUp` icon between History and Profile. Hero: `PRs this week: N` + weekly volume `Max · Now · To PR` (lifetime-best anchor). Bars: extended `<WeeklyVolumeStrip>` with dotted lifetime-best overlay (max-aware denominator so the line stays inside the plot when best exceeds the 8-week window). List: exercises trained this week, grouped by `muscles[0]` (empty → "Other"), each row shows per-exercise `Max · Now · To PR`. Streak card: current consecutive weeks + best-ever. All Progress queries under `["stats", "progress-page", …]` so the existing `["stats"]` invalidation cascade catches them. Pure helpers in `src/utils/progress-page-math.ts` (59 unit tests). Shipped via `docs/runs/2026-05-22_0030_progress-page/` after 3 D↔V rounds that caught a hard crash (null `completed_at` in unchecked-set rows would have `parseISO(null) → Invalid Date → format() RangeError` in render) before Implement.

[x] Checked-set rows now have a light green background (`bg-green-50 dark:bg-green-950/30`) matching Strong's reference. Check icon also tinted green.

[x] Time-field on history detail now auto-inserts the `:` between hours and minutes as the user types. New `maskTimeInput` helper in `src/utils/session-times-form.ts` with 7 unit tests covering type-forward, paste, stray-colon, and delete-bypass paths.

[x] Live workout now has a red "Cancel workout" button below the exercise list. Confirm dialog → soft-deletes the session (cascades nothing; session disappears from history). Uses the existing `useSoftDeleteSession` hook.

[x] Volume-target strip's surpassed/matched state now shows a "Prev. Max X · Now Y" line below the celebration text so the reference numbers stay visible after the PR is beaten.

[x] History session-list dates now include the year when the session is not in the current calendar year (e.g. "Fri, Nov 8, 2019" vs "Sat, May 24").

[x] "+ Working set" button (and Warm-up / Dropset variants) are now disabled while the insert mutation is in flight, preventing the quick-double-tap race that produced duplicate `set_number` rows. The DB unique index from migration 0008 backs this up — if the UI debounce ever slips, the server rejects the duplicate cleanly.

[x] Strong-import `set_number = 1` bug fixed in DB. Full-history scan found 356 collision groups / 1,118 corrupted rows (24× the originally-estimated 46). Backfilled 7,933 rows by re-numbering each (session, exercise) group in CSV chronological order (matched 11 user-renamed exercises automatically via session+weight+reps fingerprint). Added migration `0008_sets_unique_set_number.sql` — partial unique index on `(session_id, exercise_id, set_number) WHERE deleted_at IS NULL` — to catch any future regression at the DB layer. Found and fixed one bonus native double-tap dup on the Leggiday Leg-Extension. Importer (`scripts/import-strong.ts`) deleted since the user won't re-import. Shipped via `docs/runs/2026-05-21_2330_strong-import-setnumber/`.

[x] Per-exercise live-workout strip now shows Max · Now · To PR · ≈ reps @ Wkg. "Now" counts only checked working sets (per F10 semantic). Reps clause auto-hides when no sets are checked yet to prevent a misleading "Now 0 · ≈ 10 reps @ 100" render. Shipped via `docs/runs/2026-05-21_2225_multi-metric-strip/`.

[x] Weekly volume count appeared wrong because the "k" shorthand obscured the real number (e.g. "26.2k kg" felt off). `formatVolume` now renders integer kg with thousands separator (`"26,210 kg"`). Investigated via the bug-fix pipeline (`docs/runs/2026-05-21_2155_volume-math-wrong/`); diagnostic confirmed displayed values matched DB exactly — the bug was display, not math. The original "Previous PR" concern folded into the multi-metric strip feature (still open above).

[x] From the live workout session, tapping an exercise's name should navigate to that exercise's history/progress page.
[x] While training, each exercise should show the amount of total volume left to achieve the previous max volume of that exercise. It should also calculate, using the current used weights, the amount of reps left to surpass that volume. Those reps can be shown with floating points like "7.2 reps".
[x] Add a check button for each set during workout. Helps the user track which set they're currently on. Unchecked sets are NOT saved when the workout is finished — only checked sets persist. If any sets are unchecked when Finish is pressed, show a warning dialog with two options: (a) finish without saving unchecked sets, or (b) auto-check all sets before saving.
[x] Soft-deleted exercises should remain fully visible in past workout history (sessions, sets, totals, weekly volume aggregates) — only the exercise picker and the Exercises library list should exclude them.
[x] Edit a workout's start and end time from the history detail screen — e.g. fix a session that was finished hours late, or one started before the user remembered to tap "Quick start".
[x] Allow user to remove exercise from current session in progress.
[x] Measurements screen does not need to live on the bottom bar. It can be moved to the profile page as a button in the page itself
[x] Tela de iniciar treino pode ser unificada com a tela de rotinas, como no strong
[x] when clicking on the measurements, we should see a screen to view what was measured, and then go to the edit measurements when i press an "Edit" button
[x] measurements screen should show a graph to represent progress
[x] history graph for the week needs a click functionality, where i'll see a more detailed view of my progress history
[x] when clicking on an exercise, i want to see a progress graph showing important info
