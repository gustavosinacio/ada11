# Validation v2 — 2026-05-24_2327_exercise-note

Round: Design↔Validate round 2 of ≤3.
Reviewing: `design-v2.md`.

## v1 issue closure

| ID | Status |
|---|---|
| BLK-1 (`.upsert()` against partial UNIQUE) | RESOLVED — `.upsert()` removed; read-then-write with single recursive 23505 retry |
| MAJ-1 (no body length cap) | RESOLVED — 2000-char cap at zod + `maxLength` + DB CHECK |
| MAJ-2 (cascade divergence) | RESOLVED — `exercise_id ON DELETE RESTRICT` matches sibling tables |
| MIN-1 (empty Textarea 96-120px × N) | RESOLVED — collapsed `+ Add note` Pressable on `<ExerciseBlock>`; `alwaysExpanded={true}` on progress |
| MIN-3 (mis-cited precedent) | RESOLVED — `measurements.ts:121-159` cited correctly as INSERT+23505 |
| MIN-4 (RLS arm format) | RESOLVED — node:test sequence-of-await blocks |
| MIN-5 (hook smoke) | RESOLVED — deterministically skipped |
| MIN-6 (empty body display rule) | RESOLVED — single source-of-truth in `<ExerciseNoteSlot>` |
| MIN-7 (slot isLoading reflow) | RESOLVED — returns `null` while `isLoading` |

## Verified claims

| Claim | Verified? |
|---|---|
| BLK-1 read-then-write logic in `upsertMyExerciseNote` | YES |
| `char_length(body) <= 2000` SQL syntax valid in Postgres | YES |
| `exercise_id ON DELETE RESTRICT` matches `routine_exercises.exercise_id` + `sets.exercise_id` precedent | YES |
| `<ExerciseNoteSlot>` two-state design (collapsed Pressable + full Textarea via `alwaysExpanded`) | YES |
| Mount points file:line unchanged (progress 138-140, ExerciseBlock 215-217, ReadOnlyExerciseBlock 75-77) | YES |
| Soft-deleted row + INSERT path: partial UNIQUE `WHERE deleted_at IS NULL` excludes soft-deleted; fresh INSERT cannot collide | YES (mirrors `measurement_entries_user_day_idx` precedent) |
| 23505 retry bounded at depth 2 in normal case; mathematically bounded by concurrent racer count in Byzantine case | YES |
| N parallel `useMyExerciseNote` queries on workout screen | YES — acceptable, documented |

## Findings (all minors)

- **MIN-v2-1 — In-progress typing clobber risk on background refetch.** `useEffect` resync of `draft` from `row?.body` could overwrite user's typed text if TanStack window-focus refetch fires mid-edit. **Fix at Implement**: gate the resync — only adopt server value when `draft === lastSyncedFromServer` (user hasn't typed) OR when `expanded === false`.

- **MIN-v2-2 — Blur-empty must not persist `""` for never-existed rows.** In `commit()`, add `if (row == null && draft.trim() === "") return;` before `mutate(draft)`. Otherwise we'd save an empty row, contradicting "no-mutate" claim.

- **MIN-v2-3 — Recursion readability.** Refactor `upsertMyExerciseNote` to iterative loop (`for (let attempt = 0; attempt < 2; attempt++)`) for code-review clarity. Behavior unchanged.

- **MIN-v2-4 — First-paint reflow on workout (N independent queries resolving)**. As queries settle one-by-one, blocks reflow as the slot appears. Cosmetic only; Tester to confirm not janky.

- **MIN-v2-5 — Tester must run full e2e matrix.** 4-mount-point change with layout impact. Tester audit MUST be verified pass, not "sanity-run".

- **MIN-v2-6 — Name the CHECK constraint explicitly**: `constraint exercise_notes_body_length_check check (char_length(body) <= 2000)`. Matches `0005_measurements.sql:25,36` named-constraint hygiene precedent.

- **MIN-v2-7 — No `onError` rollback** on the upsert mutation. No optimistic update specified, so cache stays consistent. No action.

## Decision

**go**

Counts: blockers=0, majors=0, minors=7.

Confidence: HIGH on all closures (verified file:line). Risk: LOW-MEDIUM (concentrated in RLS test correctness + 23505 retry coverage, both pinned in test plan).

## Recommendation

**Invoke Implementer**. Hand-off notes (non-negotiable):
1. (MIN-v2-1) Add `lastSyncedFromServer` guard in `<ExerciseNoteSlot>`'s resync `useEffect`.
2. (MIN-v2-2) `commit()` skips mutate if `row == null && draft.trim() === ""`.
3. (MIN-v2-3) Iterative retry loop instead of recursion.
4. (MIN-v2-6) Name the CHECK constraint explicitly.
5. (MIN-v2-5) Tester runs FULL `tests/e2e/` matrix touching `<ExerciseBlock>`, not just the new spec.
