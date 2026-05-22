# Features

[ ] **(priority 2) Weekly chart horizontal scrolling + week selector.** Today the weekly-volume strips (History mini + Progress full) show a fixed 8-week window. Spec:

- Both strips become horizontally scrollable to navigate through the user's full ISO-week history.
- Add a week selector (likely a "jump to date" affordance — tappable header showing the current window, opens a date picker). Designer call on exact UI.
- Lifetime-best overlay on the Progress chart stays anchored to the lifetime max (doesn't change as you scroll). The "you're behind your lifetime best" visual signal must stay correct under scrolling.
- ISO-week boundary semantics unchanged (Monday-Sunday, BRT).

[ ] **(priority 3) "PRs this week" needs to show WHICH PRs + better in-app context for the numbers in general.** Two related needs:

- The Progress page hero shows `+N PRs · Y · Z` but doesn't surface which exercises hit a PR. Either (a) make the PR count tappable → expands a list of "this week's PR rows" (exercise + new max + previous max), or (b) add a dedicated "PR'd this week" section above the per-muscle list, or (c) tag PR rows in the per-muscle list with a distinct visual treatment. Designer picks. The verdict screen already shows a similar list for the just-finished session — Progress should show the cumulative this-week version.
- Broader UX: review the screens for places where numbers are surfaced without context (e.g., "Volume to PR: 4,900 kg" — what does that mean to a user who hasn't seen the per-exercise live strip? "Max · Now · To PR" — what's "Now"?). Add inline copy / labels / a brief help affordance where helpful. Designer call on scope; minimum bar = the Progress hero PR section.

[ ] rest timer can be activated automatically after a set is checked as done. If another set is checked, timer needs to reset. If done set is unchecked, timer keeps going, no action.

[ ] All dates can be shown as only the month and day, but if the date belongs to a previous year, the year needs to be included in the date. This is noticeable especially on the history and pogress screens

## Done

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
