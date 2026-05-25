# Regression report — 2026-05-25_1214_blur-commit-skip-when-empty

## Environment
- Build: local web dev server (`npm run web`, Expo + react-native-web on `http://localhost:8081`); Playwright Chromium runner.
- Test data: per-spec e2e seed (fresh confirmed user, seeded prior session, seeded routine + live session) created via the existing admin-client helpers in `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (`createConfirmedUser`, `seedFinishedSession`, `seedRoutineWithTwoExercises`, `startLiveSession`, `seedSet`).
- Baseline reference: commit `5190a5836ee95091b273f58ab74e178c433fdbfc` (from `state.md:15`). No baseline-stash was needed because every spec passed cleanly post-fix; the pre-existing `volume-target.spec.ts:"checked-only running volume"` flake flagged by the Implementer did NOT re-occur in the Tester run.
- Dev-server boots:
  - Boot 1: the server the Implementer had left running (PID 96575). Used for the static gates and stability bar boot 1.
  - Boot 2: killed PID 96575 (`kill 96575`, verified `lsof -ti :8081` empty), restarted via `npm run web`. Used for stability bar boot 2.

## Automated checks
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass (zero output from `tsc --noEmit`) |
| Lint | `npm run lint` | pass (1 pre-existing warning in `router.d.ts`, 0 errors, no new warnings) |
| Unit tests | `npm run test:unit` | **364 / 364 pass** (23 test files, 2.00 s) |
| Web export build | `npx expo export --platform web --output-dir /tmp/expo-export-test` | pass (38 routes exported, exit 0) |

## Replay of original reproduction

### Repro A (the architectural race the gate targets)
Per `repro.md`, Repro A is the focused-empty input + tap-check shape; it is pinned by the new **E11** spec in `tests/e2e/auto-fill-placeholder-on-check.spec.ts`. E11 focuses the empty weight input (no typing, no explicit blur), taps Mark, intercepts every `PATCH /rest/v1/sets?id=eq.<setId>` request via `page.on("request", ...)`, and asserts:

1. Exactly ONE PATCH with `"weight"` / `"reps"` keys in the body lands on the row (the auto-fill).
2. The body does NOT contain `"weight":null` or `"reps":null` (no clobber payload).
3. DB row settles to `{ weight: "120.00", reps: 8, completed_at: <iso> }`.

### Stability bar (LOAD-BEARING — independent re-run on two dev-server boots)

`npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts -g "E1: prior|E7: re-check|E11: focused" --repeat-each=10`

| Boot | Server start | Cases × repeats | Expected | Unexpected | Flaky | Wall time |
|---|---|---|---|---|---|---|
| 1 | running from Implementer hand-off | 3 × 10 = 30 | **30** | 0 | 0 | 342.4 s |
| 2 | fresh `npm run web` after killing PID 96575 | 3 × 10 = 30 | **30** | 0 | 0 | 319.9 s |

**Combined: 60 / 60 PASS across two independent dev-server boots. Zero unexpected. Zero flaky.** This is materially stronger than the brief's threshold of "20+ green across the 3 cases × 10 repeats." Race 1 (focused-empty + check) is closed at the source, and race 2 (`useLastWorkingSet` not resolved before click) is closed at the test harness via the `previousWeightPlaceholder` anchor in `gotoLiveSession`.

### Network-trace confirmation for E11
E11 asserts via the request listener that `setPatchBodies.length === 1`. Across the 20 E11 runs in the stability bar (10 per boot) + the 1 E11 run in the full-matrix sweep, the test passed on every iteration — that is **21 consecutive `setPatchBodies.length === 1` assertions** without a single failure. Pre-fix this assertion would catch the colliding `{ weight: null, reps: null }` PATCH (`length === 2`). Post-fix the gate at `src/components/set-input.tsx:103-124` short-circuits before `onCommit` fires, so the second PATCH is never dispatched.

**Evidence (Playwright stats JSON):**
```
boot1 stats: { "expected": 30, "skipped": 0, "unexpected": 0, "flaky": 0, "duration": 342403.388 ms }
boot2 stats: { "expected": 30, "skipped": 0, "unexpected": 0, "flaky": 0, "duration": 319927.852 ms }
full matrix: { "expected": 11, "skipped": 0, "unexpected": 0, "flaky": 0, "duration": 104224.066 ms }
```

### Full auto-fill matrix
`npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts` — **11 / 11 passed** (E1–E10 plus the new E11). 0 unexpected, 0 flaky, 102 s wall.

**Result**: bug no longer reproduces. Race 1 closed at source; race 2 closed at test harness; E11 pins both for future regression. No `cannot-test-locally` caveat for the web target.

## Adjacent regression checks (full sweep per playbook — shared-kernel fix)

All specs invoked once at default settings (no `--repeat-each`). All on the same fresh dev-server boot (boot 2).

| Spec | Result | Notes |
|---|---|---|
| `tests/e2e/rest-timer-auto-start.spec.ts` | **7 / 7 pass** (60.0 s) | Same `<SetInput>` mount surface; auto-fill check path exercised. Pass confirms the gate did not break the Mark/Unmark path on the rest-timer overlay. |
| `tests/e2e/volume-target.spec.ts` | **7 / 7 pass** (53.7 s) | Includes the `"checked-only running volume"` case the Implementer flagged as pre-existing-flaky. Passed first-run here. **No regression introduced; pre-existing flake did not re-occur in this run.** |
| `tests/e2e/end-of-session-verdict.spec.ts` | **2 / 2 pass** (13.6 s) | Bulk-check + finish flow. Live workout screen's `onToggleSetChecked` path exercised. |
| `tests/e2e/remove-exercise.spec.ts` | **2 / 2 pass** (17.2 s) | Live workout mutations (delete exercise) — confirms `<ExerciseBlock>` unmounts cleanly while `<SetInput>` mounted. |
| `tests/e2e/read-only-history.spec.ts` | **5 / 5 pass** (28.7 s) | `<ReadOnlyExerciseBlock>` surface — confirms the unaffected history-read path still renders. |
| `tests/e2e/exercise-progress-ia.spec.ts` | **4 / 4 pass** (27.9 s) | Cross-session queries (`useLastWorkingSet`) — same data source used by the gate's `row.weight`/`row.reps` props. |
| `tests/e2e/exercise-session-row-list.spec.ts` | **3 / 3 pass** (17.8 s) | History-screen list rendering; mirrors `<SetInput>` data shape. |
| `tests/e2e/progress-page.spec.ts` | **8 / 8 pass** (41.3 s) | Volume / progress aggregates — confirms the gate did not change downstream aggregations. |
| `tests/e2e/soft-deleted-exercises-in-history.spec.ts` | **1 / 1 pass** (57.1 s) | History edge case. |
| `tests/e2e/soft-deleted-session-volume-leak.spec.ts` | **4 / 4 pass** (33.0 s) | The spec whose own regression-report flagged the `E7 :633 NaN` race that race 2 (`useLastWorkingSet` not resolved) was producing. Passes cleanly here. **Independent corroboration that race 2 is closed by the `previousWeightPlaceholder` anchor.** |
| `tests/e2e/crud.spec.ts` | **6 / 6 pass** (36.2 s) | Routine/exercise CRUD smoke. |

**Sweep totals: 49 / 49 pass across 11 spec files. 0 unexpected. 0 flaky.**

## Code-level confirmation

| File | Before | After |
|---|---|---|
| `src/components/set-input.tsx:103-108` | `const commit = () => { onCommit({ reps: parseInt0(reps), weight: kgFromInputString(weight, unit) }); };` | Gate at lines 103-124: compute `newWeight`/`newReps` first; if `newWeight === null && newReps === null && row.weight === null && row.reps === null`, early-return without calling `onCommit`. Otherwise `onCommit({ reps: newReps, weight: newWeight })`. Block carries the verbatim comment documenting race 1 and the accepted trade-off. |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts:256-274` | `gotoLiveSession(page, sessionId)` — no placeholder anchor; waited only on "Elapsed" + second exercise name. | `gotoLiveSession(page, sessionId, opts?: { previousWeightPlaceholder?: string })` — when `opts.previousWeightPlaceholder` is provided, asserts `page.getByPlaceholder(...).first()` `toBeVisible({ timeout: 15_000 })` before returning. Race 2 mitigation. |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts:940+` | (did not exist) | New **E11** test "focused empty input + tap check → auto-fill is sole PATCH, no commit collision". Intercepts PATCHes via `page.on("request", ...)`, filters by URL `/rest/v1/sets?id=eq.<setId>` + method `PATCH` + body containing `"weight"`/`"reps"`, asserts `length === 1` and no `"weight":null`/`"reps":null`. |
| All callers of `gotoLiveSession` (E1, E2, E3, E5, E6, E7, E8, E9, E10) | Bare `gotoLiveSession(page, sessionId);` | Opt in to `previousWeightPlaceholder: "120"` (or `"264.6"` for E9 lbs mode). E4 (no prior session) intentionally skipped. |

## Out-of-scope confirmation

Per `fix-plan.md` "Out of scope":

- **Race 1 typed-then-checked shape (E2 / E3)**: the existing test-side mitigation `await weightInput.blur(); await page.waitForTimeout(800);` remains in place. Verified by reading `tests/e2e/auto-fill-placeholder-on-check.spec.ts:381-382, 453-454` — mitigation still present. E2 + E3 passed in the full-matrix run. **No regression observed**; the gate genuinely does not affect this path because the local input strings are non-empty there. The harder source-level fix (merge patches / mutation queue) remains deferred to a separate run.
- **Server-side `updateSet` short-circuit for `{weight: null, reps: null}`**: not touched. `src/api/sets.ts:113-138` unchanged.
- **`onUpdateSet` shim gate at `app/(app)/workout/[sessionId].tsx:464-469`**: not touched. The source gate at `<SetInput>.commit()` is sufficient by construction.

## Decision

**pass**

Reasoning:
- Static gates: typecheck clean, lint clean (no new warnings), unit tests 364/364, web export builds (38 routes exported, exit 0).
- Stability bar (load-bearing): **60 / 60** across two independent dev-server boots — well above the brief's 20/30 threshold. Race is genuinely closed; the prior F7 round's Implementer-vs-Tester reproducibility divergence does not recur. Zero flaky.
- Full auto-fill matrix: **11 / 11** including the new E11 that pins the network-trace assertion (exactly one PATCH with weight/reps in body).
- Adjacent regression sweep (full playbook matrix for shared-kernel fix): **49 / 49** across 11 spec files touching `<SetInput>` / `<ExerciseBlock>` mounts. Zero new regressions.
- The pre-existing `volume-target.spec.ts:"checked-only running volume"` flake that the Implementer's run hit on first attempt did **not** re-occur in this Tester run (7/7 first try) — flake-rate observation consistent with "rare pre-existing, not introduced".
- Network trace for E11 was checked indirectly via the test's own assertion (`setPatchBodies.length === 1`) — passed 21/21 across all E11 executions (20 in the stability bar + 1 in the full matrix).
- Visible bug regression check (E2 / E3 with their existing `blur + waitForTimeout(800)` mitigation): both pass; no regression.

Limitation (flag for user):
- **Native iOS / Android PWA**: I cannot exercise the real-device path from this environment. The gate's correctness is platform-independent by construction (it suppresses the emit at the React component layer before any platform-specific `Keyboard.dismiss()` timing matters), so the risk of a native-only regression is LOW. If the user wants belt-and-suspenders confirmation on an iPhone PWA, the same flow as `Post-deploy manual verification` below applies; otherwise the static-trace argument from the Diagnostician + Fix Designer is sufficient.

## Post-deploy manual verification (optional, web-only smoke for the user)

The web-side path is fully covered by E11 + the stability bar; a manual smoke is not required to close this run. The block below is provided in case the user wants to confirm on their own browser.

1. Open a live session with an exercise that has a prior 120 kg × 8 finished session.
2. Confirm the row renders weight placeholder `120` and reps placeholder `8` BEFORE doing anything (race 2 visual proxy).
3. Click into the weight input to focus it. Do NOT type. Do NOT click outside to blur.
4. Tap the leading check button on the row.
5. Expected: row flips to checked (green), weight shows `120`, reps shows `8`, volume `> 0 kg`. In the browser network tab: exactly ONE PATCH on `/rest/v1/sets?id=eq.<setId>` carrying `{ "weight": "120.00", "reps": 8, ... }`; NO parallel PATCH carrying `"weight": null` / `"reps": null`.
6. Optional: repeat 5–10 times. The result should be deterministic; no occasional `0 kg` volume / empty inputs after check.

- Verified by user on <environment>: <pass | fail>.
- Confirmation timestamp (BRT): <YYYY-MM-DD HH:mm>.
- User statement: "<verbatim>"
