# Run: 2026-05-26_0101_routine-strong-builder

## Feature prompt
Strong-like routine builder with per-set targets.

## Goal
Today, routine_exercises stores ONE row per exercise with single target_sets/target_reps/target_weight values, so the routine builder shows a flat 3-input form per exercise and the live workout doesn't seed any sets from the routine. We're switching to a Strong-like model where each set is explicit (Set 1: 60kg × 8, Set 2: 70kg × 8, ...) and starting a workout from the routine pre-populates those sets as unchecked drafts.

## Decisions already made by user

1. **Shape A (chosen)**: new normalized table `routine_exercise_sets`. NOT a JSON column on routine_exercises. Matches the repo's normalized convention (sets, exercise_notes, measurements, routine_exercises — zero JSON columns).
2. **No per-set RPE in v1.** Per-set fields are: set_number, set_type ('working'|'warmup'|'dropset'), target_reps, target_weight, parent_set_id (for dropsets, mirrors sets table).
3. **Pre-seed at session-create.** When a workout is started from a routine, immediately bulk-INSERT seed `sets` rows (one per routine_exercise_sets row, completed_at=null, copying set_type/reps/weight). Sets enter the live screen as drafts; user checks them off as they lift. NOT deferred to first interaction.
4. **Drop deprecated columns in the same migration.** target_sets, target_reps, target_weight are removed from routine_exercises. target_rest_seconds stays — it's per-exercise (rest between sets) and is actively consumed at app/(app)/workout/[sessionId].tsx:118-127.

## Scope hints (Discovery should verify, Designer should detail)

### DB
- New migration (likely 0013_routine_exercise_sets.sql): create table + 4 RLS policies (SELECT/INSERT/UPDATE/DELETE gated via auth.uid() match against routine_exercises.user_id) + partial UNIQUE (routine_exercise_id, set_number) WHERE deleted_at IS NULL (matches 0008/0010/0012 convention) + touch_updated_at trigger. ON DELETE CASCADE from routine_exercises (whole-routine reorg shouldn't leave orphan sets).
- Data forward-migration inside the same SQL: for every existing routine_exercises row with target_sets > 0, INSERT N routine_exercise_sets rows (set_number 1..N, all 'working', copying target_reps/target_weight). Existing routines keep working with zero user action.
- After backfill, ALTER TABLE routine_exercises DROP COLUMN target_sets, target_reps, target_weight. KEEP target_rest_seconds.

### API
- New src/api/routine-exercise-sets.ts mirroring src/api/sets.ts / routine-exercises.ts shape: listForRoutine (joined fetch grouped by routine_exercise_id), addSet (computes next set_number from max+1 WHERE deleted_at IS NULL, identical to sets.ts), updateSet (partial patch w/ tri-state semantics like updateSet in sets.ts), removeSet (soft-delete), reorderSets (two-step swap to avoid unique-index trip, mirrors reorderRoutineExercises in routine-exercises.ts:99-123).
- RoutineExerciseTargets type in src/api/routine-exercises.ts shrinks to { target_rest_seconds?, notes? }.

### Hooks
- New src/hooks/use-routine-exercise-sets.ts (TanStack Query, key ["routine_exercise_sets", routineId] — list keyed at routine level so the builder's list query is single-fetch, not N).

### UI
- Replace src/components/routine-exercise-row.tsx with src/components/routine-exercise-card.tsx (or keep filename + rewrite — Designer to call). Expandable card: exercise name header + per-set list + footer with "+ Working set / + Warm-up / + Drop set" buttons (mirrors live workout terminology in <ExerciseBlock>) + "Rest: 90s" input (per-exercise).
- Per-set row: "Set N | Weight | Reps | (set-type pill)". Tap-to-edit text inputs. Soft-delete via trash icon on each row.
- Set ordering inside a card: stable by set_number ascending (same convention we just established in src/api/sets.ts:48-53 after the F-day-5 fix).

### Live workout seeding
- useCreateSessionFromRoutine (or expand useCreateSession): on session create with routine_id, after the session row is created, bulk-INSERT seed `sets` rows from the routine's full per-set config. Set fields: session_id (new), exercise_id (from routine_exercise), set_type/reps/weight (from routine_exercise_set), set_number (sequenced PER (session, exercise) following existing sets.ts pattern), completed_at=null, parent_set_id mapped if dropset (FK adjustment from routine's parent_set_id which references routine_exercise_sets, to the newly-created sets.id of the parent — Designer must spec the mapping).
- Idempotency guard: if a session already has any non-deleted sets for an exercise, skip seeding for that exercise. Cleanest place is at session-create; never re-seed on screen mount.

### Tests
- Unit: routine_exercise_sets add/update/delete/reorder; seed-from-routine helper; edge cases (zero-set exercise survives, dropset parent FK remap, idempotency guard).
- E2E: create routine → add exercise → add 3 working sets with weights/reps → save → start workout from routine → 3 unchecked draft rows pre-populated with right weight/reps → check them off → verify volume. Bonus: edit-then-restart (routine change does NOT affect already-started sessions).

## Open risks / non-obvious things to surface in Discovery + Designer

- **Backfill correctness**: existing routines with NULL target_sets, or target_sets > 0 but null reps/weight — should still produce seed rows? Designer to decide (default: yes, with null reps/weight, user fills in).
- **Dropset parent_set_id remap on seed**: routine_exercise_sets.parent_set_id references another row in routine_exercise_sets. When seeding into the sets table, the parent's sets.id is created in the same bulk insert. Either two-pass (insert parents first, capture their ids, then insert children) or rely on a deterministic ordering trick. Designer to spec.
- **Session-create idempotency**: if user taps Start twice on a routine before the first mutation lands, two sessions could be created with two seed-batches in the second. Add UI in-flight guard at the Start button (mirrors the F22 routine-add-exercise pickingId pattern + new 0012 partial-unique safety net we just shipped).
- **Routine soft-delete semantics**: when a routine is soft-deleted, the existing 0011 cascade behavior... actually routines is not yet cascade'd to routine_exercise_sets. Designer should specify: CASCADE on routine_exercise_id FK is correct; routine deletion already cascades to routine_exercises, which would then cascade to routine_exercise_sets. Verify chain.
- **Migration push**: the run will produce a new migration. Conductor handles db:push at finish per playbook.

## Out of scope (explicit)

- Per-set RPE input in v1 (user decision).
- Per-set notes input in v1 (use exercise-level notes, which already exists via exercise_notes table).
- Set-type reordering (warmup/dropset position shuffles) — v1 supports basic add/remove/reorder of working sets; dropsets stay attached to their parent.
- Visual drag-handle reordering — v1 uses up/down chevrons to match existing routine_exercises pattern.

## Pipeline budget hint
1-2 D↔V rounds (Designer needs to spec bulk-seed semantics + parent_set_id remap tightly); 1 I↔R + 1 I↔T rounds if design is tight. This is medium-sized but well-scoped.

## Baseline
- baseline_branch: main
- baseline_commit: 77029d4cd609631877a5870b91dc16e4e1b7bf4c
- Note: working tree has uncommitted prior-session changes (migration 0012 + set ordering fix + features.md edits). Final-run diff will include these as noise — Evaluator should be aware.

## Current state
- Owner: conductor
- Step: 7. Finalize → Evaluator
- Round (current loop): n/a
- Status: in-progress
- Started (BRT): 2026-05-26 01:01
- Updated (BRT): 2026-05-26 02:55

## Budgets remaining
- Design ↔ Validate rounds: 1 / 3 (round 1 used; round 2 used; D↔V loop CLOSED with `go` on v2)
- Implement ↔ Review rounds: 1 / 2 (round 1 used; pass on first try)
- Implement ↔ Test rounds: 0 / 2 (round 1 + round 2 used + Conductor out-of-band `.first()` patch on test-only locator; all 7 specs pass)
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] design-v2.md
- [x] validation-v2.md
- [x] implementation.md
- [x] review-v1.md
- [x] test-report-v1.md (fail; test-only fix needed)
- [x] test-report-v2.md (fail; Conductor patch)
- [x] test-report-v2-conductor-patch.md (pass — 7/7 specs)
- [x] final-summary.md
- [ ] retro.md (post-run, filled in by owner)

## Decisions / events log
- 2026-05-26 01:01 — Conductor: run initialized, Discovery invoked.
- 2026-05-26 01:08 — Discovery returned `done` (agentId aeb95b2bcb070d812). 7 unknowns surfaced for Designer. Routing to Designer for design-v1.
- 2026-05-26 01:14 — Designer returned `done` (agentId ae59b1e8050b0284e). All 7 Discovery defaults adopted with justification. Routing to Validator.
- 2026-05-26 01:19 — Validator returned `no-go` (agentId a5c8fd30bbbf68485). 0 blockers, 3 majors (MAJ-1 pseudo-code inconsistency, MAJ-2 silent-seed-failure UX, MAJ-3 natural-key assumption needs DB constraint or explicit doc), 8 minors. Routing to Designer for design-v2. D↔V budget: 2/3 remaining.
- 2026-05-26 01:25 — Designer returned `done` for v2 (agentId afe554d6ff07a20ec). MAJ-1 rewritten as one canonical 6-step algorithm. MAJ-2 hard-fail policy (Validator's option a) — mutation rejects, user stays on routines list, orphan session salvageable in History. MAJ-3 option (a) — new partial-unique `(routine_id, exercise_id) WHERE deleted_at IS NULL` on routine_exercises in same migration. All 8 minors addressed. Routing to Validator for round 2 scoring.
- 2026-05-26 01:30 — Validator returned `go` on v2 (agentId ad4c4bde6b21e3d4e). 0 blockers, 0 majors, 5 cheap minors (doc/prose only). All v1 majors verified-resolved. Notable Implementer kickoff items: MIN-NEW-1 design's `npm test ... migration-backfill` is wrong — precedent uses `npx tsx <file>`; Implementer should add `test:migration` script. MIN-NEW-2 design's `addExerciseToRoutine` "existing 23505 handler" justification is wrong — handler code is fine; 23505 precedents at src/api/measurements.ts:50 + src/api/exercise-notes.ts:91-92. D↔V loop CLOSED. Routing to Implementer.
- 2026-05-26 01:46 — Implementer returned `done` (agentId aa44d567f2c0e568f). 15 files (8 new, 7 edited, 1 deleted). Static gates: typecheck clean, lint 0/0+1 pre-existing warning in router.d.ts, unit 376/376 (+12 new). 7 deviations from design all documented. Soft-callbacks: 0/2 used. Schema.ts intentional edit by Implementer (added routine_exercise_sets pgTable + parent_set_id self-FK + dropset CHECK invariant). Routing to Reviewer.
- 2026-05-26 01:52 — Reviewer returned `pass` (agentId a40df5d213285e6d0). 0 blockers, 0 majors, 5 cosmetic minors (dead-code line in e2e, doc-clarity in test header, input-reset future-robustness). All 7 declared deviations justified. Migration + seed algorithm + hard-fail policy + 23505 handler + UI a11y + queryCacheBuster bump all verified. I↔R round 1 used; pass on first try. Routing to Tester.
- 2026-05-26 02:14 — Tester returned `fail` (agentId aa8ee71478da482f5). Static gates green, migration pushed + verified (0013 | 0013 on remote), backfill check green, RLS arm green, 8 adjacent e2e suites all green, 6/7 new e2e specs pass. The 1 failure is at tests/e2e/routine-strong-builder.spec.ts:246 — string vs number type mismatch on PostgREST `numeric` response (expected "60.00" got 60). Feature itself works per golden screenshot 03-live-workout-checking.png (volume = 960 kg = 60×8 + 80×6). Test-only 1-line fix. Routing to Implementer for I↔T round 2. Budget 1/2 remaining after.
- 2026-05-26 02:16 — Implementer returned `done` for round-2 1-line fix (agentId a61714a52fee71112). `Number(s.weight)` wrap applied at tests/e2e/routine-strong-builder.spec.ts:246 per Tester recipe + precedent. Static gates re-verified green. Routing to Tester for round-2 re-run.
- 2026-05-26 02:50 — Tester returned `budget-exhausted` (agentId a4afbfab3caaef3dc). Round-1 fix verified. NEW finding at line 376: strict-mode locator violation (`getByText("Exercises", exact: true)` resolves to 2 elements: section header + tab bar). Reproducibility ~85%. Tester recommended Conductor out-of-band `.first()` patch with 8 sibling precedents documented. I↔T budget 2/2 used.
- 2026-05-26 02:55 — Conductor applied 1-line `.first()` patch at tests/e2e/routine-strong-builder.spec.ts:376 per Tester recipe, authorized by user's "keep going + push everything" pre-authorization. Re-ran spec: 7/7 pass. test-report-v2-conductor-patch.md written. Routing to Evaluator.
