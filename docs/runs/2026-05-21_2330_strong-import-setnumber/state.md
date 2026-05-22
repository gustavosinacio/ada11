# Run: 2026-05-21_2330_strong-import-setnumber

## Bug report (verbatim)

> Strong CSV importer assigns `set_number = 1` to every set whose "Ordem da série" column is missing/empty (`scripts/import-strong.ts:517-518`). 46 rows in current data violate the implied `(session_id, exercise_id, set_number)` unique key. Fix the importer to auto-increment within `(session, exercise)` ordered by row appearance + backfill existing duplicates (re-number by `completed_at, created_at`). Affects: set numbering on history detail / progress page, "Anterior" column. Does NOT affect volume math. Evidence: `docs/runs/2026-05-21_2155_volume-math-wrong/diagnosis.md`.

## Follow-up clarifications

- Surfaced as a side-finding during the volume-math-wrong run (2026-05-21 21:55 BRT). User decision via AskUserQuestion: "Yes, queue it (Recommended)" — fix importer + backfill existing rows.
- Diagnostic revealed scope was 24× larger than the 46-row initial estimate: full-history = **356 collision groups / 1,118 corrupted rows / 235 sessions**.
- User pivoted the plan: "the import is already done and will not be used again" → delete importer code instead of fixing it; backfill DB directly + add unique index to the schema.
- User chose **CSV-aware (option 2)** for the backfill so chronological order from the original Strong export is preserved.
- CSV file path: `/Users/gustavoinacio/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong_workouts_may_2026.csv`.
- 11 user-renamed Strong exercises auto-resolved via session+weight+reps fingerprint matching.
- Found bonus native dup (Leggiday 2026-05-21 Leg Extension), fixed manually, logged as separate backlog item (debounce double-tap).

## Baseline

- Branch: main
- Commit: f9ee22cf0a7af96608cd8814ac2e741e91c6d859

## Current state

- Owner: conductor
- Phase: done
- Status: done
- Started (BRT): 2026-05-21 23:30
- Updated (BRT): 2026-05-22 00:35

## Budgets remaining

- Implement ↔ Regression rounds: 2 / 2 (used 1; single pass)
- Diagnose redirect (from later phases): 1 / 1 (unused)

## Artifacts

- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md (revised mid-run per user pivot; original plan superseded by the delete-importer + CSV-aware approach)
- [x] implementation.md
- [x] regression-report.md
- [x] retro.md
- [x] transcript.md (appended incrementally)

## Decisions / events log

- 2026-05-21 23:30 BRT — run initialized. Triage: pipeline-worthy (multi-file scope = importer + DB backfill; data-write side-effect requires the mandatory approval gate after Fix Designer). Custom-agent dispatch unavailable for bug-fix roles; Conductor plays each inline per playbook §67-73.
- 2026-05-21 23:38 BRT — Reproducer + Diagnostician complete. Scope is 24× the initial estimate (1,118 rows / 356 groups, not 46).
- 2026-05-21 23:50 BRT — User pivot #1: delete the importer (one-shot code; will not run again).
- 2026-05-21 23:55 BRT — User pivot #2 after seeing the impossibility of recovering chronological order from DB alone: use the CSV file (option 2) for the backfill.
- 2026-05-22 00:10 BRT — CSV-aware backfill applied: 7,933 row updates, 0 collisions remaining.
- 2026-05-22 00:20 BRT — Migration `0008_sets_unique_set_number.sql` failed initially due to a native dup in the Leggiday session; fixed manually, then re-applied. Migration landed.
- 2026-05-22 00:30 BRT — Importer + all one-shot scripts deleted. Quality gates green (typecheck/lint/92-unit). Backlog updated.
- 2026-05-22 00:35 BRT — Retro written; run done.
