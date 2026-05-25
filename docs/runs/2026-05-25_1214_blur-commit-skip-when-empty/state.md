# Run: 2026-05-25_1214_blur-commit-skip-when-empty

## Bug report (verbatim)
> F7 follow-up: stabilise the auto-fill PATCH race by removing the no-op blur-commit. When a user taps the check button on a working set with empty/zero inputs, two PATCHes fire concurrently against the same row: (1) `<SetInput>.commit()` triggered by blur sending `setMutation.mutate({weight: null, reps: null})`, and (2) the toggle handler's auto-fill `updateSet.mutate({weight: "120", reps: 8})`. PostgREST has no ordering guarantee → 33-50% flake on E1/E7 in `tests/e2e/auto-fill-placeholder-on-check.spec.ts`. Architectural fix (Option A): modify `<SetInput>.commit()` in `src/components/set-input.tsx` to skip the mutate when the local strings are empty AND the corresponding `row.weight`/`row.reps` are already null.

## Follow-up clarifications
- Trade-off accepted: user who types `100` then erases it then taps check will see the previous-session placeholder auto-filled instead of their erase intent. Matches the spec's "empty AND zero must trigger auto-fill" semantic. Pin this in tests as the new contract.
- Option A picked over (B) signal-based suppression, (C) per-set mutation queue, (D) server-side conditional update.

## Conductor's pre-diagnosis
The colliding PATCH is identifiable at `<SetInput>.commit()` — a no-op write (null → null) when both fields are empty AND the row was already null. Removing it requires `<SetInput>` to read the current row from props (it already has `row` as a prop) and gate the mutation. Approximate change: 5 LOC in `set-input.tsx`. Test updates: tighten E1/E7 to assert exactly 1 PATCH per check by intercepting `PATCH /rest/v1/sets`.

## Baseline
- Branch: main
- Commit: 5190a5836ee95091b273f58ab74e178c433fdbfc

## Current state
- Owner: conductor
- Phase: done
- Status: done
- Started (BRT): 2026-05-25 12:14
- Updated (BRT): 2026-05-25 14:53

## Budgets remaining
- Implement ↔ Regression rounds: 2 / 2
- Diagnose redirect (from later phases): 1 / 1

## Artifacts
- [x] repro.md
- [x] diagnosis.md
- [x] fix-plan.md
- [x] implementation.md
- [x] regression-report.md
- [x] retro.md
- [ ] transcript.md (appended incrementally)

## Decisions / events log
- 2026-05-25 12:14 BRT — Run initialized. Pre-diagnosis from F7 retro + Conductor's consulting recommendation handed off. Invoking Reproducer to verify the race shape + the proposed gate.
- 2026-05-25 12:22 BRT — Reproducer returned `done` with a critical correction: **E1/E7 (the specs the Conductor brief targeted) never focus the TextInputs — no blur, no commit(), no race**. The Conductor brief was factually wrong; the 33-50% flake is in **E2/E3** (typed-not-blurred), which Option A as proposed does NOT fix. Option A targets a real architectural shape (focused-empty + check) but it has NO covering spec in E1-E10. Diagnostician must clarify scope: (a) ship Option A + new e2e for Repro A architectural shape, OR (b) different fix needed for E2/E3 (merge patches, mutation queue, etc.). History-edit unaffected. Routing to Diagnostician.
- 2026-05-25 12:32 BRT — Diagnostician returned `done`. **Two distinct races, not one**: Race 1 (architectural PATCH race, E2/E3, blur+commit colliding with auto-fill) AND Race 2 (test-side: `gotoLiveSession` doesn't wait for placeholder render → `previousSet=null` → no auto-fill → row null → E1/E7 NaN). Recommended **Path 3**: Option A + new e2e for Repro A + tighten `gotoLiveSession` to wait for placeholder. Defer E2/E3 (Race 1 typed-then-checked) to a separate run. HIGH conf / LOW risk. Routing to Fix Designer.
- 2026-05-25 12:42 BRT — Fix Designer returned `done`. 2 files affected: source gate in `set-input.tsx` + new E11 spec + tightened `gotoLiveSession` helper. 2 Implementer-verify TODOs flagged: (1) predicate uses `kgFromInputString(s, unit)` not `parseFloat0(s, unit)` per actual API; (2) PATCH-counting interception pattern needs stable approach. ALTA conf / BAIXO risk. **User approved via "continue"**. Routing to Implementer.
- 2026-05-25 13:05 BRT — Implementer returned `done`. 0 deviations. Both TODOs resolved: (1) gate uses `kgFromInputString(weight, unit) + parseInt0(reps)`; (2) PATCH counting via `page.on('request')` filtered by URL + method + body. `gotoLiveSession` gate is visible-placeholder anchor (`getByPlaceholder(...).first().toBeVisible()`) — opt-in via `opts?.previousWeightPlaceholder`. Test results: E1+E7+E11 with `--repeat-each=10` → 30/30 (0 unexpected, 0 flaky); full auto-fill matrix 11/11; rest-timer 7/7; verdict 2/2; volume-target 6/7 first + retry passes (pre-existing unrelated flake). Typecheck/lint/unit clean. Routing to Regression Tester for independent verification.
- 2026-05-25 14:53 BRT — Regression Tester returned `pass`. **60/60 stability** across 2 independent dev-server boots; 11/11 full auto-fill matrix; 49/49 adjacent regression sweep across 11 spec files; 21/21 E11 PATCH-count assertion. Typecheck/lint/unit clean. Web export clean (38 routes). E2/E3 still pass with existing mitigation. HIGH conf / LOW risk. Pipeline complete. Finalizing.
