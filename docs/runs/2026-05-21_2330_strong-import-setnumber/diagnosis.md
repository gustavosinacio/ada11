# Diagnosis — 2026-05-21_2330_strong-import-setnumber

## Hypothesis (stated before code investigation)

Given the repro (356 collision groups × 1 118 rows across 235 Strong-imported sessions; 334 of 356 on set_number=1; 22 on set_number=2 or 3), I suspect the cause is at `scripts/import-strong.ts:517-518` — the `parseInt ?? "1"` fallback assigns `set_number = 1` whenever the CSV value is empty or unparseable. The 13+9 collisions on set_number=2/3 suggest a second pathway: Strong's "Ordem da série" sometimes legitimately exports the same integer for multiple rows of the same exercise within one workout (likely dropsets, cluster sets, or "failure set" annotations sharing the parent's position).

## Evidence

### Source-of-truth files (verified by reading)

- `scripts/import-strong.ts:517-518` — the smoking gun:
  ```ts
  const setNumberRaw = parseInt(r[H.setOrder] ?? "1", 10);
  const setNumber = Number.isFinite(setNumberRaw) ? setNumberRaw : 1;
  ```
  Two failure modes:
  - `r["Ordem da série"]` is `undefined` → `parseInt(undefined ?? "1", 10)` = `parseInt("1", 10)` = `1`.
  - `r["Ordem da série"]` is `""` → `parseInt("", 10)` = `NaN` → fallback to `1`.
- `scripts/import-strong.ts:715-722` — every imported set is assigned `set_type: "working"` and `parent_set_id: null`. Strong's "set sub-type" metadata (dropset, cluster, failure) is **discarded** — so the importer treats dropset sub-rows as ordinary working rows. This is why Strong's set_order=2 with 3 dropset children becomes "4 rows all with set_number=2".
- `src/db/schema.ts` (referenced via grep) — `set_number INT NOT NULL` on the `sets` table, but **no DB-level unique constraint** on `(session_id, exercise_id, set_number)`. The "uniqueness" is implicit (relied on by UI ordering), not enforced.
- `src/api/sets.ts` — `addWorkingSet` and friends compute the next `set_number` by `MAX(set_number) + 1` on the live screen, so future native sets cannot collide. Only the bulk-import path produces collisions.
- `src/api/progress.ts:10-39` — `listSetsForExercise` orders by `completed_at ASC, set_number ASC`. With duplicates in `set_number`, ordering within a session falls back to PostgreSQL's implicit row order (effectively random).
- `src/components/set-input.tsx` — "Anterior" column reads `previousByExercise.get(exId)` shaped from the previous session's last set. With duplicates, "last" is ambiguous.

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `scripts/import-strong.ts:517-518` | `parseInt(...) ?? 1` fallback | Root cause of all 356 collisions. | **blocker** for the fix run |
| DB rows in `sets` table | 1 118 rows with duplicate `(session_id, exercise_id, set_number)` | Existing corruption from the 2026-05-20 import. | **major** — backfill needed |
| `src/db/schema.ts` `sets` table | no unique constraint on `(session_id, exercise_id, set_number)` | Allowed the bug to land silently. Adding the constraint would catch any future regressions cleanly. | minor (consider in fix plan) |

### Cross-environment confirmation

The bug manifests only on the Strong-import path because that is the ONLY path that inserts sets with `set_number` derived from an external string. Native code paths (`addWorkingSet`, `bulkCheckAllInSession`, manual reorders) always derive `set_number` from `MAX(set_number) + 1` over existing rows in the same `(session, exercise)` group, which guarantees uniqueness.

Therefore: no new collisions can be introduced after the importer is fixed. The fix scope is finite (existing 1 118 rows + the importer).

## Root cause

`scripts/import-strong.ts:517-518` treats `set_number` as a faithful echo of Strong's CSV column. When Strong's column is empty (most often) or shared across multiple rows of the same exercise (less often), the importer silently produces duplicate `set_number` values within `(session_id, exercise_id)` groups. The DB has no unique constraint preventing the write. The downstream UI (history, progress, "Anterior" column) assumes uniqueness for ordering and rendering, so the bug surfaces as wrong-set-counts / wrong-previous-placeholders / scrambled chronology.

## Severity classification

- **Blocker**
  - `scripts/import-strong.ts:517-518` — every future re-import would compound the data corruption.
- **Major**
  - DB: 1 118 corrupted rows across 356 `(session, exercise)` groups. Affects user-visible history / progress / "Anterior" placeholders RIGHT NOW.
- **Minor (out of scope by default)**
  - `src/db/schema.ts` `sets` — adding a `UNIQUE(session_id, exercise_id, set_number) WHERE deleted_at IS NULL` partial index. Would prevent any future regression and trip CI immediately on a bad import. Consider for the fix plan (low effort, high safety value), but technically separate from the reported bug.

## Symptom-only fix risk

A symptom-only fix would be "just backfill the 1 118 rows" without fixing the importer. Any new Strong import would immediately reintroduce duplicates. **Both must ship together** — importer fix + one-shot backfill.

## Backfill approach (for Fix Designer)

**Strongly recommend: surgical, SQL-based.**

1. Identify the 356 affected `(session_id, exercise_id)` groups by `HAVING COUNT(*) > COUNT(DISTINCT set_number)`.
2. For each affected group, re-number ALL rows by `ROW_NUMBER() OVER (PARTITION BY session_id, exercise_id ORDER BY completed_at NULLS LAST, created_at, id)`. The naïve "renumber everything" simulation showed 8 392 row changes because clean groups all share `completed_at` + tied `created_at` (single batch insert) and tie-break on random UUID `id`. Restricting to affected groups only ⇒ exactly 1 118 row updates (every row in every affected group becomes part of a fresh 1..N sequence).
3. Wrap in a transaction with a sanity check pre/post: count of `(session_id, exercise_id)` groups where `COUNT(*) > COUNT(DISTINCT set_number)` must go from 356 to 0.

Idempotency: re-running yields zero affected groups → no-op. Safe to retry if interrupted.

Execution path options for Fix Designer to evaluate:

- **Option A (Drizzle migration)**: ship as a one-off migration in `drizzle/`. Pros: auditable in repo; runs via `npm run db:push`. Cons: this is a data backfill, not a schema change — Drizzle's migration model fits less cleanly.
- **Option B (Node script)**: `scripts/backfill-strong-setnumber.ts`. Pros: aligns with `scripts/import-strong.ts` precedent; can dry-run; idempotent; explicit confirmation gate. Cons: not version-controlled as a migration. **Preferred** given the existing tooling.

Importer fix: replace the `parseInt`/fallback logic with a per-(session, exercise) row-position counter built during CSV parse. Concretely: as `group.sets.push(...)` happens, count existing sets in the group for the target exercise and assign `set_number = existingCount + 1`. Discard `r["Ordem da série"]` entirely — Strong's value is unreliable and the chronological CSV order is the only reliable signal.

## Optional schema hardening

Add `UNIQUE INDEX sets_session_exercise_set_number_unique ON sets(session_id, exercise_id, set_number) WHERE deleted_at IS NULL` after backfill. Prevents future regressions and makes the importer's row-position logic verifiable. Out of scope for the bug-fix per default but easy to include in the fix-plan and worth the user's call.
