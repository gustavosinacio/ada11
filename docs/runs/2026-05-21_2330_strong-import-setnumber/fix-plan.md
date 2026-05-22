# Fix plan — 2026-05-21_2330_strong-import-setnumber

## Scope

**In:**
1. **Importer fix** (`scripts/import-strong.ts`) — replace the `parseInt(setOrder) ?? 1` fallback with a per-`(session, exercise)` row-position counter. Strong's "Ordem da série" column is discarded entirely; CSV row order is the source of truth.
2. **One-shot backfill** of the 1,118 affected rows across 356 `(session, exercise)` groups in the user's prod DB. Surgical: only affected groups are touched.
3. **Schema hardening** (new partial unique index) so any future regression trips at the DB layer before users see it.

**Out:**
- Re-importing the user's Strong data wholesale (the backfill is enough; data is already in the DB).
- Reworking Strong's dropset/cluster-set semantic (still mapped to `set_type='working'`; out of scope).
- Any change to native (non-import) write paths.

## Approach

The bug is one bad line and 1,118 corrupted rows. The cleanest path is two coordinated changes shipped together: a 3-line importer rewrite + a single backfill script + a tiny migration adding a partial unique index. The schema constraint is the keystone — once present, no future code can re-introduce this class of bug silently.

Backfill uses a single SQL `UPDATE … FROM (SELECT ROW_NUMBER() OVER …)` over only the 356 affected groups, ordered by `(completed_at NULLS LAST, created_at, id)`. Clean groups stay untouched. Wrapped in a transaction with a pre/post sanity assertion (collision count goes from 356 → 0 or the txn rolls back). Same migration step adds the unique index AFTER the backfill (so the index creation doesn't fail on existing duplicates).

The importer fix counts how many sets already exist in the in-memory `group.sets[]` for the same exercise before pushing the new one; assign `set_number = existingCount + 1`. This is deterministic, single-pass, and matches the native code's `MAX(set_number) + 1` semantic.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `scripts/import-strong.ts` | edited | Replace `parseInt(r[H.setOrder] ?? "1")` + fallback (lines 517-518) with a per-(session_id, exercise_id) counter built during CSV parse. Remove the `H.setOrder` reference. Add a JSDoc note explaining why we discard Strong's column. |
| `scripts/backfill-strong-setnumber.ts` | **new** | Idempotent, dry-run-first backfill script. Steps: (1) print pre-state (count of collision groups), (2) compute new set_numbers via a single SQL `UPDATE … FROM (SELECT ROW_NUMBER() OVER … WHERE (session, exercise) IN affected_groups)`, (3) print post-state, (4) assert post-state collision count == 0 or throw. Service-role; env from `.env.local`. |
| `supabase/migrations/<timestamp>_sets_unique_set_number.sql` | **new** | Partial unique index: `CREATE UNIQUE INDEX sets_session_exercise_set_number_unique ON sets (session_id, exercise_id, set_number) WHERE deleted_at IS NULL;`. Run AFTER backfill so the index creation does not fail on existing duplicates. |
| `package.json` | edited | Add `"backfill:strong-setnumber": "npx tsx scripts/backfill-strong-setnumber.ts"` for parity with `import:strong`. |
| (optional) `tests/unit/import-strong.test.ts` | **new** | Synthetic unit test of the new counter logic. Input: 5 fabricated CSV rows for two exercises in one session, mix of empty and duplicated "Ordem da série" values. Expected output: `set_number` 1..N within each (session, exercise) group. |

## Contratos de I/O

- **Function signatures / types added or changed**: importer's internal `Phase 2` body changes — `set_number` no longer derived from CSV. No exported signatures move.
- **DB columns / queries**: `sets.set_number` values updated for ~1,118 rows. New partial unique index on `sets`. No new columns.
- **UI props / state**: none directly. UI ordering relying on `set_number` will start showing the corrected sequence after backfill.

## Riscos

- **Regressões em fluxos adjacentes**: history detail (`app/(app)/history/[id].tsx`), progress page (`app/(app)/exercises/[id]/progress.tsx`), and "Anterior" placeholder (`src/components/set-input.tsx`) all consume `set_number` for ordering. After backfill they will reflect the corrected sequence — which is the intent. **Sanity check**: spot-check a few historically-displayed sessions before/after and confirm the display is now sensible (the user's "Anterior" 80×8 expectation, if real, is downstream of this fix).
- **Data integrity**: the backfill writes 1,118 rows in one transaction. Risk of partial application is mitigated by the transaction wrapper and the pre/post assertion. The unique index addition is a separate migration that runs after the backfill confirms zero collisions.
- **Platform-specific**: none (server-side data fix).
- **Performance**: backfill is a single SQL statement on 11,607 rows scoped via CTE to 235 sessions; runs in well under a second. Adding a partial unique index over 11,607 rows is sub-second too.
- **Idempotency**: the backfill is safe to re-run (no-op when collision count == 0). The migration uses `CREATE UNIQUE INDEX IF NOT EXISTS` to also be re-runnable.

## Alternativas descartadas

1. **Naïve full sweep (renumber ALL 11,607 Strong rows)** — descartada: simulator showed ~8,392 spurious changes due to tied `created_at`/UUID tiebreaker on clean groups. Surgical scope is correct.
2. **Trust Strong's "Ordem da série" when valid; only fall back to row-position when empty** — descartada: 22 collisions on set_number=2/3 prove Strong's value is unreliable even when present (dropsets / cluster sets share parent's set_order). Hybrid logic adds complexity for no gain.
3. **Re-importing the entire CSV from scratch** — descartada: the user no longer has guaranteed access to the original CSV; re-import would also lose any native edits made since the import. Surgical DB backfill is reversible without that dependency.
4. **Drizzle migration for the backfill** — descartada in favor of a Node script: Drizzle's migration model fits schema changes, not data writes; the dry-run + service-role pattern from `scripts/import-strong.ts` is more idiomatic for this codebase.

## Out of scope (follow-up)

- Strong's set sub-type metadata (dropset, cluster, failure) is currently flattened to `set_type='working'`. If the user wants those preserved on future re-imports, that's a separate feature run.
- "Anterior" placeholder logic in `src/components/set-input.tsx` may have its own quirks if it picks a non-deterministic last set; revisit if the symptom persists after backfill.

## Regression test plan (preview — Regression Tester will execute)

- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit` (including the new `import-strong.test.ts` if added).
- **Dry-run the backfill** (`scripts/backfill-strong-setnumber.ts --dry-run`): asserts the 356→0 transition without writing. Required to pass before the live run.
- **Live run the backfill** in production; expect 1,118 rows updated, zero post-state collisions.
- **Re-run `scripts/debug-strong-setnumber.ts`** post-backfill: expect "Collision groups: 0".
- **Manual UI smoke** (user-side):
  - Open a historical Strong session in the history detail screen. Set numbers should be 1, 2, 3, … with no duplicates.
  - Open a Strong-imported exercise's progress page. Chart should show per-session aggregates without ordering anomalies.
  - In a new live workout, start an exercise that has Strong-imported history. The "Anterior" column should show a sensible most-recent set.
- **Importer regression**: re-run `npm run import:strong -- analyze <csv>` followed by `import` with the existing mapping CSV in dry-run mode. Confirm zero new collisions would be inserted.

## Confidence / Risk

- **Confiança**: **ALTA** — root cause is one line; the corruption shape is well-characterized (356 groups, 1,118 rows, all in one bulk import); fix logic matches the native code's existing `MAX + 1` pattern.
- **Risco**: **MÉDIO** — the backfill writes to 1,118 prod rows. Mitigated by: transaction wrapper, pre/post collision-count assertion, idempotent design, mandatory dry-run before live run, scope limited to a single user (the only user with Strong data).

## Awaiting

**Human approval before the Implement phase.** Specifically:
1. **Approve the schema-hardening** (new partial unique index) — yes / no. Default-yes if no objection.
2. **Approve a Node script over a Drizzle migration** for the backfill — yes / no. Default-yes.
3. **Optional**: include the synthetic `tests/unit/import-strong.test.ts` — yes / no. Default-yes.
4. Any other preferences before I move into Implement.
