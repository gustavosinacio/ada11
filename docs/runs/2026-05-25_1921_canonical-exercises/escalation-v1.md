# Escalation v1 — canonical-exercises Tester fail (2026-05-25 21:25 BRT)

## Blocked at
- **Step**: 6. Test (round 1 of ≤2 I↔T)
- **Latest artifact**: `test-report-v1.md`
- **Latest assertion**: `decision: fail`

## What Tester found

Migration `0011_canonical_exercises.sql` correctly flipped all 127 exercise rows to `user_id IS NULL`. But 30 of those 127 rows have **stale `deleted_at IS NOT NULL`** — they were soft-deleted by the keeper user (`gsinacio94`) pre-migration with per-user intent. Now that the per-user semantic is gone (all rows are canonical), these 30 rows are admin-hidden from every user's picker. They're un-pickable.

**Failure cascade**: 51 e2e failures / 70 passes / 1 timeout. Most failures hit specs that hardcode "Bench Press" or similar names that survived; specs hitting one of the 30 (`exercise-progress-ia.spec.ts` lines 1+2 on canonical lookup) regress hard.

**AC scoring**:
- AC1 ✅ technically (127 with `user_id IS NULL`) — but visibility was implicit.
- AC2/AC3/AC6 ⚠️ partial — visibility broken for 30 rows.
- AC4/AC5 ✅ chip + gating + RLS rejection work.
- AC7 ⚠️ partial — gating spec 5/5 passes; broader suite has the cascade.

## The 30 soft-deleted canonical rows (full list per Tester)

Sample: Back Squat, Bicep Curl, Bent Over Row - Underhand (Barbell), Cable Tricep Pushdown, Chin Up, Goblet Squat, Pull Up/Chin Up, Push Up, Triceps Extension, plus 21 more.

(Implementer can re-query the full list via `SELECT name FROM exercises WHERE user_id IS NULL AND deleted_at IS NOT NULL ORDER BY name;` against the remote DB.)

## Why this is a product decision (not just an Implementer fix)

The user soft-deleted these 30 rows previously to **hide them from their own picker**. After the migration, soft-deleted means **hide from everyone**.

Three plausible product calls:

- **(a) Un-soft-delete all 30** (Tester's recommended fix). One-line UPDATE in a new migration `0012_*.sql`. Restores common names like "Push Up", "Back Squat", "Chin Up" to the shared catalog. **Downside**: imposes the keeper's prior personal library on every future user, including duplicates of seeded canon (e.g. "Push Up" vs seed's "Push-up") that the user may have hidden specifically to deduplicate.
- **(b) Hard-delete the 30**. They're truly gone. **Downside**: existing FK refs from historical `sets` / `routine_exercises` / `exercise_notes` would block via `ON DELETE RESTRICT`. Would need either pre-repoint (large) or accept the deletes will fail. Tester's evidence shows the keeper has historical sets against some of these rows.
- **(c) Case-by-case**. User reviews the 30 names and decides per-row: un-delete, keep hidden, or hard-delete (only if no FK refs). Most flexible, highest user-time cost.

## The Implementer also has 2 e2e specs to fix regardless

`tests/e2e/exercise-progress-ia.spec.ts` tests 1 + 2 hardcode "Bench Press" (which survived) but the broader pattern suggests other specs may regress if specific names disappear. Implementer should also tighten `pickCanonicalExercise(admin, preferred)` to throw when `preferred` is supplied-but-missing (instead of silent fallback) so a future leak surfaces as a spec error.

## Major (non-blocking)

Dev-server crashed mid-run during the e2e batch. Tester rates it low-confidence on causation (likely Expo memory pressure under single-worker 24-spec run, not a feature defect). Reproducible-by-restart; focused re-run after restart succeeded.

## Question for the human

Which product call do you want for the 30 soft-deleted canonical rows?

- (a) un-delete all 30
- (b) hard-delete all 30 (risk: FK conflicts on some)
- (c) case-by-case (provide a list of which to un-delete / hard-delete / keep hidden)

Recommended default: **(a)**. The keeper's prior personal-hide intent is no longer meaningful under the canonical model; the cleanup is reversible (admin can re-soft-delete any specific row later via service role).

## Resume instructions

On user response:
- Append the resolution to `state.md > Follow-up clarifications`.
- Append a `Resumed at <timestamp>` entry to `transcript.md`.
- Fill `Resolved at` below.
- Route → Implementer round 2 (I↔T r2) with: (i) new migration `0012_*.sql` per resolution, (ii) fix the 2 known regressing specs, (iii) optionally tighten the helper. Decrement I↔T budget to 0/2 after Tester verifies.

## Resolved at
- **Timestamp (BRT)**: 2026-05-25 22:18
- **Outcome**: **Option (a — Keep all 30 hidden)**. User reviewed the cross-reference of all 30 hidden names against the 97 visible canonical names (every one either has a similar visible equivalent or is gym-specific Strong-import cruft — sole weakest match is "Goblet Squat", accepted). No new data migration. NO `UPDATE … SET deleted_at = NULL`. App code changes only in test files + helper. The two name-clones in DB (`Reverse Fly, unilateral` visible + hidden — different UUIDs) stay as-is; no merge.
- **Resumed at step**: 4. Implement (round 2 of ≤2 Implement↔Test loops; entering with 1 round remaining).
