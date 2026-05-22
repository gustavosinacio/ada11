# Features

## Done

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
