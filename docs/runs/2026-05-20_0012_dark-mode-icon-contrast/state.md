# Run: 2026-05-20_0012_dark-mode-icon-contrast

> Bug-fix run. Pipeline-fix playbook does not exist yet — this run is the first source of patterns for it. Artifacts are written ad-hoc, then extracted into a playbook in retro.md.

## Bug report (verbatim)
> Eu estou vendo algumas telas ficando em "branco" quando estão em views mobile. No momento isso acontece na tela de exercicios.

Follow-up clarifications from the user:
- "I see this error only when using the page from the homescreen, installed like an app" (PWA standalone on iOS).
- "the button to add a new exercise is not showing up properly" + screenshot.
- "This also happens on the routines page."

## Baseline
- Branch: main
- Commit: `43a19995`

## Current state
- Owner: conductor
- Phase: done
- Status: done
- Started (BRT): 2026-05-20 00:12
- Updated (BRT): 2026-05-20 00:34
- Commit: `0ab8dda`
- Production URL: https://ada11.expo.app
- Deployment URL: https://ada11--7hk8c6ln0e.expo.app
- User verification: pass (PWA standalone, dark + light modes)

## Phases
- [x] Repro — confirmed via screenshot + user clarification
- [x] Diagnose — root cause identified (hardcoded icon colors don't adapt to theme)
- [x] Fix plan — approved by user
- [x] Implement — 3 files edited, all static gates green
- [x] Regression test — automated gates pass; manual visual verification pending user
- [x] Retro — pipeline-fix playbook v0 drafted in retro.md

## Artifacts
- [x] state.md
- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md
- [x] implementation.md
- [x] regression-report.md
- [x] transcript.md
- [x] retro.md

## Decisions / events log
- 2026-05-20 00:12 — Run started after user reported "blank screens in PWA on exercises"
- 2026-05-20 00:13 — User clarified: PWA standalone iOS only (Reproducer step)
- 2026-05-20 00:14 — Screenshot revealed actual symptom: + icon invisible due to hardcoded color, not full blank screen
- 2026-05-20 00:15 — User confirmed routines page has same symptom
- 2026-05-20 00:15 — Grep confirmed scope: 3 blocker locations, 5+ minor gray-tone occurrences (deferred)
- 2026-05-20 00:18 — fix-plan.md drafted
- 2026-05-20 00:20 — User approved fix plan
- 2026-05-20 00:22 — 3 files edited (9 Edit operations total)
- 2026-05-20 00:24 — Static gates green: typecheck, lint, 33/33 unit tests, web export
- 2026-05-20 00:25 — Regression report written; retro drafted with pipeline-fix playbook v0
