# Diagnosis — 2026-05-25_1214_blur-commit-skip-when-empty

## Hypothesis (state BEFORE searching)

Given the Conductor brief + Reproducer's static-trace correction, my pre-search guess was:

> "The Conductor brief mis-attributes E1/E7 flake to the blur-commit/auto-fill PATCH race. E1/E7 never focus an input, so `<SetInput>.commit()` never runs. The 33-50 % flake range comes from F7's E2/E3 measurement (typed-not-blurred). Option A as proposed only closes the focused-empty + check shape (Repro A), which has NO covering spec today. E1/E7's recent `:633` NaN failure in the soft-deleted-session-volume-leak regression report is a DIFFERENT race — most likely the `useLastWorkingSet` query has not resolved by the time Playwright fires its first click, so `previousSet` arrives at the handler as `null` and the auto-fill is skipped. Confidence (pre-search): MEDIUM on the previous-set-not-loaded hypothesis; HIGH on the scope-mismatch claim."

Investigated below.

## Evidence

### Source-of-truth files (verified by reading)

- `src/components/set-input.tsx:103-108` — `commit()` produces `onCommit({reps: parseInt0(reps), weight: kgFromInputString(weight, unit)})`. With both local strings empty, both helpers return `null`, so the emitted patch is `{reps: null, weight: null}`. Verified.
- `src/components/set-input.tsx:122-135` — leading check `<Pressable>` calls `onToggleChecked?.(!isChecked, { weight, reps })`. The press handler does NOT call `blur()` on the inputs itself.
- `src/components/set-input.tsx:148-149, 161-162` — `onBlur={commit}` and `onSubmitEditing={commit}` are the only commit entry points. No timer-based commit; no commit-on-mount.
- `node_modules/react-native-web/dist/cjs/modules/dismissKeyboard/index.js:16-18` — `dismissKeyboard()` calls `TextInputState.blurTextInput(TextInputState.currentlyFocusedField())`. With no focused TextInput, `currentlyFocusedField()` returns `null` and the call is a no-op. **Verified: in E1/E7 (no input ever focused), `Keyboard.dismiss()` inside the toggle handler does NOT fire a blur, so the parallel commit PATCH does NOT exist for those specs.** This corroborates the Reproducer's static trace.
- `app/(app)/workout/[sessionId].tsx:509-555` — toggle-checked handler. Order: (1) `Keyboard.dismiss()` (sync); (2) `await updateSet.mutateAsync({patch: <auto-fill>})` if `isWorking && patch != null`; (3) `restTimer.start(rest)`; (4) `await checkSetM.mutateAsync(id)`. Both mutations come from `useUpdateSet` + `useCheckSet` — DIFFERENT mutation instances → no in-flight queueing across them.
- `app/(app)/workout/[sessionId].tsx:464-469` — `onUpdateSet` shim: forwards any `{reps, weight}` patch to `updateSet.mutateAsync`. Forwards `{reps: null, weight: null}` verbatim.
- `src/api/sets.ts:113-138` — `updateSet`. Empty-payload short-circuit triggers ONLY when `Object.keys(payload).length === 0`. A `{reps: null, weight: null}` patch has two defined keys → falls through to PostgREST verbatim.
- `src/utils/auto-fill-set.ts:57-89` — `computeAutoFillPayload`. Returns `null` when `previous` is `null`/`undefined`/has no usable weight nor reps. **Critical: if `previousSet` arrives as `null`, the helper returns `null`, the handler skips `updateSet`, and the row's weight/reps stay null even on the check.**
- `src/components/exercise-block.tsx:114, 120-136` — `useLastWorkingSet(exercise.id)` is the cross-session placeholder source. `previousByRowId.get(s.id)` walks backward through in-session sets; falls back to `lastFromHistory.data ?? null`. **If the query hasn't resolved at click time, `lastFromHistory.data === undefined` and the fallback is `null`.**
- `src/components/exercise-block.tsx:246-262` — `previousByRowId.get(s.id) ?? null` is passed to `onToggleSetChecked` as `previousSet`. Confirms the in-flight query's `undefined` collapses to `null` at the handler entry.
- `src/hooks/use-sets.ts:135-143` — `useCheckSet.onSuccess` invalidates `KEYS.forSession(sessionId)`. The cache refetch is what flips the row's `completed_at` from `null` to a timestamp, which is what makes the `<SetInput>` re-render with `isChecked = true` and the `accessibilityLabel` flip from "Mark…" to "Unmark…". So when Playwright sees the "Unmark" label, the `checkSet` PATCH has settled, but **the auto-fill PATCH may have never fired**.
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts:228-240` — `getSet` reads via admin client, bypassing any client-side cache. So the test sees the canonical DB row.
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts:316, 669-672` — E1 and E7 click `getByLabel("Mark set as completed").first()` directly after `gotoLiveSession`. No input focus. No `weightInput.fill(…)`. No `weightInput.blur()`.
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts:259-274` — `gotoLiveSession` waits ONLY for the "Elapsed" header and the second exercise name to be visible. It does NOT wait for `useLastWorkingSet` to resolve.

### Candidate locations affected by the same root cause

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `src/components/set-input.tsx:103-108, 148-149, 161-162` | `commit()` on blur/submit | Emits `{reps: null, weight: null}` PATCH for a focused-empty input. This is the architectural race the brief targets (Repro A). Real but with NO covering spec. | major |
| `app/(app)/workout/[sessionId].tsx:464-469` | `onUpdateSet` thunk forwards null-only patches to `updateSet.mutateAsync` | The null-only PATCH would be cheap to suppress at this thunk too (mirror of the gate option). Optional. | minor |
| `src/api/sets.ts:113-138` | `updateSet` does not consider `{reps: null, weight: null}` as a no-op when the DB row already has both columns null | A server-side conditional update could close the race class without coordination, but `<SetInput>` doesn't carry the DB-row-null check today; this would require a new RPC or moving the check up to `useUpdateSet`. Out of scope per state.md decision. | minor |
| `src/components/exercise-block.tsx:114, 251, 258` | `previousByRowId` derived from `useLastWorkingSet.data` | Source of `previousSet = null` when the query hasn't resolved at click time — root cause of the E7 `:633` NaN flake in the soft-deleted-session-volume-leak regression-report. **Separate race from the brief's**. | major |
| `app/(app)/workout/[sessionId].tsx:494-555` | toggle handler reads `previousSet` from the React closure | Whatever value `previousByRowId.get(s.id)` had at the time `<ExerciseBlock>` last rendered. If the user clicks before `useLastWorkingSet` resolves, the closure carries `null`. | major (same root cause as above) |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts:259-274` | `gotoLiveSession` does not wait for placeholder text to render before allowing clicks | Test-side mitigation surface for the previous-set race. The placeholder text on the weight input (`"120"` when the prior session lands) is the visual proxy for `useLastWorkingSet.data` being ready. The current helper doesn't anchor on it. | major (test-side, related to the same race) |
| Existing E2/E3 mitigation: `await weightInput.blur(); await page.waitForTimeout(800);` (`tests/e2e/auto-fill-placeholder-on-check.spec.ts:381-382, 453-454`) | Sequences the blur PATCH before the check click | Masks the concurrent-PATCH race that Option A targets. Not removed by Option A (input strings are non-empty). Removing the mitigation requires a different fix (merge patches, await in-flight commit, or per-row mutation queue). | major (out of Option A's reach; tracked separately) |

### Cross-environment confirmation

The bug class has two distinct manifestations; each has a different environment shape.

1. **Repro A — focused-empty + check (the architectural race the brief targets).**
   - On web (react-native-web): `Keyboard.dismiss()` synchronously fires `onBlur` on the focused TextInput (verified via `dismissKeyboard` reading `TextInputState.currentlyFocusedField()` and calling `blurTextInput` on it). So the commit PATCH `{reps: null, weight: null}` fires inside the same micro-task tick as the handler — before the awaited `updateSet.mutateAsync` for the auto-fill — and the two `fetch` calls land on PostgREST with no ordering guarantee.
   - On iOS/Android: `Keyboard.dismiss()` posts `blurTextInput` via the native bridge asynchronously (F7 retro `final-summary.md:30` documents this from the v2 BLK-1 evidence). The blur arrives back later, so the auto-fill PATCH typically lands first and the commit PATCH clobbers it. Same race class, different timing distribution.
   - Same class on every platform; only the distribution shifts. **HIGH confidence** the gate at `<SetInput>.commit()` closes both because it suppresses the emit before any platform-specific timing matters.
2. **Repro for E7 `:633` NaN — `useLastWorkingSet` not resolved at click time.**
   - On web (Playwright runner): `gotoLiveSession` waits for "Elapsed" + second exercise name to be visible — both render from the session/routine queries, NOT from `useLastWorkingSet`. The cross-session query is independent and Playwright can fire the first click before it resolves. **Per the soft-deleted-session-volume-leak regression-report (line 107, 119), this reproduces at baseline `bde34d7` — i.e. it predates and is independent of this fix's branch.**
   - On real-user usage (web/native): typically the user perceives the placeholder text "120" appearing before tapping check; the query resolves long before any human interaction. Not a real-user-facing bug — a test-determinism bug.
   - **HIGH confidence** this is a test-side flake, not a production race. **Distinct root cause** from the brief's race. The state.md framing ("33-50 % flake on E1/E7 in `auto-fill-placeholder-on-check.spec.ts`") conflates the two — the 33-50 % range is F7's E2/E3 measurement of the architectural concurrent-PATCH race; E7's `:633` NaN is the previous-set-not-loaded race.

## Root cause

There are **two distinct root causes** observed under one symptom umbrella ("auto-fill PATCH race on check"). The Conductor brief, the F7 retro, and the soft-deleted-session-volume-leak regression-report each surface a different one:

1. **Concurrent-PATCH race on the same row (the architectural race Option A targets).** When `<SetInput>.commit()` fires (because of a blur on a focused TextInput) while the toggle handler issues an auto-fill `updateSet.mutateAsync`, two PATCHes are dispatched on different mutation instances against the same `id`. PostgREST has no ordering guarantee for concurrent UPDATEs on a row, so the no-op `{reps: null, weight: null}` write can land after the auto-fill `{weight: "120.00", reps: 8}` write, clobbering both fields. This race is real, platform-independent in class, and has no covering spec in the current `auto-fill-placeholder-on-check.spec.ts`. The brief's Option A — gate `commit()` on `(both local strings empty) AND (row.weight === null && row.reps === null)` — closes this race by suppressing the no-op write at its source. **However, Option A only fires for the "focused-empty" shape**, not for E2/E3 ("focused-typed-then-checked"), where local strings are non-empty.

2. **`useLastWorkingSet` query not resolved at click time (the test-side race in the regression report).** `gotoLiveSession` does not wait for `useLastWorkingSet` to resolve before allowing the first `Mark` click. If Playwright fires the click before the cross-session placeholder query lands, the handler receives `previousSet = null` (because `previousByRowId.get(s.id) ?? null` collapses an `undefined` query result), `computeAutoFillPayload` returns `null`, auto-fill is skipped, and the row's weight/reps stay null after the check. The DB row reads `{weight: null, reps: null, completed_at: <date>}`, the test does `parseFloat(row.weight as string)` → `NaN` → assertion fails. This is **separate from race 1** and **not addressed by Option A**.

The F7 retro at `final-summary.md:59-60` flagged the concurrent-PATCH race (race 1) as the "known open issue". The soft-deleted-session-volume-leak regression-report at `regression-report.md:107, 119` flagged the previous-set-not-loaded race (race 2) under the same spec — but for a non-input-focused test (E7), which can only fire race 2. The conflation in the state.md brief comes from treating both under "flake on E1/E7" without separating the mechanisms.

**Symptom-only vs root-cause clarity:**

- Option A is a **partial root-cause fix for race 1** (closes the architectural shape it targets). It does NOT touch race 2 at all.
- Race 2 needs a separate fix: either (a) make the test wait for the placeholder text to render before the first click (test-side, low risk), or (b) make `<ExerciseBlock>` not call `onToggleSetChecked` until `useLastWorkingSet` has resolved (source-side, higher risk — couples toggle availability to a cross-exercise query). The test-side mitigation is the lower-risk option.

## Severity classification

- **Blocker** — must fix; user-facing or data-affecting.
  - None. Both races are pre-existing, neither has been observed clobbering user data in production usage (race 2 is a test-determinism issue; race 1 has not been reproduced outside of synthetic `--repeat-each` stress runs and the F7 retro acknowledged it as an open issue, not a known data-loss event).

- **Major** — should fix in this run; significant risk if left.
  - `src/components/set-input.tsx:103-108` — `commit()` emits `{reps: null, weight: null}` when both inputs are empty. This is the no-op PATCH the brief's Option A targets. Gating it (skip when local-empty AND row-null) closes the architectural race 1 for the focused-empty shape. The accepted trade-off (typed-then-erased-then-checked auto-fills instead of clearing) is already documented in `state.md:7`.
  - `tests/e2e/auto-fill-placeholder-on-check.spec.ts` — needs a NEW e2e spec covering Repro A (focused-empty + check) to pin Option A's effect. Without it, the gate is unverifiable end-to-end. The existing E1/E7 do NOT cover Repro A (no input focus).
  - `tests/e2e/auto-fill-placeholder-on-check.spec.ts:259-274` (`gotoLiveSession`) — should wait for the placeholder text ("120") to render on the weight input before allowing the first click. Closes race 2 for ALL specs in this file (E1, E7, plus any future placeholder-dependent spec). One-line addition, test-only. Optional within this run but the cheapest possible mitigation for the flake the regression-report flagged.

- **Minor (out of scope by default)** — note for follow-up; not addressed in this run.
  - E2/E3 concurrent-PATCH race 1 mitigation removal: requires a different source-level fix (merge patches into a single PATCH, await in-flight commit before auto-fill, or per-row mutation queue). Out of Option A's reach. Worth a separate run. Belongs as a follow-up ticket per Reproducer's Open Question #5 (b).
  - `src/api/sets.ts:113-138` server-side conditional-update path: would close the race class on the server but requires a contract change. Not in scope.
  - `app/(app)/workout/[sessionId].tsx:464-469` could also gate the null-only patch at the thunk layer, but the `<SetInput>.commit()` gate is closer to the source (no PATCH dispatched at all) and matches the brief's Option A intent.

## Recommended path forward

Given the evidence, **Path 3 (split)** from the brief is the right call, with a slight refinement: **add the cheap test-side fix for race 2 to this run too**, because it's a one-line tightening of `gotoLiveSession` (or each test's pre-click) and it's responsible for the spec's recent E7 `:633` NaN flake that's currently masquerading as "the bug Option A fixes". Leaving it untouched would let Option A ship with the same flake still on the spec, blurring whether Option A "fixed it".

Concretely:

1. **This run (Path 1 + race-2 test fix)**:
   - Ship Option A: gate `<SetInput>.commit()` on `(local strings both empty) AND (row.weight === null && row.reps === null)`.
   - Add a NEW e2e spec exercising Repro A (focus-empty-input + tap check) with `--repeat-each` stress to pin the gate's effect.
   - **Tighten `gotoLiveSession`** (or the relevant tests) to wait for the placeholder text on the weight input before allowing the first click. This closes race 2 for E1/E7 deterministically.
   - Do NOT touch E2/E3's `await weightInput.blur(); waitForTimeout(800)` mitigation — that masks race 1's concurrent-PATCH shape and removing it requires a different source-level fix.

2. **Separate follow-up run (Path 2)**: address race 1's concurrent-PATCH shape for the typed-then-checked case (E2/E3) via merge-patches or per-row mutation queue. Larger surface, separate test discipline, separate review.

This split keeps Option A focused, makes its effect testable, and removes the test-side flake the regression-report flagged — without expanding scope into the harder architectural race.

## Symptom-only fix risk

- **Option A as designed is a partial root-cause fix.** It closes race 1 for the focused-empty + check shape (the only shape where `commit()` emits a no-op PATCH). It does NOT close race 1 for the focused-typed-then-checked shape (where `commit()` emits a real PATCH that still races the auto-fill). Calling Option A a "symptom fix" would be wrong — it's a real root-cause fix for one race shape. Calling it "the fix" would also be wrong — race 1's typed-then-checked shape and race 2 are both untouched. Surface this distinction to Fix Designer + the human in the fix plan.
- **The proposed `gotoLiveSession` tightening for race 2 is a test-side fix, not a source-side fix.** Race 2 is a test-side race (the test doesn't wait long enough); the application code is correct (it's reasonable for the toggle handler to receive a null `previousSet` and skip auto-fill if there's no prior session info). So the right place for the fix is the test setup. No source-side suppression makes sense here. **Document this so the next reader doesn't think the source was patched to mask a real-user bug.**

## Confidence and risk

- **Confidence**: HIGH on the dual-root-cause framing — both races have direct source evidence (`set-input.tsx:103-108`, `[sessionId].tsx:509-555`, `dismissKeyboard/index.js:16-18`, `exercise-block.tsx:114-136`, `auto-fill-set.ts:57-89`). HIGH on the conclusion that Option A only covers race 1's focused-empty shape. HIGH on the conclusion that E7's `:633` NaN is race 2, not race 1 (the test never focuses any input → race 1 is mechanically impossible there).
- **Risk** (of recommending Path 3 split + race-2 test fix): LOW. Source change is the same 5-LOC gate already in the brief. Test changes are additive (one new spec, one waitFor anchor). No existing spec asserts on the buggy behavior. Reversible.

## Recommendation

`invoke Fix Designer` with the Path 3 (split) framing: ship Option A + new e2e for Repro A + `gotoLiveSession` tightening for race 2; defer E2/E3 concurrent-PATCH-race-1 mitigation removal to a separate run.
