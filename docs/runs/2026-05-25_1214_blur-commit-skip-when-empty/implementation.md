# Implementation — 2026-05-25_1214_blur-commit-skip-when-empty

Based on: `fix-plan.md` (path 3 split) and the Diagnostician's recommendation. Race 1 (focused-empty + check) is closed at the source via `<SetInput>.commit()` gate; race 2 (previous-set-not-loaded) is closed at the test harness via a placeholder anchor in `gotoLiveSession`; a new E11 e2e pins the gate's behavioral effect end-to-end with per-PATCH counting.

## Files changed

- `src/components/set-input.tsx` (edited) — Gate the `commit()` callback. Skip dispatch when both local parses return `null` AND the row's stored `weight`/`reps` are already `null`. Adds 16 LOC (4-comparison predicate + JSDoc explaining the race shape and the accepted trade-off).
- `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (edited) — Three changes:
  1. `gotoLiveSession` accepts an optional `{ previousWeightPlaceholder }` and, when supplied, waits for `page.getByPlaceholder(...).first()` to be visible before returning. This is the deterministic gate proving `useLastWorkingSet` has resolved before any subsequent click can run (race 2 mitigation).
  2. E1, E2, E3, E5, E6, E7, E8, E9, E10 updated to pass the appropriate placeholder (`"120"` for kg-mode 120 kg prior session; `"264.6"` for E9's lbs-mode). E4 (no prior session) remains without the option.
  3. New E11 test "focused empty input + tap check → auto-fill is sole PATCH, no commit collision" at the end of the describe block. Focuses the weight input via `getByPlaceholder("120").first().focus()`, taps the Mark button without typing or blurring, and asserts via `page.on("request")` that exactly ONE PATCH carrying `weight`/`reps` lands on `/rest/v1/sets?id=eq.<setId>` (the auto-fill), with neither field set to `null` in the body.

## Deviations from plan

- **None.** The plan's "TODO #1" (verify API name in `commit()`) was resolved by reading `src/components/set-input.tsx:46-58, 103-108`: the actual function is `kgFromInputString(s, unit)` (not `parseFloat0(s, unit)` — `parseFloat0` only takes the string in this file). The gate uses `kgFromInputString` exactly as the original `commit()` body did. Confirming the helper name, not a deviation.
- **Plan's "TODO #2" (PATCH-counting pattern)** resolved in favor of `page.on("request", ...)` (precedent at `tests/e2e/exercise-note.spec.ts:310-318`). This is non-invasive (observes only, does not modify or block requests), and it matches the existing convention in this repo.
- **Test-harness scope decision (in line with the plan):** all auto-fill spec test cases with a seeded prior session now opt-in to the placeholder anchor in `gotoLiveSession`, not just E1/E7. The cost is one extra placeholder visibility check; the benefit is uniform race-2 protection. E4 (no prior session) follows the same rule by omitting the option.

## Soft callbacks made

- None. No ambiguity blocked progress.

## Quality gates

- [x] `npm run typecheck` — pass (zero output)
- [x] `npm run lint` — pass (1 pre-existing warning in `router.d.ts`; no new warnings)
- [x] `npm run test:unit` — 364/364 passed
- [ ] `npx expo export --platform web` — not run (out of scope per playbook for this kind of patch; static gates above + targeted e2e cover it)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Test results

### Targeted runs (web dev server running on `http://localhost:8081`)

- `npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts -g "E11"` — **1/1 passed** (10.8 s).
- `npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts -g "E1: prior|E7: re-check|E11: focused" --repeat-each=10` — **30/30 expected, 0 unexpected, 0 flaky** (325.8 s wall).
- `npx playwright test tests/e2e/auto-fill-placeholder-on-check.spec.ts` (full matrix) — **11/11 passed** (E1-E10 plus the new E11; 106.9 s wall, single run).

### Adjacent regression spot-checks

- `tests/e2e/rest-timer-auto-start.spec.ts` — **7/7 passed**, 0 unexpected, 0 flaky. Same `<SetInput>` mount surface (live workout); confirms the gate did not break the Mark/Unmark path on the rest-timer spec.
- `tests/e2e/end-of-session-verdict.spec.ts` — **2/2 passed**, 0 unexpected. Live workout + bulk-check path unaffected.
- `tests/e2e/volume-target.spec.ts` — 6/7 passed first run, 7/7 on targeted retry. The single first-run failure is the pre-existing "checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep" assertion; uses its own local `gotoLiveSession` helper (NOT the one we modified) and admin-driven toggle (no `<SetInput>.commit()` involved). Flake is not introduced by this run — reverified by `-g "checked-only running volume"` re-run which passes. Belongs to a separate ticket.

## TODO #1 resolution (actual API name used)

- **`commit()` uses:** `kgFromInputString(weight, unit)` for the weight string and `parseInt0(reps)` for reps. Both already existed in the file (`src/components/set-input.tsx:41-58`). The fix-plan's snippet that referenced `parseFloat0(weight, unit)` was a typo — `parseFloat0(s)` is a 1-arg helper used internally by `kgFromInputString`. The implemented gate uses the same helpers the original `commit()` body did, so the parse semantics (`""` → `null` weight via `parseFloat0`'s empty-string short-circuit at `set-input.tsx:48`; `""` → `null` reps via `parseInt("")` → `NaN`) are byte-identical to pre-fix behavior. No semantic regression possible.

## TODO #2 resolution (PATCH-counting pattern)

- **Chosen:** `page.on("request", req => ...)` filtering on URL `/rest/v1/sets?` + `id=eq.<setId>` + `req.method() === "PATCH"` + body containing `"weight"` or `"reps"`.
- **Why:** matches the existing convention at `tests/e2e/exercise-note.spec.ts:310-318`. Non-invasive (does not modify or block requests). Cleanly separates the auto-fill PATCH (which carries `weight`/`reps` in the body) from the `checkSet` PATCH (which carries only `completed_at` — verified at `src/api/sets.ts:240-247`).
- **Failure mode pre-fix:** a second PATCH with `{weight: null, reps: null}` body would land on the same URL and match the filter → `setPatchBodies.length === 2` → assertion fails.
- **Pass condition post-fix:** exactly one PATCH with non-null weight/reps in the body (the auto-fill `{"weight":"120.00","reps":8}`). Additional sanity asserts that the body does NOT contain `"weight":null` or `"reps":null`.

## `gotoLiveSession` gate choice (Fix 3)

- **Anchor used:** `page.getByPlaceholder(opts.previousWeightPlaceholder).first()` with `toBeVisible({ timeout: 15_000 })`.
- **Why a placeholder anchor over a network-request wait:** the placeholder text on the weight input is the visual proxy for `useLastWorkingSet.data` being available (see `src/components/set-input.tsx:86-90`). It is rendered by React only after the query resolves AND `<ExerciseBlock>` re-renders with the new `previousByRowId` map — so it is a strictly downstream signal of "query is settled AND placeholder propagated through the component tree". A pure `page.waitForRequest` would fire as soon as the network response arrives but does not guarantee the React re-render has run; the placeholder anchor gives both in one assertion.
- **Per-caller opt-in:** placeholder strings differ by mode (`"120"` for 120 kg in kg mode, `"264.6"` for the same weight in lbs mode). All callers in this spec with a prior 120 kg session now opt in to `previousWeightPlaceholder: "120"`; E9 (lbs) uses `"264.6"`; E4 (no prior session) skips the option.
- **No callers in other specs broken:** the option is additive (`opts?: { previousWeightPlaceholder?: string }`). `gotoLiveSession` is local to this spec file (other specs have their own copies of the helper), so no cross-spec ripple.

## Process notes (for retro)

- The Edit tool requires unique `old_string` matches; the spec file has 10 identical `await gotoLiveSession(page, sessionId);` calls. Resolved by using surrounding test-specific context (the email literal or the next inline comment) per Edit instead of `replace_all`. No shadow-rename risk because each replacement is anchored uniquely.
- Background dev server (`npm run web`) needed for e2e runs. Started once, kept alive across all e2e invocations.
- The default Playwright reporter was intercepted by an RTK-tee wrapper writing full JSON to a tee log; passing `PLAYWRIGHT_JSON_OUTPUT_NAME` + parsing the result file produced clean stats. No tool / fix-plan deviation, just an environment quirk worth noting for future Implementer/Tester runs in this environment.

## Notes for Regression Tester

- **Verify the original repro:** seed the Repro A scenario from `repro.md` (prior 120 kg session + fresh empty working set), focus the weight input without typing, tap Mark, confirm: DB row settles to `{weight: "120.00", reps: 8, completed_at: <iso>}`, and only ONE PATCH carrying `weight`/`reps` landed on `/rest/v1/sets?id=eq.<setId>`. The new E11 test covers this — also worth running with `--repeat-each=20` for an extra-strict flake check.
- **Adjacent flows to smoke-check:**
  - `rest-timer-auto-start.spec.ts` — same screen, same Mark/Unmark path. Spot-checked here at 7/7; full run still recommended.
  - `volume-target.spec.ts` — has a pre-existing flake on "checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep" (unrelated to this run; uses its own helper and admin-driven toggle). Verify baseline flake rate unchanged.
  - `end-of-session-verdict.spec.ts` — bulk-check path; spot-checked at 2/2.
  - `soft-deleted-exercises-in-history.spec.ts`, `exercise-progress-ia.spec.ts`, `session-total-volume-header.spec.ts`, `probe-strong-unify.spec.ts` — touch the live workout screen; not spot-checked here.
  - History-edit (`app/(app)/history/[id].tsx`) is statically NOT affected (no `showCheckable`, no auto-fill writer; gate fires only when the row is `{null, null}`, which is rare on a previously-completed set). No e2e listed for that surface in this run; rely on the static trace.
- **E2/E3 typed-then-checked race-1 mitigation (`await weightInput.blur(); await page.waitForTimeout(800)`)** is intentionally left in place. If the Tester removes it during exploration, expect ~20-40% flake to return (the input strings are non-empty, the gate does not fire, two PATCHes still race). A separate run is required to address that shape.
- **Limitations:** Could not test on a real iPhone PWA from this environment. Race 1 manifests with different timing on native (`Keyboard.dismiss()` blurs asynchronously via the bridge) but the gate's correctness is platform-independent by construction — it suppresses the emit before any platform-specific timing matters. Worth flagging if a native-target run is planned.
