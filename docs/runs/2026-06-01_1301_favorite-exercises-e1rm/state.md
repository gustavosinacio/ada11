# Run: 2026-06-01_1301_favorite-exercises-e1rm

## Feature prompt

Phase 2b — Favorite exercises (pin into the e1RM strength chart).

GOAL: Mark exercises as "favorite" and have favorited exercises pinned into the "Estimated 1RM per exercise" chart (Phase 2a, run 2026-05-30_2006_e1rm-strength-chart). Owner intent: "Show my most performed exercises, but I also want to be able to add exercises by favoriting them in the exercise details page." Favorites ADD to the auto-selected most-performed set (union); toggle lives on the exercise detail page.

SCOPE:
- NEW per-user join table `user_exercise_favorites(user_id, exercise_id)` (NOT a column on shared canonical exercises). RLS per-user (auth.uid()=user_id on SELECT/INSERT/DELETE), UNIQUE/PK (user_id, exercise_id), FK exercise_id→exercises (appropriate ON DELETE). Migration REQUIRED (next free = 0020 — verified 0019 is latest).
- Favorite toggle (star) on `app/(app)/exercises/[id]/index.tsx`, optimistic.
- API + hook (favorite/unfavorite/list) mirroring the exercise_notes precedent (0010_exercise_notes.sql, src/api/exercise-notes.ts, src/hooks/use-exercise-note.ts, src/components/exercise-note-slot.tsx). Favorites likely need only plain INSERT/DELETE toggle (the 42P10 partial-unique-upsert trap may not apply — confirm).
- Wire favorites INTO the e1RM chart (src/utils/e1rm-strength.ts presentTopExerciseE1rm + src/components/e1rm-strength-section.tsx): favorited exercises with plottable e1RM data (Invariant D: logged weight>0) appear IN ADDITION to the auto top-N. DESIGNER DECIDES: union/cap/line-count/colors when favorites exceed the readable ceiling; ordering; a favorited bodyweight-only/no-e1RM exercise can't plot (exclude from chart, favorite still persists).

OUT OF SCOPE: separate favorites screen; favoriting from other surfaces; favorites affecting volume/muscle chart; reordering favorites; the Phase 2a deferred items (leverage factors, secondary-muscle, dose-metric).

CONTEXT: Expo + Supabase, sole user, BRT (today 2026-06-01). e1RM chart (Phase 2a) is the integration target: <MultiSeriesChart>, top-5 by distinct sessions, palette-by-rank, LOCF, Invariant D. RLS test arm required (User A insert → User B cannot SELECT/INSERT/DELETE), mirror exercise-notes run. MIGRATION APPLIED BY CONDUCTOR (owner authorized Conductor to apply migrations + commit + deploy this batch) — Implementer writes the FILE; Conductor applies before the Tester's live e2e (same as the just-shipped 0019 flow).

Carry-in lessons (paid off last 3 runs): Discovery exhaustive close-the-set on the e1RM selection sites; e2e use live-catalog-verified exercise names (Bench Press / Squat (Barbell) / Chin-up good; "Pull-up" NOT in live catalog) + seed a WEIGHTED exercise; pre-audit adjacent specs' fragile getByText(name).first() locators when surfacing an exercise name.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 5a0b86e6993f39f0721ab6efee2d36bad0c15537
- baseline_commit: 5a0b86e6993f39f0721ab6efee2d36bad0c15537

## Current state
- Owner: conductor
- Step: Finalize (Tester PASS — summary + Evaluator + archive + commit)
- Round (current loop): n/a (all loops closed)
- Status: in-progress
- Started (BRT): 2026-06-01 13:01
- Updated (BRT): 2026-06-01 14:56
- Tester r1 FAIL = test-only (e2e returns via page.goto hard reload → races persistence + rehydrates stale favorites cache). Feature PROVEN working (gates+regression 12/12+RLS+golden-path 3/3). Migration 0020 already live. Fix: client-side Progress-tab nav + waitForResponse on the toggle POST/DELETE. No production change.
- Discovery corrections: detail page = progress.tsx (not index.tsx); favorites = plain INSERT/DELETE (no 42P10). e1RM injection = the .slice(0,topN) gate; palette wrap >8 is the key risk.

## Budgets remaining
- Design ↔ Validate rounds: 1 / 3 (loop CLOSED at GO after round 2)
- Implement ↔ Review rounds: 1 / 2 (loop CLOSED at PASS after round 1)
- Implement ↔ Test rounds: 0 / 2 (loop CLOSED at PASS after round 2)
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md (NO-GO: MAJ-1)
- [x] design-v2.md
- [x] validation-v2.md (GO)
- [x] implementation.md
- [x] review-v1.md (PASS)
- [x] test-report-v1.md (round 1: FAIL — test-only nav defect)
- [x] test-report-v2.md (round 2: PASS)
- [ ] final-summary.md
- [ ] validation-v1.md
- [ ] implementation.md
- [ ] review-v1.md
- [ ] test-report-v1.md
- [ ] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log
- 2026-06-01 13:01 — Run initialized. Baseline main @ 5a0b86e. Next migration 0020. Builds on the Phase 2a e1RM chart. Conductor applies the migration + commits + deploys (owner-authorized this batch).
