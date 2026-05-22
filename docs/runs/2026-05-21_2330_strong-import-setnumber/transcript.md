# Transcript — 2026-05-21_2330_strong-import-setnumber

## 2026-05-21 23:30 BRT — Conductor: intake + triage

Bug surfaced as a side-finding of run `2026-05-21_2155_volume-math-wrong`. User chose to queue a separate fix run via AskUserQuestion.

Triage decision: **pipeline-worthy**.

Routing: Reproducer next (inline Conductor role per playbook §67-73).

## 2026-05-21 23:35 BRT — Conductor (Reproducer-role)

- **Inputs**: bug report from prior run's diagnosis, `scripts/import-strong.ts:517-518`.
- **Action**: ran a full-history diagnostic (`scripts/debug-strong-setnumber.ts`).
- **Returned**: scope is **24× larger** than the windowed estimate. 356 collision groups / 1,118 rows / 235 sessions. Set-order markers `D` / `A` / `F` plus 22 numeric-but-duplicated cases. `repro.md` written.

## 2026-05-21 23:38 BRT — Conductor (Diagnostician-role)

- **Inputs**: repro.md, importer source.
- **Returned**: root cause confirmed at `import-strong.ts:517-518` (`parseInt ?? 1` fallback). Severity blocker for importer, major for 1,118 corrupted rows. `diagnosis.md` written.

## 2026-05-21 23:45 BRT — Conductor (Fix Designer-role): plan v1

Original plan: fix importer + backfill 1,118 rows + add partial unique index + add unit test. `fix-plan.md` written. Presented to user.

## 2026-05-21 23:50 BRT — User pivot #1

> "The import is already done and will not be used again. If this bug affects what is on supabase, we should fix it directly on the db and remove the importer logic."

Conductor agreed (light pushback recommending to keep the unique index). Revised plan: delete importer + SQL backfill + unique index migration.

## 2026-05-21 23:55 BRT — User pivot #2

After Conductor pointed out that pure SQL cannot recover chronological order from within-batch collisions (tied `created_at` + random UUIDs), user chose option 2 (CSV-aware backfill).

User provided CSV path: `/Users/gustavoinacio/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong_workouts_may_2026.csv`.

## 2026-05-22 00:00 BRT — Conductor (Implementer-role): backfill script v1

Wrote `scripts/backfill-strong-setnumber.ts`. Dry-run failed: 32 collisions remained post-simulation. Root cause: 752 CSV rows had `action='create-new'` mapping entries with no ada11 id; my exact-name fallback failed for 11 user-renamed exercises.

## 2026-05-22 00:05 BRT — Backfill v2: fingerprint matching

Added auto-recovery: match each unresolved Strong name to a strong-source ada11 exercise by matching the multiset of `(session_started_at, weight, reps)`. Initial fingerprint compare failed due to numeric string format mismatch (`"4.50"` CSV vs `"4.5"` DB). Normalised via `parseFloat`. All 11 unresolved names auto-resolved.

Dry-run state: 11,607 rows after filter (matches DB); 7,933 rows queued; pre 356 collisions → simulated post 0 collisions.

## 2026-05-22 00:10 BRT — Apply

- `npx tsx scripts/backfill-strong-setnumber.ts --apply` → 7,933 row updates committed.
- Post-apply verification: 0 collisions.

## 2026-05-22 00:15 BRT — Migration attempt #1

`npx supabase db push --linked` → FAILED. Error: native dup remained in Leggiday session (Leg Extension Unilateral, two rows at set_number=2, same 36×8). Migration unique index refused to land.

## 2026-05-22 00:20 BRT — Native dup fix

- First attempt: fix script used fabricated full UUID, silently no-op'd (success message lied).
- Second attempt: correct full UUID `36c9addd-66a5-4490-b741-5e360dbc84e6`, with `.select()` row-count verification.
- Result: 1 row renumbered set_number=2 → 3.

## 2026-05-22 00:25 BRT — Migration attempt #2

`npx supabase db push --linked` → SUCCESS. `0008_sets_unique_set_number.sql` applied to prod.

Post-migration verification: 0 duplicate groups across 11,656 non-deleted sets.

## 2026-05-22 00:30 BRT — Cleanup

- Deleted `scripts/import-strong.ts` + all one-shot scripts (`backfill-strong-setnumber.ts`, `debug-*.ts`, `fix-leggiday-dup.ts`, `verify-leggiday.ts`, `find-all-dups.ts`).
- Removed `import:strong` script entry from `package.json`.
- Removed stale JSDoc reference in `tests/unit/session-times-form.test.ts:8`.
- Updated `docs/features.md`: closed the Strong-import bug item; preserved 3 new user-added items (year-on-old-dates, debounce-double-tap, PR-info-after-beat).

Quality gates: typecheck/lint/92-unit all green.

## 2026-05-22 00:35 BRT — Retro + finalize

Wrote `regression-report.md`, `retro.md`, updated `state.md` to done. Ready for commit + vault archive.
