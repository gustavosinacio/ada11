# Final summary — 2026-05-24_2327_exercise-note

## Outcome
- **Feature**: Personal per-(user, exercise) note. New `exercise_notes` table with RLS. Visible on 4 surfaces (progress screen + live `<ExerciseBlock>` + history-edit `<ExerciseBlock>` + history-read `<ReadOnlyExerciseBlock>`). Commit-on-blur editing with collapsed `+ Add note` affordance on dense surfaces, `alwaysExpanded` Textarea on progress.
- **Pipeline result**: **shipped + debt cleared** (round 3 stabilized the golden e2e — see "Debt payoff" below).
- **Branch / baseline**: `main` / `aba47051b8328c990d3dbe9a464831c89a804639`
- **User mandate**: "special care" — honored across 2 D↔V + 1 I↔R + 2 I↔T rounds (3 design revisions before approval).

## Metrics
| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (5/6 deterministic e2e + RLS arm + 364/364 unit + network trace) |
| Human interventions | 2 (U1 schema decision + final close decision) |
| Total round-trips | 5 (2 D↔V + 1 I↔R + 2 I↔T) |
| D↔V rounds | 2 (round 2 → go after BLK-1 + 2 majors closed) |
| I↔R rounds | 1 (pass) |
| I↔T rounds | 2 (round 1 fail on test-design defects → round 2 pass on 5/6 specs, golden flake remains) |
| Soft callbacks | 0 |
| Wall-clock | ~8h 40min (23:27 → 08:09 BRT; long pauses for user decision) |

## User decisions
- **U1 (storage)**: Option 2 — new `exercise_notes` table (over reusing existing `exercises.notes` column). "Cleaner separation; future-proof for shared exercise libraries."
- **Final close**: Ship with the known golden-e2e flake; follow-up ticket to harden.

## Validator catches (the load-bearing wins)

### Round 1 (no-go: 1 BLK + 2 MAJs + 7 MIN)
- **BLK-1**: `.upsert()` against partial UNIQUE index is a **guaranteed runtime failure** (PG `42P10`) — PostgREST doesn't forward `WHERE` predicate of `ON CONFLICT`. Zero in-codebase precedent for partial-index upsert. v2 fix: read-then-write with iterative 23505 retry.
- **MAJ-1**: No body length cap → Android UI hang risk on multi-MB paste. v2 fix: 2000-char cap at 3 layers (zod + maxLength + DB CHECK).
- **MAJ-2**: `exercise_id ON DELETE CASCADE` divergence from sibling tables (`sets`, `routine_exercises` use `restrict`) with zero behavioral benefit today. v2 fix: switched to `ON DELETE RESTRICT`.

### Round 2 (go: 0/0/7 polish)
- 7 polish minors all handled at Implement time (named CHECK constraint, draft-divergence resync, blur-empty mutate skip, iterative retry, full-e2e matrix mandate).

### Implementer round 2 (test-only fixes after Tester round 1 fail)
- Test-only fixes: blur-sequence + verdict-screen navigation + admin-seed for history paths. 6/6 e2e pass on Implementer's 3 consecutive verifications.

### Tester round 2 (close round)
- Re-validation surfaced the golden test is ~33-50% flaky — React Query in-memory cache primes empty `sets` before admin INSERT lands. 5/6 specs deterministic; 4 visual screenshots confirm feature works.

## Files shipped (13 total)

### New
- `supabase/migrations/0010_exercise_notes.sql` — table + 4 RLS policies + named CHECK `exercise_notes_body_length_check` + UNIQUE partial index + `touch_updated_at` trigger.
- `src/api/exercise-notes.ts` — `getMyExerciseNote(exerciseId)` + `upsertMyExerciseNote(exerciseId, body)` (iterative 23505-retry read-then-write).
- `src/hooks/use-exercise-note.ts` — `useMyExerciseNote` + `useUpsertMyExerciseNote` with `["exercise_note", exerciseId, "me"]` cache key.
- `src/components/exercise-note-slot.tsx` — self-wired slot with `{exerciseId, editable, alwaysExpanded?}` props. Draft-divergence resync guard preserves typing through background refetch. Empty-bail skips mutate. A11y: `"Add a note for this exercise"` (collapsed) + `"Exercise note"` (expanded).
- `tests/unit/exercise-notes-api.test.ts` — 10 cases (auth gating, null-on-no-row, 23505 retry race).
- `tests/e2e/exercise-note.spec.ts` — 6 specs (5 deterministic + 1 known-flaky).

### Edited
- `src/db/schema.ts` — `exerciseNotes` Drizzle table.
- `src/db/types.ts` — `ExerciseNote` / `ExerciseNoteRow` types.
- `app/(app)/exercises/[id]/progress.tsx` — mount `<ExerciseNoteSlot editable alwaysExpanded>` between summary and chart.
- `src/components/exercise-block.tsx` — mount `<ExerciseNoteSlot editable>` below header.
- `src/components/read-only-exercise-block.tsx` — mount `<ExerciseNoteSlot editable={false}>` below header.
- `tests/rls.test.ts` — new `exercise_notes` arm mirroring `measurement_entries` precedent (User A insert → User B cannot SELECT/UPDATE/DELETE + INSERT-spoof rejection).

**Diff size**: +118/-0 production code + new files. Migration `0010_exercise_notes.sql` requires `db:push` from the user.

## Quality gates
- Typecheck: clean.
- Lint: 0 errors, 1 pre-existing warning (`router.d.ts`).
- Unit tests: 364/364 pass (+10 new vs prior 354).
- New e2e: 5/6 deterministic; golden test #1 is flaky (~33-50%).
- RLS smoke test arm: passes.
- Visual: 4 screenshots from round 1 (golden progress, live workout, history read-only, collapsed `+ Add note`).
- Regression sweep on the full e2e matrix touching `<ExerciseBlock>`: 36/40, 4 baseline-preexisting failures (post-Finish URL regex stale since verdict-screen feature; same as F3-F8 surfaced).

## Debt payoff (round 3, user-authorized)
**The golden e2e test stabilized.** Round 3 (test-only) refactored test #1 to admin-seed `sessions` + `sets` server-side and deep-link directly to `/history/{sessionId}`, mirroring the pattern already used in tests #3-#6. Removed the `/workout/{id}` step that primed React Query's in-memory cache with empty `sets`. Implementer initially removed the `purgeQueryCache` helper entirely but uncovered a SECOND cache race against the AsyncStorage persister's 1000ms throttle — re-added the helper at a single annotated site. Tester independently verified: **20/20 golden across two independent dev-server boots** (durations 7.4-10.4s), **12/12 full suite × 2**, source diff empty (`git diff main -- src/* app/* supabase/*` returns nothing). No source files touched in round 3.

## Why we stopped (per playbook: budget exhausted)
I↔T budget exhausted (round 2 closed with fail). User authorized close-via-ship-with-known-debt rather than escalate to a hypothetical round 3.

## Migration note for user
**The migration `supabase/migrations/0010_exercise_notes.sql` has NOT been pushed to remote.** User must run `npm run db:push` (or equivalent) to apply the table + RLS to production Supabase before users can write notes.

## Artifacts
- state, discovery, design-v1 (superseded), validation-v1 (no-go 1/2/7), design-v2 (shipped), validation-v2 (go 0/0/7), implementation.md, review-v1.md, test-report-v1.md (fail — spec defects), test-report-v2.md (fail — golden flake; budget close), transcript.
- `screenshots/` — 4 visual evidence files from round 1.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-24_2327_exercise-note/` on 2026-05-25.
