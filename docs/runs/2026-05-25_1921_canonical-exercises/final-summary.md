# Final summary — 2026-05-25_1921_canonical-exercises

## Outcome
- **Feature**: Canonical exercises (shared catalog) — `exercises.user_id` becomes nullable; NULL = canonical (visible to all, app-immutable, admin-edited via DB), non-NULL = user-owned. Picker + library list render a "Created by you" chip on user-owned rows. Edit/soft-delete affordances hidden for canonical rows; deep-link to edit screen renders read-only.
- **Pipeline result**: **shipped** (Tester round 2 pass; all 7 acceptance criteria green).
- **Branch / final commit**: `main` / `77029d4` (working-tree changes uncommitted — owner decides when to commit per CLAUDE.md "Only create commits when requested by the user").

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes — Tester r2 verified all 7 AC pass; golden-path screenshots from r1 still valid (round 2 had zero source-file delta) |
| Human interventions during run | **1** — escalation-v1 resolution (30 soft-deleted canonical rows: keep all hidden) |
| Total round-trips (sum of all loops) | **5** — D↔V 1 + I↔R 1 + I↔T 2 + 1 human escalation |
| Design ↔ Validate rounds | 1 |
| Implement ↔ Review rounds | 1 |
| Implement ↔ Test rounds | 2 |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~4h 16m (19:21 BRT start → 23:37 BRT finalize) |
| Token cost (if known) | n/a |

## What shipped

### Migration
- `supabase/migrations/0011_canonical_exercises.sql` — 5-step single-transaction migration applied to remote DB during Implementer round 1: (1) drop NOT NULL on `exercises.user_id`; (2) `UPDATE exercises SET user_id = NULL` (127 rows flipped); (3) replace 4 RLS policies inline (SELECT widened to `user_id IS NULL OR user_id = auth.uid()`; INSERT/UPDATE/DELETE keep `user_id = auth.uid()`); (4) `CREATE OR REPLACE FUNCTION seed_new_user()` dropping the exercises INSERT block, keeping `user_preferences` insert; (5) drop unused `exercises_user_idx`.

### Schema-as-code
- `src/db/schema.ts` — drop `.notNull()` on `exercises.userId`; remove `userIdx` declaration.
- `src/db/types.ts` — `ExerciseRow.user_id: string | null`.
- `src/lib/query-client.ts` — `queryCacheBuster` bumped to `"schema-2026-05-25-canonical-exercises"` (per Decision 9).

### UI surfaces
- `src/components/created-by-you-chip.tsx` — new shared chip component (slate-100/800, a11y label).
- `src/components/exercise-picker.tsx` — chip rendered when `row.user_id !== null`.
- `src/components/exercise-list-item.tsx` — chip rendered when `row.user_id !== null`.
- `app/(app)/exercises/[id]/progress.tsx` — header pencil hidden when `exercise.data?.user_id == null` (`canEdit = exercise.data ? exercise.data.user_id !== null : true` — pencil visible during loading rather than appearing after; intentional, MIN-4 mitigation from Validator r1).
- `app/(app)/exercises/[id]/index.tsx` — canonical-row branch renders read-only `<Text>` view; no Save / Cancel / Delete affordances. Defense-in-depth alongside the hidden pencil.

### Test infrastructure
- `tests/e2e/_helpers/canonical-exercise.ts` — new `pickCanonicalExercise(admin, preferred?)` helper. Round 2 tightening: throws `Canonical exercise '<name>' not found or is hidden (deleted_at IS NOT NULL)` when `preferred` is supplied-but-missing. Round-1 silent-fallback behaviour replaced.
- `tests/e2e/canonical-exercise-gating.spec.ts` — 5 new tests covering AC4/AC5/AC7 (chip predicate, pencil-absent, deep-link-read-only, RLS reject mutate).
- `tests/rls.test.ts` — new canonical-exercises arm (6 sub-assertions covering cross-user SELECT visibility, anon-read pin, INSERT/UPDATE/DELETE rejection on canonical).
- `tests/seed-and-auth.test.ts` — rewritten signup assertions for canonical model (new user gets `user_preferences` row + 0 exercise rows; sees 97 visible canonicals via RLS).
- 16 e2e specs migrated to use `pickCanonicalExercise` helper (Implementer r1) + 3 specs with hardcoded `Back Squat` references swapped to `Squat (Barbell)` (Implementer r2: rest-timer-auto-start ×11, auto-fill-placeholder-on-check ×13, remove-exercise ×4).
- `tests/e2e/exercise-progress-ia.spec.ts` tests 1+2 rewritten to admin-seed a user-owned exercise (independent regression: tests asserted on the now-absent edit-pencil for canonical "Bench Press").
- `playwright.config.ts` — explicit `testMatch: /.*\.spec\.ts$/` so the `_helpers/` directory isn't picked up.
- `scripts/create-user.ts` — diagnostic now prints per-user + canonical exercise counts separately (avoids misleading `exercises seeded: 0` after the migration).

## DB state at finalize

- **127 total exercise rows**, all with `user_id IS NULL`.
- **97 visible canonical** (`deleted_at IS NULL`).
- **30 hidden canonical** (`deleted_at IS NOT NULL`) — keeper's pre-migration personal soft-deletes; verified each has a similar visible canonical or is gym-specific Strong-import cruft. Historical sets remain attached and resolve correctly. Intentional under resolution-v1.
- **0 user-owned exercises** in production.

## Why we paused mid-run (escalation-v1)

Tester round 1 found that the original migration flipped `user_id → NULL` but did not touch `deleted_at`. 30 of the 127 rows were soft-deleted by the keeper pre-migration with per-user intent. Under the canonical model, soft-deleted means hidden from everyone. The fix was a **product decision**, not a code defect — user resolved by keeping all 30 hidden (verified each has a visible canonical equivalent or is Strong-import cruft). Implementer round 2 scope shrank to test-only fixes (helper hardening + `Back Squat` → `Squat (Barbell)` swaps + `exercise-progress-ia` 1+2 rewrite). No new migration. Full details in `escalation-v1.md`.

## Pre-existing issues forwarded (not blocking — Tester r2 verified)

- **Major (Tester r1+r2 both observed)**: dev-server OOM crash mid full-suite run. Reproduces identically across both rounds; canonical-impacted specs (6 files, ~38 tests) all green in isolation post-restart. Suggested follow-up: `NODE_OPTIONS=--max-old-space-size=8192` or batch the suite. Not a canonical-exercises defect.
- **Minor**: `probe-strong-unify` test 5 (opacity assertion `"0.6"` vs `"1"` at line 220) — pre-existing and unrelated.
- **Cleanup debt** (Tester r1 self-flagged): one orphan `exercises` row with `user_id = 7b84eaca-…` `My Custom Lift 1779754255748` leftover from Tester's round-1 golden-path screenshot script. Owning ephemeral auth user already deleted; UI-invisible. Auto-mode classifier blocked Tester's cleanup attempt. **Worth investigating** — under the schema's `ON DELETE cascade` on `exercises.user_id → auth.users.id`, this row should have vanished. Either the cascade didn't fire or the auth user wasn't fully deleted. Possibly a Supabase-side eventual-consistency quirk; possibly a real cascade-not-firing bug. Recommend a quick maintenance pass post-finalization.

## Validator-r1 advisories that remained (carry-over for next run)

6 advisory minors from Reviewer r1 (`review-v1.md`) — chip a11y native-platform nuance, 2 specs with import ordering inside package-block, gating spec 5 missing pre-flight SELECT auth proof, 3 `as string` casts in helper, playwright.config comment nit, edit-screen `useEffect.reset()` on canonical. None blocking; backfill list for retro.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md)
- [`validation-v1.md`](./validation-v1.md) — go (0 blockers, 1 major MAJ-1, 7 minors)
- [`implementation.md`](./implementation.md) — rounds 1 + 2
- [`review-v1.md`](./review-v1.md) — pass (0 blockers, 0 majors, 6 advisory minors)
- [`test-report-v1.md`](./test-report-v1.md) — fail (30 hidden rows defect)
- [`escalation-v1.md`](./escalation-v1.md) — resolved by user (keep all hidden)
- [`test-report-v2.md`](./test-report-v2.md) — pass (all 7 AC green)
- [`transcript.md`](./transcript.md)
- [`screenshots/`](./screenshots/) — 6 golden-path screenshots from Tester r1 (still valid after r2)
- `retro.md` — to be filled in post-Evaluator

## Bugs found post-merge (backfill within 7 days)
- (none yet — owner updates this section as bugs surface)

## Notes (backfill)

- The cascade-orphan finding (`My Custom Lift 1779754255748`) is the only material loose end. Worth a 10-minute investigation post-pipeline.
- The pencil-flash mitigation (MIN-4) — canonical rows briefly show the pencil during loading, then it disappears. Designer's accepted UX trade-off; might be worth a follow-up retro item if user feels it's distracting.
- Optimisation opportunity for future: `exercises_user_idx` was dropped; if user-owned-exercise volume grows, a partial index `(user_id) WHERE user_id IS NOT NULL` would be the right add (currently YAGNI at 0 user-owned rows).

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-25_1921_canonical-exercises/` on 2026-05-26 00:31 BRT.
- Vault README updated with one-line wikilink entry at the top of the pipeline-runs index.
