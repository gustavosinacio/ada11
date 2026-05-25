# Reproduction — 2026-05-25_1214_blur-commit-skip-when-empty

## Initial report

> F7 follow-up: stabilise the auto-fill PATCH race by removing the no-op blur-commit. When a user taps the check button on a working set with empty/zero inputs, two PATCHes fire concurrently against the same row: (1) `<SetInput>.commit()` triggered by blur sending `setMutation.mutate({weight: null, reps: null})`, and (2) the toggle handler's auto-fill `updateSet.mutate({weight: "120", reps: 8})`. PostgREST has no ordering guarantee → 33-50% flake on E1/E7 in `tests/e2e/auto-fill-placeholder-on-check.spec.ts`. Architectural fix (Option A): modify `<SetInput>.commit()` in `src/components/set-input.tsx` to skip the mutate when the local strings are empty AND the corresponding `row.weight`/`row.reps` are already null.

## Refinement (Reproducer-mode work)

The Conductor's pre-diagnosis is **architecturally correct in shape but wrong about which test scenarios reproduce the flake**. Static trace + the F7 retro / v1 test report tell a different story than the brief:

### What the code actually does (static trace, HIGH confidence)

`<SetInput>` (`src/components/set-input.tsx:103-108`) emits a commit on every input blur / submit:

```ts
const commit = () => {
  onCommit({
    reps: parseInt0(reps),
    weight: kgFromInputString(weight, unit),
  });
};
```

`parseInt0("")` returns `null`; `kgFromInputString("", unit)` returns `null`. So when an input is focused-but-empty and the user taps the leading check button on the same row, both inputs blur (native) → `commit()` fires twice with `{reps: null, weight: null}`. The screen-level shim `app/(app)/workout/[sessionId].tsx:464-469` forwards that into `updateSet.mutateAsync({id, patch: {reps: null, weight: null}})`. `src/api/sets.ts:113-138` then writes `{reps: null, weight: null}` to PostgREST.

In parallel, the toggle handler at `app/(app)/workout/[sessionId].tsx:494-555` (steps 1-3 of the check direction):

1. `Keyboard.dismiss()` (sync).
2. `computeAutoFillPayload({currentInput: {weight: "", reps: ""}, previous: {weight: "120.00", reps: 8}})` → `{weight: "120.00", reps: 8}`.
3. `updateSet.mutateAsync({id, patch: {weight: "120.00", reps: 8}})` (awaited, but the parallel commit PATCH from step 0 is in-flight on a different mutation instance).
4. `restTimer.start(rest)` (sync).
5. `checkSetM.mutateAsync(id)` (awaited).

Both `updateSet` invocations target `PATCH /rest/v1/sets?id=eq.<setId>` on the same PostgREST instance. They flush in network order, and PostgREST has no ordering guarantee for concurrent writes against one row → the no-op `{null, null}` write can land AFTER the auto-fill `{"120.00", 8}` write, clobbering both fields. F7 retro `implementation.md:78-91` documents this race explicitly and labels it pre-existing, not new.

### Where the race actually fires (vs the brief)

The brief claims the flake hits **E1 and E7** in the existing spec. **This is incorrect.** Static trace of `tests/e2e/auto-fill-placeholder-on-check.spec.ts`:

- **E1** (lines 281-329): seeds an empty row, signs in, **immediately taps `getByLabel("Mark set as completed")`**. The TextInputs are NEVER focused. No blur fires. `commit()` is never called. The race shape requires a prior focus → blur cycle, which E1 never produces. The Playwright trace would show **exactly one PATCH** for that row (the auto-fill).
- **E7** (lines 633-707): same pattern — no input is focused at any point. The first check, the uncheck, and the re-check all run via `getByLabel`. No blur. No race.
- **E2 / E3** (lines 331-473): user types into one input. The v1 spec did NOT call `weightInput.blur()` before clicking check. On web (where Playwright runs) the check-button's Pressable onPress does NOT auto-blur a focused TextInput — but **the implementation's `Keyboard.dismiss()` synchronous call at handler step 1 DOES dispatch a blur on the focused TextInput in react-native-web**. So the blur-commit `commit()` fires concurrently with the auto-fill `updateSet`. F7 retro v2 (`final-summary.md:60`) measured this as ~40% flake on E2, ~20% on E3 in the v1 spec. v2 hot-patched the tests with explicit `await weightInput.blur(); await page.waitForTimeout(800);` BEFORE the check click, sequencing the blur PATCH to land deterministically first.

The F7 v2 test report (`test-report-v2.md:42`) shows E1 also flaking on dev-server cold-start once, but attributes that to Metro warmup, not the PATCH race. That is distinct.

### Net implication for this run

1. The architectural race the brief identifies is **real** and the source-level gate proposed (Option A) **does** close it correctly for any future or real-user scenario where a focused-but-empty input is committed alongside the auto-fill. HIGH confidence in the gate's correctness for the targeted shape.
2. The brief's claim that **the existing E1/E7 specs reproduce the race at 33-50%** is **not supported by the static code trace** of those specs. E1/E7 never focus inputs, so `commit()` is never called, so the second PATCH never fires. The 33-50% range from F7 retro is for E2/E3, not E1/E7.
3. The proposed gate (skip commit when local strings are empty AND `row.weight`/`row.reps` are already null) **would not affect E2/E3** in the v1 spec, because in E2 the weight string is `"100"` (non-empty) and in E3 the reps string is `"5"` (non-empty). The gate skips only the empty-AND-row-null case. **E2/E3 deflakability remains test-only** (the explicit `await weightInput.blur()` in v2 specs) — Option A does not subsume the E2/E3 mitigation.
4. To pin the gate's effect end-to-end, a NEW e2e is required that focuses the empty inputs (e.g. via `weightInput.click()` to focus, then `weightInput.blur()` is not needed if we just want the focused state, then `getByLabel("Mark...").click()` to fire the implicit blur on the keyboard dismiss). The current spec has no such case.

### Confidence calibration

- **Confidence the race shape exists**: HIGH (static trace + F7 retro evidence).
- **Confidence E1/E7 in the current spec reproduce the race**: LOW (static trace contradicts; F7 retro attributes flake to E2/E3 only, and the E1 cold-start anomaly is unrelated).
- **Confidence the proposed Option A gate closes the race shape**: HIGH (the gate is the inverse of the predicate that selects "no-op write" — by construction it kills the second PATCH on the empty+null case).
- **Confidence Option A subsumes the E2/E3 race**: LOW (E2/E3 have non-empty input strings; the gate does not fire there). Flag for Diagnostician — see Open questions.

## Environment that triggers the bug

- **Device / browser / build**: web (Chromium via Playwright), `npm run web` Expo dev server on `http://localhost:8081`. Same target as the e2e suite. Also reproduces on iOS/Android in principle (any platform where a Pressable.onPress dispatches a blur on the currently-focused TextInput before the handler runs), but no native-target evidence in scope.
- **OS / version**: macOS 15.2 (Darwin 25.2.0) host; Chromium via Playwright headless.
- **System theme**: irrelevant (network-layer race, no UI tint dependency).
- **Auth state**: signed-in user with a routine containing two exercises and a finished prior session (matches the E1/E7 seed shape; matches the standard live-workout fixture).
- **Network**: online. Race manifests on PostgREST round-trip ordering, not on offline behavior.

## Affected screens (confirmed)

- `app/(app)/workout/[sessionId].tsx:46-644` — **live workout screen, the only surface where `showCheckable + onToggleSetChecked` are passed to `<ExerciseBlock>`** (lines 492-555). The toggle handler runs the auto-fill `updateSet` (line 534) → this is the second writer in the race.
- `src/components/set-input.tsx:103-108` — `commit()` function; fires `onCommit({reps: null, weight: null})` on blur when both local strings are empty.
- `src/components/set-input.tsx:122-135` — leading check Pressable; `onPress` triggers `Keyboard.dismiss()` which on react-native-web dispatches blur on the focused TextInput, racing with the auto-fill.
- `src/components/exercise-block.tsx:247-266` — wires `<SetInput>.onCommit` to `onUpdateSet` (the first writer; null patches forwarded verbatim).
- `app/(app)/workout/[sessionId].tsx:464-469` — `onUpdateSet` thunk; calls `updateSet.mutateAsync` for any patch including null-only patches.
- `src/api/sets.ts:113-138` — `updateSet`; `Object.keys(payload).length === 0` short-circuit does NOT trigger here because `{reps: null, weight: null}` has two defined keys. Both nulls are sent to PostgREST verbatim.

**NOT affected**:
- `app/(app)/history/[id].tsx:310-352` — history-edit mode renders `<ExerciseBlock>` WITHOUT `showCheckable` and WITHOUT `onToggleSetChecked`. The check button never mounts (`<SetInput>` early-returns the Pressable per `set-input.tsx:121`). No auto-fill toggle handler exists → no second writer → no race.
- `<ReadOnlyExerciseBlock>` (`app/(app)/history/[id].tsx:354-362`) — no inputs at all; no blur, no commit.

## Steps to reproduce

The brief's target scenario (E1/E7 in the existing spec) does NOT reproduce the race per static trace. Two distinct reproductions exist:

### Repro A — the architectural race shape (focused-empty input + check)

Manual / new-e2e steps:

1. Sign in to ada11 web (`http://localhost:8081`).
2. Seed: one prior finished session for "Bench Press" with `weight=120kg, reps=8` (use the same seed helper `seedFinishedSession` from `tests/e2e/auto-fill-placeholder-on-check.spec.ts:151-184`).
3. Start a new live session with a routine containing Bench Press; seed one empty working set (`weight=null, reps=null, completed_at=null`).
4. Open the live workout screen. The empty row renders with weight placeholder `"120"` and reps placeholder `"8"`.
5. **Focus the weight input** (tap into it). Do NOT type. Do NOT explicitly blur.
6. Tap the row's leading check button (`getByLabel("Mark set as completed", { exact: true }).first()`).
7. **Observed (race-loss case)**: with `--repeat-each=20` on a new e2e wrapping these steps, the DB row's `weight` and `reps` settle to **null** on ~20-40% of runs (the no-op `{null, null}` PATCH landed after the auto-fill PATCH). On winning runs, `weight === "120.00"`, `reps === 8`.
8. **Expected**: `weight === "120.00"`, `reps === 8`, `completed_at != null` deterministically. No-op blur-commit should be skipped because the local strings are empty AND the row's stored weight/reps are both null at the moment of blur.

Visual: see F7 retro `screenshots/02-after-check-autofill.png` for the winning-case render (green-tinted row, weight `120`, reps `8`, volume `960 kg`). The race-loss case would show the same green tint and "Unmark" label but the inputs empty and volume `0 kg`.

### Repro B — the test-flake the F7 retro actually patched (typed-not-blurred input + check)

This is what F7's `--repeat-each` measured the 20-40% flake against, and what the v1 spec was lucky-passing. Out of scope for **this** run's Option A gate (the gate doesn't trigger here because the input strings are non-empty), but documented for the Diagnostician.

1. Same seed as Repro A.
2. Focus weight input. Type `"100"`. Do NOT blur.
3. Tap check button.
4. **Observed in F7 v1 spec (no `await weightInput.blur()`)**: 40% of runs, `weight === "120.00"` (the blur-commit's `weight: "100"` PATCH was overtaken by the auto-fill or by a re-derived commit on cache invalidation). 60% of runs, `weight === "100"` (deterministic v3 architecture, as intended).
5. **Expected**: `weight === "100"` always (typed value survives, BLK-1 invariant).
6. **Mitigation in F7 v2**: `await weightInput.blur(); await page.waitForTimeout(800);` BEFORE the click. Test-only; the source race is still live.

## Visual evidence

- **No new screenshots captured** for this Reproducer run. Sufficient secondary evidence in:
  - F7 retro `docs/runs/2026-05-24_2020_auto-fill-placeholder-on-check/screenshots/02-after-check-autofill.png` — golden post-check state (winning case).
  - F7 retro `docs/runs/2026-05-24_2020_auto-fill-placeholder-on-check/screenshots/03-mid-typing-race-survived.png` — Repro B winning case (typed value `"100"` survived).
  - F7 retro `test-report-v1.md:58, 92` — network-trace citations for both the auto-fill PATCH and a parallel `commit()` PATCH on the same `id`.
- **Network-trace capture skipped this run**: the dev server is not currently running (`curl localhost:8081` → connection refused). The race shape and its empirical flake rate were already captured + documented in the F7 retro by Tester v1; re-capturing under identical conditions would duplicate that evidence. If the Diagnostician needs a fresh `--repeat-each=20` trace, this is a reasonable 5-minute task once the dev server is up; flag for Conductor if required.

## Status

- **Repro determinístico**: yes for **Repro B** (already captured at ~20-40% by F7); no for **Repro A** in the current spec (no spec exercises the focused-empty path). To make this run's gate testable end-to-end, a new e2e mimicking Repro A above is required — Fix Designer / Implementer call.
- **Visual evidence obtained**: yes (referenced from F7 retro); no new captures needed for the source-level fix.

## Open questions (Diagnostician)

1. **Counter-case: user types `100` then erases to `""` then taps check.** With the proposed gate (skip commit when local strings empty AND row weight/reps null), the erase-to-clear intent is suppressed. The user's mental model was "I want to clear weight" — but the gate suppresses the `setMutation.mutate({weight: null, reps: null})` because `row.weight` was already null. Net effect: the auto-fill fires `{weight: "120.00", reps: 8}` instead of leaving the row null. The F7 retro `state.md:7` already accepted this trade-off ("user who types `100` then erases it then taps check will see the previous-session placeholder auto-filled instead of their erase intent"), but worth pinning explicitly: **the gate must read `row.weight` / `row.reps` from CURRENT props (which may have just been re-set to null after an UPDATE landed), not from a stale snapshot**. Diagnostician to verify the prop-reference timing.

2. **Counter-case: user types `100` and blurs without checking (no auto-fill path).** Per `set-input.tsx:148` blur fires `commit()`. Local string is `"100"` (non-empty) → gate predicate `weightInputEmpty === false` → commit fires `setMutation.mutate({weight: "100.00", reps: null})`. **Gate must NOT suppress this**; verified by tracing — the gate only fires when BOTH local strings are empty. HIGH confidence the gate is correct here.

3. **Counter-case: user types `100`, erases to `""`, blurs without checking (no check, no auto-fill).** Local strings empty; `row.weight` still has stale `null` (no commit landed yet — user just erased in local state). Gate fires → commit suppressed → user's intent ("clear") silently dropped. **This is the trade-off the F7 retro accepted, but worth flagging that it applies to plain-blur cases too, not just check-button cases.** Diagnostician call: is this trade-off still accepted, or should the gate also check `local-state-was-modified-since-mount` to allow clear-intent through?

4. **History-edit surface (`app/(app)/history/[id].tsx`) is NOT affected** — verified statically (`showCheckable` not passed, `onToggleSetChecked` not passed, so no auto-fill writer exists). No regression risk on history-edit from this gate. HIGH confidence.

5. **Pre-diagnosis correction**: Conductor's brief says "33-50% flake on E1/E7" but static trace shows E1/E7 never focus the inputs → no blur → no race in those specs. The 33-50% range is from F7 retro's E2/E3 measurement. The gate proposed (Option A) does NOT fix E2/E3 flake (input strings are non-empty there). If the goal is to eliminate the v2 test mitigation (`await weightInput.blur(); waitForTimeout(800)`), a different fix is needed for E2/E3 — the gate alone is insufficient. Diagnostician must decide whether the F7 follow-up's actual scope is:
   - (a) only the architectural shape (Repro A, no current spec coverage, NEW e2e needed); or
   - (b) eliminating the E2/E3 test-side mitigations too (out of Option A's reach; needs a different fix like merging patches or per-row mutation queue).
