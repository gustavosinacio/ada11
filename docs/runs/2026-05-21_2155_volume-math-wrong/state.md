# Run: 2026-05-21_2155_volume-math-wrong

## Bug report (verbatim)

> The volume count seems really wrong. We should debug it and fix it.
> [Screenshot: History screen, "THIS WEEK 26.2k kg" headline]
>
> Also, the calculation of the previous pr seems wrong. If I lifted 120kg for 8 reps in one set, it should already be 960, right? Also add this to the feature list.
> [Screenshot: live workout, Bench Press "Volume to PR: 4.9k kg", Squat "Volume to PR: 5.8k kg", 00:35 elapsed, zero working sets logged]

## Follow-up clarifications

- User authored both observations during a fresh live-workout session on web (Safari, ada11.expo.app). At session start (00:35 elapsed), with no working sets yet checked, the "Volume to PR" strip already showed 4.9k kg (Bench) and 5.8k kg (Squat).
- 26.2k kg "THIS WEEK" total displayed on History tab; user feels it is wrong.
- Spec choice (via AskUserQuestion 21:59 BRT): "show the number properly, no abbreviation".
- Spec choice for "Volume to PR": fold into feature #6 (multi-metric strip) instead of changing the kernel definition.
- Strong-import set_number bug: queue as separate run.

## Baseline

- Branch: main
- Commit: 4e30d1561a2877ae14b435e627590a99594780b8

## Current state

- Owner: conductor
- Phase: done
- Status: done
- Started (BRT): 2026-05-21 21:55
- Updated (BRT): 2026-05-21 22:20

## Budgets remaining

- Implement ↔ Regression rounds: 2 / 2 (only one round used)
- Diagnose redirect (from later phases): 1 / 1 (unused)

## Artifacts

- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md
- [x] implementation.md
- [x] regression-report.md
- [x] retro.md
- [x] transcript.md (appended incrementally)

## Decisions / events log

- 2026-05-21 21:55 BRT — run initialized. Subagent dispatch for custom bug-fix roles unavailable; Conductor plays each role inline per playbook §67-73.
- 2026-05-21 21:58 BRT — Reproducer + Diagnostician complete. Verdict: no code bug in volume kernels (DB sum matches displays). Two product decisions surfaced + one unrelated data-integrity bug in import-strong (`set_number` collisions).
- 2026-05-21 21:59 BRT — User provided spec decisions via AskUserQuestion. Run scope narrowed to "remove k-shorthand from formatVolume"; Volume-to-PR concern folded into feature #6; Strong import bug queued for separate run.
- 2026-05-21 22:10 BRT — Implementer complete. 5 files edited; typecheck/lint/unit green.
- 2026-05-21 22:20 BRT — Regression Tester verdict: pass. Manual visual confirmation pending user reload.
