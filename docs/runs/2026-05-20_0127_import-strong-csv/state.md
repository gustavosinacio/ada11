# Run: 2026-05-20_0127_import-strong-csv

## Feature prompt
> I have a file with workouts exported from the strong app. I would like to import them to this app. the file is located at /Users/gustavoinacio/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong_workouts_may_2026.csv. How can this be done?

## User answers to Conductor's pre-pipeline questions
1. **Weight unit in Strong export**: kg.
2. **Timezone of Strong dates**: BRT (America/São_Paulo).
3. **Exercise reconciliation**: fuzzy match + manual review.
4. **Cardio rows** (Distância>0 or Segundos>0): drop.
5. **Where**: CLI script (`npm run import:strong`).
6. **Identifying imported data**: source flag on records, NOT external_id.

## Baseline
- Branch: main
- Commit at start: `15fab51`
- Final commit: `49aac97`

## Current state
- Owner: conductor
- Step: done — import landed end-to-end
- Status: done
- Started (BRT): 2026-05-20 01:27
- Updated (BRT): 2026-05-20 16:15

## Final result (verified via dry-run after real run)
- 12,381 CSV rows parsed.
- 774 cardio rows dropped.
- 11,607 strength sets imported across 642 sessions.
- 96 new exercises created with `source='strong'`.
- Last dry-run: 642 sessions already complete, 0 partial, 0 to insert — confirms idempotent steady state.

## Budgets remaining
- Design ↔ Validate rounds: 2 / 3 (1 used)
- Implement ↔ Review rounds: 1 / 2 (1 used)
- Implement ↔ Test rounds: 1 / 2 (1 used — implicit via real-run discovery)
- Implementer soft-callbacks: 2 / 2 (0 used)

## Artifacts produced
- [x] discovery.md
- [x] design-v1.md
- [x] validation-v1.md
- [x] implementation.md
- [x] review-v1.md
- [x] test-report-v1.md
- [x] final-summary.md
- [x] retro.md

## Decisions / events log
- 2026-05-20 01:27 — Run started. Baseline `15fab51`. User pre-aligned via 6-question scoping.
- 2026-05-20 01:30 — Discovery written. CSV: 12,381 rows, 156 unique exercise names.
- 2026-05-20 01:32 — Design v1 (two-pass CLI + migration 0006 source flag).
- 2026-05-20 01:34 — Validation v1: go, 0 blockers, 2 majors (MAJ-1 partial-failure recovery, MAJ-2 zero-set sessions), 4 minors.
- 2026-05-20 01:51 — User approved fix plan.
- 2026-05-20 02:05 — Implementation v1, review v1, test-report v1 written. All static gates green. Commit `1fb33ac`.
- 2026-05-20 08:50 — User report: `tsx: command not found`. Fix commit `4d52375`: `npx tsx` prefix.
- 2026-05-20 09:00 — User report: ADMIN_EMAIL not set. Fix commit `6fed145`: auto-load `.env.local` via dotenv + helpful error.
- 2026-05-20 15:30 — Mapping curation finalized after multiple review passes (13 unify edits + drop/create-new decisions).
- 2026-05-20 15:55 — First dry-run (buggy undercount, fixed in commit `f7b0835`); second dry-run reports 642 sessions / 11607 sets.
- 2026-05-20 16:00 — Real import attempt #1: 642 sessions inserted, but timestamp lookup mismatch ("Could not find inserted session id" for many) → most sets orphaned. **4 bugs surfaced** by the live run.
- 2026-05-20 16:10 — Hardening commit `49aac97`: tsKey normalization + Phase 1 idempotency + batched DELETE + paginated set-count query.
- 2026-05-20 16:12 — Real import attempt #2: MAJ-1 recovery deletes+reinserts the partial 511; ETIMEDOUT mid-batch.
- 2026-05-20 16:13 — Real import attempt #3 (with hardening): converges. 511 sessions reinserted, 8649 sets inserted, 131 already complete (those were the ones the first attempt happened to insert before the failure mode kicked in). Done.
- 2026-05-20 16:15 — Final verification dry-run: 642 already complete, 0 partial. Run closed as done.
