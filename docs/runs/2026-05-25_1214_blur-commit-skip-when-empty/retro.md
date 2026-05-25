# Retro — 2026-05-25_1214_blur-commit-skip-when-empty

## Outcome
- **Bug**: F7 follow-up architectural race — `<SetInput>.commit()` blur-emits `{weight: null, reps: null}` concurrently with the toggle handler's auto-fill `updateSet` when a user taps the check button on a focused-empty working set. PostgREST has no row-level ordering guarantee.
- **Pipeline result**: **shipped** (Path 3 split — Option A gate + new E11 + tightened `gotoLiveSession` helper; Race 1 E2/E3 typed-then-checked mitigation explicitly deferred).
- **Final commit**: pending (will be set on commit)

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | no (60/60 across 2 independent server boots) |
| Bugs found post-merge (7 days) | (backfill) |
| Human interventions during run | 2 (Fix Designer approval gate via AskUserQuestion; "continue" approval) |
| Implement ↔ Regression rounds | 1 (pass first try) |
| Diagnose redirects | 0 |
| Wall-clock duration | ~2h 39min (12:14 → 14:53 BRT) |
| Token cost | n/a |

## What worked
- **Reproducer's factual correction** was the load-bearing moment. The Conductor's pre-diagnosis claimed E1/E7 were the flake site; Reproducer traced the actual spec bodies and found those tests don't focus the TextInputs — so no blur, no commit, no race. Without that catch, the Implementer would have shipped Option A as a "fix" for a flake it couldn't reach.
- **Diagnostician identified two distinct races** under one symptom umbrella: Race 1 (architectural blur-PATCH, E2/E3) AND Race 2 (test-side `useLastWorkingSet` not resolved before click, E1/E7). Path 3 split fixed both correctly via different mechanisms (source gate + test-helper gate).
- **Regression Tester's independent dual-boot stability bar** caught no Implementer-vs-Tester divergence this time (unlike the F9 run). 60/60 across 2 boots is a much stronger signal than Implementer's 30/30 on a single boot.
- **Test selectors via `page.on('request')`** are now a documented in-repo pattern (precedent from `tests/e2e/exercise-note.spec.ts:310-318`). Worth adding to the playbook.

## What was friction
- **Conductor pre-diagnosis was wrong on which specs the gate fixes**. The brief conflated "the F7 race" with "E1/E7 flake" — these are distinct phenomena. Lesson: when consulting on a fix, verify the spec-coverage claim BEFORE writing the brief. Could have been avoided by spending 2 minutes reading the failing spec bodies first.
- **Fix Designer's predicate API discrepancy** (`parseFloat0` vs `kgFromInputString`) was caught and resolved by the Implementer, but ideally Designer would verify against source before pinning the predicate. Two `TODO: Implementer to verify` markers handed off cleanly.
- **`react-native-web`'s `Keyboard.dismiss()` is a no-op when nothing is focused** — Diagnostician flagged this as the reason the Conductor's hypothetical "focused-empty + check" race CAN fire (the Pressable tap doesn't unfocus the TextInput before the toggle handler runs). Worth a JSDoc anchor near the gate so future contributors don't strip it as defensive coding.

## Prompt / schema adjustments to fold back
- Conductor brief template for `/pipeline-fix` should require a "I verified the actual spec body of the failing test at file:line" claim BEFORE invoking Reproducer. Saves the factual-error round.
- Reproducer agent prompt already does "verify pre-diagnosis independently" — the agent did the right thing. Worth promoting this from soft norm to playbook-explicit bullet so future Conductors don't skip the verification dependency.
- Fix Designer template should require predicate verbatim to be code-checked against actual source before emitting (or flagged as `TODO`). Implementer handled both TODOs cleanly here; less friction if Designer pre-checks.

## Was the pipeline overhead worth it for this fix?
**Yes** — and the Conductor pre-diagnosis being wrong is the proof. A direct fix would have shipped Option A as written, the E1/E7 flake would have persisted (because it's Race 2 not Race 1), and the user would have re-reported the bug. The pipeline caught:
1. Two races, not one (Diagnostician).
2. Race 1's E1/E7 coverage was zero (Reproducer).
3. The right scope (Path 3) emerged from Diagnostician's analysis.

Direct-fix would have been wrong. Pipeline was load-bearing.

## Action items for the playbook
- [ ] **Race 1's E2/E3 typed-then-checked mitigation** is still in place (`await blur(); waitForTimeout(800)`). File a separate run when ready to architecturally fix that (per-row mutation queue OR merge patches in toggle handler).
- [ ] **Conductor brief verification step**: add a pre-pipeline-invocation checklist item: "verify failing spec body at file:line; confirm the proposed fix's predicate matches the actual code path the spec exercises".
- [ ] **`Keyboard.dismiss()` no-op behavior** when nothing is focused: worth a one-line note in `docs/data-model.md` or `docs/development.md` so future contributors understand why the gate is needed instead of relying on dismiss-then-await.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-25_1214_blur-commit-skip-when-empty/` on 2026-05-25.
