# Implementation — 2026-05-21_2330_strong-import-setnumber

Baseline commit: `f9ee22cf0a7af96608cd8814ac2e741e91c6d859`. User-approved revised plan (delete importer + CSV-aware backfill + unique-index migration).

## Files changed

- `scripts/import-strong.ts` (**deleted**) — importer code. User confirmed it will never run again. ~770 lines of one-shot code retired; lives in git history.
- `scripts/debug-weekly-volume.ts` (**deleted**) — diagnostic from the prior volume-math run; obsolete now that the backfill is done.
- `scripts/backfill-strong-setnumber.ts` (**created → run → deleted**) — one-shot CSV-aware backfill. Read the original Strong CSV (`/Users/.../strong_workouts_may_2026.csv`) in row order; mapped CSV rows to DB rows; re-numbered set_number 1..N within each (session, exercise) group; applied 7,933 row updates in batches with pre/post sanity assertion (356 → 0 collisions).
- `scripts/find-all-dups.ts` (**created → run → deleted**) — verification probe.
- `scripts/debug-strong-setnumber.ts` (**created → run → deleted**) — collision scope probe (revealed 356/1,118 — 24× larger than the original estimate).
- `scripts/debug-strong-exercises.ts` (**created → run → deleted**) — exercise-name resolution probe (revealed 11 user-renamed exercises).
- `scripts/fix-leggiday-dup.ts` + `scripts/verify-leggiday.ts` (**created → run → deleted**) — one-off native-dup fix.
- `package.json` (edited) — removed `"import:strong": "..."` script entry. No longer referenced.
- `tests/unit/session-times-form.test.ts` (edited) — dropped stale JSDoc reference to `scripts/import-strong.ts:57`.
- `supabase/migrations/0008_sets_unique_set_number.sql` (**new**) — partial unique index on `(session_id, exercise_id, set_number) WHERE deleted_at IS NULL`. Applied to prod via `npx supabase db push --linked`. Catches any future regression at the DB layer.
- `docs/features.md` (edited) — closed the Strong-import bug item; pre-existing additions from the user during the run (year-on-old-dates feature, debounce-double-tap feature, PR-info-after-beat feature) preserved.

## Deviations from plan

**Pivot from the original fix-plan to the user's revised plan.** Original plan was: fix the importer code + backfill the (then-estimated) 46 rows + add unique index + add a unit test. User correctly observed: importer is one-shot, won't run again, so fixing it is wasted effort. Revised plan: delete importer entirely, backfill the (actually 1,118) rows directly, keep the unique index.

**Discovery during dry-run forced a second pivot — CSV-aware (option 2) over pure SQL (option 1).** Within-batch collision groups have tied `created_at` + random UUIDs, so pure SQL could not recover original chronological order. User chose option 2 (use CSV file).

**Found a second bug class outside the original scope.** Native code (not Strong import) had one duplicate row in the 2026-05-21 Leggiday session — same Leg Extension set inserted twice ~0.28s apart, both stamped `set_number=2`. Renumbered to `set_number=3` to preserve data. Logged separately in the backlog as "prevent quick-succession double-tap" (a feature, not part of this run's spec, but the unique index now traps it at the DB layer regardless).

## Soft callbacks made

None.

## Quality gates

- [x] `npm run typecheck` — pass (clean, no diagnostics)
- [x] `npm run lint` — pass (0 errors; 1 pre-existing unrelated warning in `router.d.ts`)
- [x] `npm run test:unit` — 92/92 pass
- [x] `npx supabase db push --linked` — applied 0008 migration to prod after sanity-fixing the native dup
- [x] Backfill dry-run + apply both verified post-state = 0 collisions
- [x] DB-level verification post-migration: 0 duplicate `(session, exercise, set_number)` groups across 11,656 non-deleted sets
- [x] No new `any` / `// @ts-ignore` / stray `console.log`

## Process notes (for retro)

- The original "46 rows" estimate (from a trailing-8-weeks slice) was **24× smaller** than the full-history reality (1,118 rows). Future bug-fix runs should explicitly note when a stat is windowed vs full-history.
- Fingerprint matching for renamed exercises only worked after normalizing weight string format ("4.50" CSV vs "4.5" DB). Recurring lesson: numeric values in mixed string/number columns need canonicalisation before equality compare.
- The "fix script" pattern with a fabricated full-UUID is dangerous — a no-op `.eq("id", non-matching)` does not error, the success message lied. Future one-shot scripts should always `.select()` after `.update()` and assert row count.
- The DB unique index doing its job during the migration (refusing to land on the native dup) was a great smoke-test signal. Worth keeping.

## Notes for Regression Tester

- Re-run `find-all-dups`-style probe (deleted but pattern documented above) — expect 0 collisions.
- Manual smoke: load a Strong-imported session in History detail — set numbering should be 1, 2, 3, ... with no duplicates. Specific test sessions: any "Costinha", "Backup", "Treino do meio-dia" workout with dropsets pre-2026-05-21.
- "Anterior" placeholder on a new Bench Press / Squat / Leg Curl set should now show the user's most-recent set values cleanly (deterministic, no UUID lottery).
- The 0008 migration is in prod; rolling back would require `DROP INDEX sets_session_exercise_set_number_unique;`.
