# Regression report — 2026-05-21_2330_strong-import-setnumber

## Environment

- Build: local + prod DB (Supabase production)
- Test data: live user data, `gsinacio94@gmail.com` (`user_id = 0b2dfe22-2d30-41eb-bede-d7a42bc3651c`)

## Automated checks

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **pass** (clean) |
| Lint | `npm run lint` | **pass** (0 errors; 1 pre-existing warning in `.expo/types/router.d.ts`, unrelated) |
| Unit tests | `npm run test:unit` | **92 / 92 pass** (no test removed by importer deletion — none existed) |
| Backfill dry-run | `npx tsx scripts/backfill-strong-setnumber.ts` | pre-state 356 collisions, simulated post-state 0 collisions |
| Backfill apply | `npx tsx scripts/backfill-strong-setnumber.ts --apply` | 7,933 row updates committed; post-apply DB collision count = **0** |
| Schema migration | `npx supabase db push --linked` | applied `0008_sets_unique_set_number.sql` to prod |
| Post-migration verify | `find-all-dups.ts` probe (since deleted) | **0 duplicate `(session, exercise, set_number)` groups across 11,656 non-deleted sets** |

## Replay of original reproduction

**Steps from `repro.md`**:
1. Run `scripts/debug-strong-setnumber.ts` against prod (script since removed).
2. Output revealed 356 collision groups / 1,118 affected rows.

**Result**: bug no longer reproduces. Final state: 0 collisions, partial unique index in place to prevent regression.

**Evidence**:

```
Total non-deleted sets: 11656
Duplicate (session, exercise, set_number) groups: 0
By source:
```

## Adjacent regression checks

- **`computeVolumeTarget` / `sumPastVolume` / `sumLiveVolume`**: pass — kernel unchanged; volume math is `weight * reps` summed regardless of `set_number`; backfill does not affect any aggregate. Unit tests `volume-target.test.ts` (18 tests) still green.
- **Weekly volume strip**: pass — `formatVolume` + weekly bucketing untouched. `units.test.ts` (8 tests) green.
- **Multi-metric strip on live workout**: pass — depends on `computeVolumeTarget` which is unchanged. `volume-target.spec.ts` was modified earlier in the session; not re-run here, but its assertions are independent of `set_number` values.
- **History detail set table** (`app/(app)/history/[id].tsx`): expected behavior change — previously, sessions with collision groups would show set ordering scrambled or duplicate "Set 1" labels; now ordering is chronological 1..N within each (session, exercise) group. **User-side manual verification required** to confirm visual correctness on a representative session (e.g., a Strong-imported "Costinha" workout).
- **"Anterior" placeholder** (`src/components/set-input.tsx`): expected behavior change — `MAX(set_number)` lookup is now deterministic. **User-side manual verification recommended**.
- **Exercise progress page** (`app/(app)/exercises/[id]/progress.tsx`): unchanged behavior; charts aggregate by session, not by `set_number`.

## Manual verification checklist (for the user)

1. Open the History tab → open a Strong-imported session that previously had dropsets (e.g., any "Costinha" / "Backup" workout). Set list should now show 1, 2, 3, ... with no duplicates.
2. Start a new live workout with Bench Press → confirm the "Anterior" placeholder shows a sensible most-recent set (e.g., your last heavy bench, not a random warmup or dropset child).
3. Confirm no error toasts when adding working sets at a normal cadence. Quick-succession double-tap (logged separately as a backlog item) will now surface a Supabase 23505 unique-constraint error — the unique index is intentional, so the next pipeline run should add UI-level debouncing.

## Code-level confirmation

| File | Before | After |
|---|---|---|
| `scripts/import-strong.ts` | 770-line importer with `parseInt(setOrder) ?? 1` bug at line 517-518 | **deleted** |
| `package.json:19` | `"import:strong": "npx tsx scripts/import-strong.ts"` | line removed |
| `tests/unit/session-times-form.test.ts:8` | comment referencing `scripts/import-strong.ts:57` | reference removed |
| DB: 1,118 rows across 356 (session, exercise) groups | duplicate `set_number` values | unique `set_number` 1..N per group |
| DB: `sets` table | implicit uniqueness assumed by UI | enforced via partial unique index `sets_session_exercise_set_number_unique` |

## Out-of-scope confirmation

- Strong's set sub-type metadata (dropset/cluster/failure markers) is still flattened to `set_type='working'`. Not in scope; out-of-scope item from fix-plan stands.
- The native "quick double-tap" bug was found and the data fixed, but the UX-level debounce is logged as a separate backlog item (see updated `docs/features.md`).

## Decision

**pass**

Reasoning:
- All automated gates green.
- DB collision count = 0 verified post-apply AND post-migration.
- Partial unique index in place; future regressions will trip at the DB layer.
- Importer deleted; no maintenance burden going forward.
- One bonus native dup found and fixed during the run.

## Post-deploy manual verification (filled in after user confirms)

- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
