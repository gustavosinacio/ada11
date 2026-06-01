# Run: 2026-06-01_0941_session-finish-exercise-order

## Bug report (verbatim)
"When I finish my sessions, the order of the exercises gets messed up." (Owner added to docs/features.md "## Open" — "Let's investigate".)

Conductor framing passed to the pipeline: during a live workout the exercises appear in a specific order (routine-seeded or ad-hoc add order). After tapping Finish, when the session is viewed in History (`app/(app)/history/[id].tsx`) and/or the end-of-session verdict screen, exercises render in a DIFFERENT order than during the live workout. No exact repro steps given — Reproducer to make it deterministic (which screen, which entry point, routine vs ad-hoc, single vs multi-exercise).

Investigation starting points (verify, do NOT assume): live workout exercise-ordering in `app/(app)/workout/[sessionId].tsx`; `listSetsForSession` `.order(...)` in `src/api/sets.ts` (ordering by `completed_at` reshuffles exercises once sets are checked out of list order — known shape, see volume-target.ts MAJ-1 currentWeight comment); history detail + verdict ordering; whether routine position / set_number provides a stable order being overridden by a completion-timestamp sort; unchecked-set discard on Finish changing the first-set timestamp per exercise.

## Triage outcome
PIPELINE (not direct fix). Triggers: multi-file scope (live / verdict / history share ordering logic + the sets query); UI bug without visual evidence (no screenshot attached); diagnosis requires >5 min (must trace ordering across the query + 3 screens + git history). When in doubt → pipeline.

## Follow-up clarifications
- 2026-06-01 (at approval gate) — Owner ADDED a requirement: expose the up/down reorder chevron on the History detail EDIT page so older sessions can be re-sequenced, and PERSIST that reorder. This also resolves the "old sessions can't recover their order" tradeoff (manual reorder writes session_exercise_order for the first time on a legacy session). Owner also chose: migration applied by OWNER via `db:push` (not me). Scope expands from pure bug-fix → bug-fix + small History reorder feature on the SAME column. Re-routing to Fix Designer for fix-plan-v2 before re-presenting at the approval gate.

## Baseline
- Branch: main
- baseline_branch: main
- Commit: 5985c576af32081f84b41b2169cfef8d537a913d
- baseline_commit: 5985c576af32081f84b41b2169cfef8d537a913d

## Current state
- Owner: conductor
- Phase: done (fixed — finalizing: retro + Evaluator + commit + archive)
- Status: done
- Started (BRT): 2026-06-01 09:41
- Updated (BRT): 2026-06-01 11:45
- Regression Tester PASS (symptom gone ×3 shapes, reorder+legacy recovery OK, 0 regressions, gates green incl web export, RLS holds). Migration 0019 already applied to live DB. Non-blocking: de-flake the new spec's reopen assertion (wrap in toPass — Tester pre-validated 3/3). chart-scroll 2/4 = pre-existing (task #12). Then finalize + commit.
- APPROVED: owner approved fix-plan-v2 at 10:38. NEW AUTONOMY GRANT (changed from earlier "you apply db:push"): owner now authorizes the Conductor to APPLY the migration(s) to the live Supabase DB, COMMIT, and DEPLOY (eas deploy web) — "all yourself" — at the end of the batch. Migration 0016 to be applied by Conductor before the Regression Tester's live e2e (additive/reversible). Final push origin/main + deploy after the whole batch (this fix + chart-scroll + Phase 2b) is green.

## Budgets remaining
- Implement ↔ Regression rounds: 2 / 2
- Diagnose redirect (from later phases): 1 / 1

## Artifacts
- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md (v1)
- [x] fix-plan-v2.md (adds History reorder; APPROVED 2026-06-01 10:38)
- [x] implementation.md
- [x] regression-report.md (PASS)
- [ ] retro.md
- [ ] transcript.md (appended incrementally)

## Decisions / events log
- 2026-06-01 09:41 — Run initialized. Baseline main @ 5985c57 (after e1RM chart shipped). Triage → pipeline. Note: `.claude/agents/*` DO dispatch as real subagents in this deployment (the fix-playbook's lines 67-73 caveat is stale — just used them in the feature pipeline), so each role runs as a true Agent invocation.
