# Run: 2026-05-24_2327_exercise-note

## Feature prompt
Exercise note. Be able to add a personal note to an exercise that will always show on that exercise, independent of the routine. This note belongs to the user on that exercise, not to the exercise directly. The database needs to handle one note per (user, exercise) pair — these notes are private to the individual user. Surfaces: (1) the exercise's progress/detail screen should show the note prominently with an edit affordance; (2) when an `<ExerciseBlock>` is rendered on the live workout screen, the note should be visible to the user (e.g. inline below the exercise header). Editing should be a simple text area. New table `exercise_notes` (user_id + exercise_id + body, plus timestamps) with RLS so each user only reads/writes their own. New migration. Standard hook + API pair, mirror the `user_preferences` precedent for the auth-scoped reads.

## Baseline
- Branch: main
- Commit: aba47051b8328c990d3dbe9a464831c89a804639

## Current state
- Owner: conductor
- Step: 7. Finalize
- Round: n/a
- Status: done-with-known-debt
- Started (BRT): 2026-05-24 23:27
- Updated (BRT): 2026-05-25 08:09

## Budgets remaining
- Design ↔ Validate rounds: 1 / 3 (closed after r2 go)
- Implement ↔ Review rounds: 1 / 2 (closed at r1 pass)
- Implement ↔ Test rounds: 0 / 2 (exhausted at r2 fail; user authorized ship-with-known-debt)
- Implementer soft-callbacks: 2 / 2

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] design-v2.md
- [x] validation-v2.md
- [x] implementation.md
- [x] review-v1.md
- [x] test-report-v1.md
- [x] test-report-v2.md
- [x] final-summary.md

## Decisions / events log
- 2026-05-24 23:27 BRT — Run initialized. Next migration number: 0010. Invoking Discovery.
- 2026-05-24 23:35 BRT — Discovery returned `done` (12 unknowns; HIGH conf on diagnosis). Escalated U1 to user: `exercises.notes` column already exists (added migration 0002), `exercises` is per-user. User decided **Option 2: new `exercise_notes` table** with "special care" mandate. Routing to Designer with explicit guidance: 4-surface coverage (progress + live ExerciseBlock + history-edit ExerciseBlock + history-read ReadOnlyExerciseBlock), RLS smoke test arm (matching `tests/rls.test.ts` precedent), `exercise_id` cascade rule, edit affordance design.
- 2026-05-24 23:42 BRT — Designer returned `done` v1. HIGH conf / MEDIUM risk. Schema: UUID `id` PK + UNIQUE partial index `(user_id, exercise_id) WHERE deleted_at IS NULL` (diverges from Conductor's "composite PK" framing — forced by soft-delete idiom). `exercise_id` ON DELETE CASCADE (diverges from sibling tables' `restrict`; justified because notes are private cues not history). `<ExerciseNoteSlot>` self-wired (mirrors `<VolumeTargetSlot>`). 4 mount points verified file:line. Open contingency: PostgREST `onConflict` may not honor partial unique index → fallback to read-then-write internal to `upsertMyExerciseNote` (external contract unchanged). 13 files; new migration `0010_exercise_notes.sql`. Routing to Validator round 1.
- 2026-05-24 23:50 BRT — Validator returned `no-go` round 1 (1 blocker / 2 majors / 7 minors). BLK-1: `.upsert()` against partial unique index is guaranteed `42P10` failure (NOT a contingency) — PostgREST doesn't forward `WHERE` predicate. Zero in-codebase precedent for partial-index upsert. `measurements.ts` uses explicit INSERT+catch-23505, not `.upsert()`. MAJ-1: no body length cap at any layer (Android UI hang risk). MAJ-2: `exercise_id ON DELETE CASCADE` has zero behavioral benefit today (no hard-delete UI) and diverges from sibling `restrict` precedent. Persisted `validation-v1.md`. Routing to Designer v2.
- 2026-05-24 23:58 BRT — Designer returned `done` v2. HIGH conf / LOW-MEDIUM risk. BLK-1: `.upsert()` removed entirely; read-then-write with single recursive retry on 23505. MAJ-1: 2000-char cap at 3 layers (zod + maxLength + DB CHECK). MAJ-2: `exercise_id ON DELETE RESTRICT` matches sibling tables. MIN-1: collapsed `+ Add note` Pressable for empty editable on `<ExerciseBlock>` (autofocus on tap, blur-empty collapses back without mutating); progress screen uses new `alwaysExpanded` prop for the full empty textarea. All 7 minors addressed. Routing to Validator round 2.
- 2026-05-25 00:19 BRT — Validator returned `go` round 2 (0/0/7 polish). All v1 BLK + MAJs verified closed file:line. 7 new polish minors: in-progress typing clobber, blur-empty `""` persistence guard, recursion→iteration for readability, first-paint reflow note, full-e2e-matrix mandate, named CHECK constraint, no-onError-rollback (n/a). Persisted `validation-v2.md`. D↔V loop closed. Routing to Implementer.
- 2026-05-25 00:35 BRT — Implementer returned `done`. 13 files (6 new: migration + API + hook + slot + 2 tests; 7 edited). Typecheck/lint clean, 364/364 unit tests (+10 new), 6 e2e specs enumerate. 4 documented deviations: stricter draft-divergence resync rule (covers `alwaysExpanded` paths the design's gate missed), `commit()` resets local draft on empty-bail, `commit()` snapshots `previousSnapshot` for onError rollback, docs/data-model.md NOT updated (pre-existing drift flagged for Reviewer). All 5 validator hand-off notes honored. Routing to Reviewer.
- 2026-05-25 00:42 BRT — Reviewer returned `pass` round 1 (0/0/7). All 10 special-care verifications confirmed file:line. Implementer's stricter draft-divergence rule recognized as strictly-stronger than spec (covers `alwaysExpanded` paths). RLS arm exceeds spec (also asserts INSERT-spoof rejection). Typecheck re-run independently clean. I↔R loop closed. Routing to Tester with FULL e2e matrix mandate per MIN-v2-5.
- 2026-05-25 01:20 BRT — Tester returned `fail` round 1 — BUT failures are e2e SPEC-design defects, NOT feature defects. Feature itself works (proven via diagnostic spec recording PATCH `body="diagnostic note!"`, 4 screenshots, 10/10 unit, RLS arm pass, 4/6 new e2e passing, regression sweep 36/40 with 4 pre-existing flakes verified via stash). Spec defects: (a) golden blur sequence at `exercise-note.spec.ts:140-148` — `document.activeElement.blur()` after clicking exercise-name heading is fragile, use `page.keyboard.press("Tab")`; (b) post-Finish navigation at `:193-196` and `:316-322` — needs verdict-screen pattern from `end-of-session-verdict.spec.ts:245-274`; (c) test #3 history-read-only no-note path needs to log at least 1 working set before Finish (otherwise no `<ReadOnlyExerciseBlock>` mounts). Routing to Implementer r2 with surgical spec-only fixes. I↔T budget: 1/2 remaining.
- 2026-05-25 01:50 BRT — Implementer round 2 returned `done`. Test-only changes. 6/6 e2e pass across 3 consecutive runs. 2 scope expansions beyond hand-off: added `waitForResponse` POST gate for fix #1 (value-assertion was insufficient — local Textarea reflects draft regardless of server commit); fix #3 replaced UI-driven set-seeding with full admin seeding + direct deep-link (intermittent race against history's `sets` query, pattern mirrors `read-only-history.spec.ts:82-151`). Typecheck/lint clean. Routing to Tester r2.
- 2026-05-25 04:30 BRT — Tester round 2 returned `budget-exhausted` with `fail` decision. Feature works (5/6 deterministic + RLS + 364/364 unit + network trace + 4 screenshots). Golden test #1 is ~33-50% flaky due to React Query in-memory cache priming empty `sets` before admin INSERT. Fix well-understood (~30 LOC apply admin-seed pattern to golden test, OR add `page.reload()` after INSERT). Implementer's "3 consecutive 6/6" claim not reproducible.
- 2026-05-25 08:09 BRT — Conductor escalated to user. User authorized **ship with known debt**. Pipeline closes with done-with-known-debt status. Follow-up ticket warranted for the golden e2e stabilization.
