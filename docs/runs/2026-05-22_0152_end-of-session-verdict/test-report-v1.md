# Test report v1 — 2026-05-22_0152_end-of-session-verdict

Testing: implementation against `design-v2.md` (final approved) and `review-v1.md` (pass with 5 polish minors).

## Environment

- Commands used to run app: web dev server already running at `http://localhost:8081` (`curl -s http://localhost:8081` → `200`).
- Browser / device: Playwright headless Chromium (Playwright `^1.59.1`).
- Test data: fresh confirmed users via admin client per spec; `deleteUserSafe` in `finally` to keep DB clean.
- Baseline commit: `5267443505a471dd984e5fe4f43adba6be1bcb77` (per `state.md`).

## Golden path

**Spec** (from design-v2.md §Test plan, Case A): after the user logs a working set whose volume beats their lifetime per-exercise best in the just-finished session, the Finish flow routes to `/(app)/workout/verdict/<sessionId>`, the headline reads `+N PRs · Y kg · Zh Wm`, the PR row shows the exercise with `+overflow kg (was priorMax kg)`, and Done returns to `/workout`.

**Steps run** — `end-of-session-verdict.spec.ts:189` Case A:

1. Created confirmed user via admin API.
2. Seeded prior finished session with single set 100 kg × 5 = 500 kg for the seed exercise (3 days ago).
3. Started live session, logged 100 kg × 6 = 600 kg current bench, **left unchecked** (forces bulk-check-all branch).
4. Registered `page.on("dialog", d => d.accept())` BEFORE the Finish click (MIN-2).
5. Tapped Finish → ChooseActionModal opened (unchecked > 0).
6. Selected `"Check all and finish"` → `handleCheckAllAndFinish` path (`[sessionId].tsx:257-267`).
7. Waited for `/workout/verdict/<id>`.
8. Asserted `+1 PRs` headline.
9. **Asserted `600 kg` in headline** — load-bearing MAJ-2 regression guard. Pre-fix this would render `0 kg` (stale sets cache with `completed_at = null` filtered out by `sumLiveVolume`).
10. Asserted PR row visible: exercise name + `+100 kg` + `(was 500 kg)`.
11. Tapped Done → waited for `/workout$`.

**Result**: **pass**

**Evidence**:

```
> playwright test tests/e2e/end-of-session-verdict.spec.ts
Running 2 tests using 1 worker
  ✓  1 tests/e2e/end-of-session-verdict.spec.ts:189:7 › End-of-session verdict screen › Case A: finish-with-PR via bulk-check-all (MAJ-2 regression guard) (13.7s)
  ✓  2 tests/e2e/end-of-session-verdict.spec.ts:280:7 › End-of-session verdict screen › Case B: finish-with-no-sets (zero-volume empty-state copy) (6.5s)
  2 passed (21.0s)
```

## Edge cases

### Edge 1: Empty-set Finish (no sets logged at all)

**Spec** (design-v2 §Test plan Case B): empty session Finish renders `0 PRs · 0 kg`, the zero-volume empty-state copy `"No sets logged — your next session counts."`, no PR pill, Done returns to `/workout`.

**Steps** — `end-of-session-verdict.spec.ts:280` Case B:

1. Created confirmed user (no prior sessions seeded).
2. Started live session (zero sets).
3. Registered `page.on("dialog", d => d.accept())` BEFORE Finish (MIN-2). Zero unchecked sets → `confirmDelete` `window.confirm` path.
4. Tapped Finish.
5. Waited for `/workout/verdict/<id>`.
6. Asserted headline `0 PRs` (NOT `+0 PRs` — bare zero), `0 kg`.
7. Asserted `"No sets logged — your next session counts."` visible AND `"Solid session — keep it consistent."` NOT visible.
8. Asserted no `PR` pill in DOM.
9. Tapped Done → `/workout$`.

**Expected**: pass per design-v2 MIN-4 copy split.
**Actual**: passed in 6.5s.
**Result**: **pass**

**Evidence**: see Case B in golden-path output above.

### Edge 2: First-ever lift NOT counted as PR (priorMax guard)

**Spec** (design-v2 §Contratos de I/O step 3): a `SessionPr` is emitted only when `currentKg > priorMaxKg && priorMaxKg > 0`. An exercise with no prior sessions cannot PR on its first appearance.

**Steps** — unit `tests/unit/session-verdict-math.test.ts:195` case (#11): current ex-1 = 500 kg, no prior session rows → expect `[]`.

**Expected**: `computePrsForSession` returns `[]`.
**Actual**: returns `[]` (test passes).
**Result**: **pass**

**Evidence**:

```
> vitest run tests/unit/session-verdict-math.test.ts
✓ tests/unit/session-verdict-math.test.ts (21 tests) 12ms
Test Files  1 passed (1)
     Tests  21 passed (21)
```

Case (#11) literal source:

```ts
it("(#11) current has ex-1=500, no prior sessions → [] (priorMax guard)", () => {
  const out = computePrsForSession({
    rows: [],
    currentSessionId: "sess-current",
    currentSessionVolumeByExercise: new Map([["ex-1", 500]]),
  });
  expect(out).toEqual([]);
});
```

### Edge 3: Strict-`>` tie is NOT a PR

**Spec** (design-v2 §Contratos de I/O step 3): tie (`current == priorMax`) is NOT a PR — strict greater-than. The user called this case out as `#14` in the request; in the test file it lives at `#13`. (The user's `#14` reference appears to be an off-by-one; #13 is the strict-tie case, #14 is the multi-prior `priorMax = max(s0, s1)` case. Both are present and correct.)

**Steps** — unit case (#13): current ex-1 = 500 kg, prior session = 500 kg → expect `[]`.

**Expected**: `computePrsForSession` returns `[]` (tie is not a PR).
**Actual**: returns `[]`.
**Result**: **pass**

**Evidence**:

```ts
it("(#13) strict-`>`: current ex-1=500, prior=500 → [] (tie is NOT a PR)", () => {
  // ...
  expect(out).toEqual([]);
});
```

### Edge 4: `sumLiveVolume` reuse faithfulness (MIN-1)

**Spec** (design-v2 §Test plan unit additions): `computeCurrentSessionVolumeByExercise` reduces per-(exercise_id) sum via the now-exported `sumLiveVolume` kernel. Case (#21) verifies that for each exercise the helper's value equals `sumLiveVolume` restricted to that exercise's rows. Locks the warmup-skip / `completed_at != null` / `weight > 0` / `reps > 0` predicate to a single source.

**Steps** — unit case (#21).

**Expected**: per-(exercise_id) sums match `sumLiveVolume` of the filtered subset.
**Actual**: equal.
**Result**: **pass**

**Evidence**: passes within the 21-test suite (see Edge 2 evidence block).

### Edge 5: Cancel flow does NOT route through verdict

**Spec** (review-v1 §Verification of implementation.md claims line `:284`): the Cancel button at `[sessionId].tsx:284` `router.replace("/(app)/workout")` directly — bypasses the verdict.

**Steps** — static evidence via `Read` of `app/(app)/workout/[sessionId].tsx:270-293`:

- Line 284: `router.replace("/(app)/workout")` — direct route, no verdict insertion.
- The Cancel handler is independent of `finishAfterMutation` (which is the only path that routes to verdict).

**Expected**: cancel does not enter verdict.
**Actual**: confirmed by code path inspection AND by the fact that no existing cancel-path e2e regressed (all unrelated suites still pass).
**Result**: **pass** (verified via path inspection; no e2e exercises the cancel flow today, which is consistent with `Out of scope` in design-v2).

## Regression check

### crud.spec.ts — workout: start ad-hoc, finish, see in history (line 162)

This test was patched by the Implementer (`tests/e2e/crud.spec.ts:188-199`) to wait for `/workout/verdict/`, assert `0 PRs` headline, tap Done, then assert `/workout$`. It exercises the post-Finish flow through the verdict insertion point.

**Result**: **pass** (7.2s).

```
✓  3 tests/e2e/crud.spec.ts:162:7 › Ada11 CRUD flows (web) › workout: start ad-hoc, finish, see in history (7.2s)
```

### crud.spec.ts — other tests in the suite

```
✓  1 routines: create, see in list, open detail, delete (6.7s)
✘  2 exercises: create custom exercise (alongside seeded library) (1.0m) — PRE-EXISTING, see below
✓  3 workout: start ad-hoc, finish, see in history (7.2s)
✓  4 history: edit started_at backward by 1h, duration updates (5.6s)
✓  5 history: edit started_at across ISO-week boundary — list moves, strip stays (6.7s)
✓  6 profile: weight unit toggle to lbs persists across reload (3.5s)
5 passed, 1 failed
```

**Failed test investigation — `exercises: create custom exercise` (crud.spec.ts:131)**:

This test is NOT a regression introduced by the verdict work. Verified by:

1. **Code path independence**: the verdict run touches `[sessionId].tsx`, `use-sets.ts`, `volume-target.ts`, `crud.spec.ts:188-199` only. The failing test exercises `/exercises/new` form — completely separate code surface.

2. **Reproduced on baseline**: stashed all verdict code/test changes (`git stash push -u`) and re-ran the test alone on a clean baseline. **Still failed** at the same line (`crud.spec.ts:150`):

   ```
   Error: locator.fill: Test timeout of 60000ms exceeded.
     - waiting for getByPlaceholder('e.g. Chest')
     150 |       await page.getByPlaceholder("e.g. Chest").fill("Biceps");
   ```

3. **Likely root cause**: this test was added in the immediately prior commit `b51dd01` (`feat: exercises track muscles as required multi-select array`). The placeholder `"e.g. Chest"` appears to no longer exist on the new-exercise form (the muscle field changed from a single text input to a multi-select array per that commit's message). The test selector is out of sync with the UI.

4. **Stash restored**: `git stash pop` after baseline check; all verdict changes intact (`git status` re-verified).

**Conclusion**: pre-existing flake/bug on `main`, NOT caused by this run. Recommend a separate bug-fix pipeline run targets it; out of scope here.

### progress-page.spec.ts (Progress page, just shipped)

**Why this matters**: the verdict screen navigates to `/(app)/exercises/{id}/progress` on PR-row tap; the Progress tab + per-exercise progress page share routing surface. Need to confirm verdict insertion doesn't regress it.

```
✓  1 1. tab visibility — Progress tab renders on the bottom bar (3.1s)
✓  2 2. empty user — day-zero empty states render without crashing (4.2s)
✓  3 3. populated user mid-week — hero, bars, list, streak all render (5.7s)
✓  4 4. per-row navigation — tapping a list row routes to /(app)/exercises/{id}/progress (6.3s)
✓  5 5. empty current ISO week with prior history — list shows empty copy, hero/bars still render (5.8s)
✓  6 6. PR badge — a row that beats its lifetime best this week renders the PR pill (6.4s)
✓  7 7. 5-tab regression — History, Progress, Profile labels coexist on the bar (2.3s)
7 passed (34.5s)
```

**Result**: **pass** (all 7).

### volume-target.spec.ts (live-workout strip — shares `computeLifetimeMaxPerExercise` + `sumLiveVolume`)

**Why this matters**: the verdict math reuses `computeLifetimeMaxPerExercise` (from `progress-page-math.ts`) and the freshly-exported `sumLiveVolume` from `volume-target.ts`. Need to confirm the live-workout strip — which is the precedent caller — still works after the `export` keyword change.

```
✓  1 golden path: chasing copy + reps clause across multiple seeded sets (10.6s)
✓  2 chasing — no weight logged: hides the reps clause (6.4s)
✓  3 tie case: matched copy renders when running == previous max (7.1s)
✓  4 MAJ-1 regression: max(set_number) picks current weight, not array index (6.1s)
✓  5 no previous max: strip is hidden for a never-trained exercise (4.1s)
✓  6 history detail does NOT render the strip (5.9s)
✓  7 checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep (8.5s)
7 passed (49.2s)
```

**Result**: **pass** (all 7).

### weekly-volume-strip.spec.ts (History mini-strip)

**Why this matters**: confirm the History mini-strip is unaffected by the verdict routing change.

```
✓  1 golden path: strip renders with header, bars, and labels for seeded data (8.5s)
✓  2 empty state: brand-new user shows 'No sessions yet' and no strip (4.2s)
✓  3 warmup-only user: strip returns null but sessions list still renders (4.9s)
✓  4 refetch path: clearing the persisted TanStack cache + reload yields new total (9.3s)
4 passed (27.5s)
```

**Result**: **pass** (all 4).

## Cross-platform

- **Web**: pass — verified via Playwright Chromium across feature + 4 regression suites.
- **iOS**: not tested — no iOS-specific code touched by this run (verdict uses pure React Native primitives + `expo-router`, same as the live workout screen and Progress page). Native iOS testing requires a real device per repo convention; out of scope for tester per agent contract.
- **Android**: not tested — same reasoning as iOS.

The feature is platform-agnostic at the React Native layer. The only platform-relevant primitive (`router.replace` from `expo-router`) is identical across iOS / Android / web. No platform-conditional `Platform.OS` branches were introduced.

## Test commands

- [x] `npm run typecheck` — clean (exit 0, no output).
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in `router.d.ts` (untouched).
- [x] `npm run test:unit` — **179 passed (179)** across 10 test files in 1.33s. Includes 21 new tests in `session-verdict-math.test.ts` (matches design's expected count of 158 prior + 21 new = 179).
- [x] `npm run test:e2e -- tests/e2e/end-of-session-verdict.spec.ts` — **2 passed (21.0s)**. Case A asserts `+1 PRs` and `600 kg` headline via bulk-check-all path (MAJ-2 load-bearing guard). Case B asserts `0 PRs · 0 kg` + zero-volume copy.
- [x] `npm run test:e2e -- tests/e2e/crud.spec.ts` — 5/6 passed; the 1 failure (`exercises: create custom exercise`) is a pre-existing failure on `main` unrelated to verdict (reproduced on stashed baseline).
- [x] `npm run test:e2e -- tests/e2e/progress-page.spec.ts` — **7 passed (34.5s)**.
- [x] `npm run test:e2e -- tests/e2e/volume-target.spec.ts` — **7 passed (49.2s)**.
- [x] `npm run test:e2e -- tests/e2e/weekly-volume-strip.spec.ts` — **4 passed (27.5s)**.

**Totals on tests in scope for this run**: unit 179/179, feature e2e 2/2, in-scope regression 18/19 (the 1 failure is pre-existing, reproduced on baseline).

## MAJ-2 regression check — explicit confirmation

The user called out: "Case A step 10, assertion expects `600 kg` in the headline. Pre-fix this would have been `0 kg` (stale `setsQ.data` with `completed_at = null` filtered out). Confirm the test exercises the bulk-check-all path (NOT just the normal-finish path)."

**Confirmed**:

1. **Bulk-check-all path exercised**: `end-of-session-verdict.spec.ts:206` notes "Leaving it unchecked forces the Finish flow through the bulk-check-all branch." `:234-242` taps Finish → ChooseActionModal opens (unchecked > 0 triggers `setFinishModalOpen(true)`) → user selects `"Check all and finish"` → `handleCheckAllAndFinish` at `[sessionId].tsx:257-267` → calls `bulkCheckAll.mutateAsync()` (the patched MAJ-2 hook) then `finishAfterMutation()`.

2. **600 kg load-bearing assertion present**: `:259` `expect(headlineText).toContain("600 kg");`. The comment at `:247-250` explicitly notes: *"`600 kg` is the load-bearing MAJ-2 regression guard: pre-fix this would render `0 kg` because the sets cache was still pre-bulk-check."*

3. **Test passed**: Case A reported `✓ ... (13.7s)`. The hook contract change (`useBulkCheckAllInSession.onSuccess` `async`/`await qc.refetchQueries`) is doing its job — by the time the verdict mounts, the sets cache reflects the bulk-checked rows and `sumLiveVolume` includes the 100 kg × 6 working set.

## Decision

**pass**

Reasoning:

- Golden path (Case A: finish with PR via bulk-check-all) passes; load-bearing MAJ-2 `600 kg` headline assertion verified.
- Edge cases (empty Finish, first-ever-not-PR, strict-tie-not-PR, `sumLiveVolume` reuse, cancel-bypasses-verdict) all pass.
- Regression checks: `crud.spec.ts:162` (the verdict-aware patch) passes; `progress-page.spec.ts`, `volume-target.spec.ts`, `weekly-volume-strip.spec.ts` all green.
- The one failing test in `crud.spec.ts` (`exercises: create custom exercise`) is **pre-existing on main**, reproduced on a stashed baseline — unrelated to this feature, separate code surface. Should be triaged separately (likely follow-up to commit b51dd01).
- Typecheck clean, lint clean (0 errors).
- Cancel flow bypasses verdict (`[sessionId].tsx:284` direct route).
- No new RLS surface, no new server queries, no `any`, no `@ts-ignore`.

Recommendation: **finalize** the run.

## Out-of-scope follow-ups surfaced

- `crud.spec.ts:131` (`exercises: create custom exercise`) is failing on `main` due to a placeholder selector `"e.g. Chest"` that no longer matches the new multi-select muscle UI shipped in commit b51dd01. Suggest a `/pipeline-fix` run targeting this test once the verdict feature is finalized.
