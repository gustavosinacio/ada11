# Test report v1 — 2026-05-21_1554_tap-exercise-name-to-progress

Testing: implementation against `design-v1.md` (final approved).

## Environment
- Commands used to run app: `npm run web` (Expo web dev server on `http://localhost:8081`)
- Browser / device: Playwright Chromium (headless) — Chrome-equivalent, default viewport
- Test data: fresh per-test users created via Supabase admin SDK (auto-cleaned in `finally` blocks)
- Probes used during diagnosis: throwaway specs under `tests/e2e/probe-*.spec.ts` (deleted after analysis)

## Golden path A — live workout name tap
**Spec** (design §UI spec, §Riscos): tapping the name `<Text>` inside `<ExerciseBlock>` on the live workout screen navigates to `/(app)/exercises/{id}/progress` via `router.push`; browser/system back returns to the live workout with state preserved; subtitle (muscles/equipment) is non-interactive.

**Steps run** (throwaway probe `probe-name-tap.spec.ts` against the running dev server):
1. Sign in fresh user → land on `/workout`.
2. Quick start workout → `/workout/{sessionId}` (`workoutPath` captured).
3. Add Bench Press via picker.
4. Add a working set.
5. Click muscles subtitle ("Chest"/"Pectoralis") — assert URL unchanged.
6. Click the name pressable (`getByLabel("View progress for Bench Press")`).
7. Assert URL matches `/exercises/{uuid}/progress(?id={uuid})?`.
8. Assert progress screen renders (header pencil "Edit exercise" visible).
9. `page.goBack()` → assert pathname === `workoutPath`.
10. Assert the name pressable is still visible (state preserved — exercise still in the workout).

**Result**: **pass**

**Evidence** (from probe run):
```
[nav] http://localhost:8081/workout/200e3d9d-8b1c-4f85-b61d-b3f150eff536
subtitle inert OK
[nav] http://localhost:8081/exercises/cc56db26-f896-474f-af16-45b9f7a3ef04/progress?id=cc56db26-f896-474f-af16-45b9f7a3ef04
progress URL: ...progress?id=...
progress screen pencil visible: true
[nav] http://localhost:8081/workout/200e3d9d-8b1c-4f85-b61d-b3f150eff536  ← back
back-nav restored workout, state preserved
✓ live workout probe passed (9.9s)
```

Live-workout `window.history.length`: 2 → 3 (correct push semantics; back-stack preserved).

## Golden path B — history detail name tap
**Spec** (design §Mudanças por arquivo row 2, §Risks "Back-stack"): tap the name in `<ExerciseBlock>` inside `/history/{sessionId}` → navigate to `/exercises/{id}/progress`; back returns to `/history/{sessionId}` (the session detail), not to `/history` (the list).

**Steps run** (throwaway probe `probe-name-tap-hist.spec.ts`):
1. Sign in fresh user.
2. Quick start a workout, add Bench Press, log a set, Finish → land on `/workout`.
3. Tap History tab → `/history`.
4. Open the session card → `/history/{sessionId}` (captured `histPath`).
5. Sleep 2s, assert URL unchanged (no rogue `router.replace` from the in-progress guard).
6. Read `window.history.length` (= 4).
7. Click the name pressable.
8. Wait for `/exercises/{uuid}/progress?…`. Read `window.history.length` (= **still 4**).
9. `page.goBack()`. Assert URL pathname.

**Result**: **fail**

**Evidence** (full nav trace from `probe-name-tap-hist.spec.ts`):
```
[+6400ms] === finished workout ===
[+6436ms] [nav] http://localhost:8081/history
[+6838ms] [nav] http://localhost:8081/history/e66a2c80-4de7-4228-bffc-9c37fd8b7715
[+8856ms] history detail stable
[+8859ms] window.history.length BEFORE name tap: 4
[+8897ms] [nav] http://localhost:8081/exercises/a3825964.../progress?id=a3825964...
[+8907ms] window.history.length AFTER name tap: 4   ← unchanged: push behaved as replace
[+10410ms] calling page.goBack()
[+10413ms] [nav] http://localhost:8081/history     ← skipped /history/{id}
[+10434ms] [nav] http://localhost:8081/history
[+12940ms] SKIP DETECTED: expected /history/e66a2c80..., got /history
```
Reproduced twice in a row (deterministic, not flaky).

**Symptom**: on web, `router.push("/(app)/exercises/{id}/progress")` from `/history/[id].tsx` behaves as a REPLACE (history.length stays the same instead of incrementing). When the user presses back from the progress screen, they bounce to the history *list*, skipping the session detail. The design explicitly promises "back → history detail" (`design-v1.md` §Riscos > Back-stack: "*from progress pops back to the live workout or history detail respectively*").

**Comparison** — the identical flow from `/workout/[sessionId]` works correctly (history.length 2 → 3). The bug is specific to the history-detail callsite. The live-workout callsite is unaffected.

## Edge 1 — subtitle non-interactivity
**Steps**: After adding Bench Press in a live workout, locate the subtitle text "Chest" / "Pectoralis" (rendered by the muscles row at `exercise-block.tsx:129-140`); click with `{ force: true }` to bypass overlay heuristics; capture URL before and after.
**Expected**: URL unchanged (the subtitle is outside the `<Pressable>` and inert).
**Actual**: URL unchanged.
**Result**: **pass**
**Evidence**: probe log line `subtitle inert OK` (above); the design Decision #5 / §UI spec are honored.

## Edge 2 — volume-target strip is not a tap target
**Steps**: With no previous-max set on a fresh user (the strip is not present), confirmed the name pressable still navigates. Strip absence verified by the existing passing spec `tests/e2e/volume-target.spec.ts:473 "no previous max: strip is hidden"`.
**Expected**: when the strip IS present, it is `<Text>` only and not interactive; only the name pressable navigates.
**Actual**: I could not reproduce a session-with-strip flow inside the probe (the strip requires a previously finished session AND adding the exercise to a NEW session; my synthetic flow finished the workout but the strip did not render in the second session in time — possibly a refetch-window issue with the headless probe, unrelated to this run). I therefore **cannot fully verify this scenario end-to-end** and rely on static evidence instead:
  - The `<VolumeTargetSlot>` mount at `exercise-block.tsx:181-186` is a sibling of the `<View className="flex-row…">` that contains the name pressable. The slot renders only static `<Text>` (per `src/components/volume-target-slot.tsx` and the existing passing volume-target specs). It is not wrapped in any new `<Pressable>` in this diff.
  - The name `<Pressable>` boundary is strictly the `<Text>` (lines 107-128). The strip is outside the name `<Pressable>`.
**Result**: **pass (static)** — implementation matches the design; e2e confirmation deferred.

## Edge 3 — soft-deleted exercise
**Steps**: Not exercised by a bespoke probe. The adjacent regression spec `tests/e2e/soft-deleted-exercises-in-history.spec.ts` covers the rendering of soft-deleted exercises in history-detail blocks and continues to pass (see Regression check below).
**Expected**: tapping the name of a soft-deleted exercise navigates to the progress screen; the existing F9 `useAllExercise(id)` hook keeps the progress route functional for deleted ids.
**Actual**: code inspection at `exercise-block.tsx:114-119` confirms the `(deleted)` suffix is nested inside the wrapped `<Text>` — tap surface unchanged. Progress route at `app/(app)/exercises/[id]/progress.tsx` continues to use `useAllExercise` (per F9 design referenced in `design-v1.md` Decision #6).
**Result**: **pass (static)** — covered by code path + adjacent regression remained green. e2e probe not authored (would have required seeding a soft-deleted exercise via admin SDK; the adjacent spec already does this).

## Regression check
- **`tests/e2e/exercise-progress-ia.spec.ts`** (existing 2 of 3 cases): **pass**.
  ```
  ✓ golden + delete: list → progress → pencil → edit → save → progress (8.7s)
  ✓ cache: finishing a session does not break the progress screen on re-entry (9.4s)
  ✘ name tap in live workout block routes to /exercises/{id}/progress and back (14.9s)
  ```
  The new arm `name tap in live workout block…` (lines 205-245) **fails for a TEST-SIDE bug**, not a product bug. Its `waitForURL` regex `/\/exercises\/[0-9a-f-]+\/progress$/` is anchored with `$`, but the actual web URL is `/exercises/{uuid}/progress?id={uuid}` (expo-router appends the dynamic-param as a query string on web). The product navigation succeeds; the assertion is too strict. The same regex is used (and passes) for navigations originating from the exercises list at line 94, where expo-router does not append the query — so the regex was lifted unchanged. Fix proposal: `/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/`. Independently, the back-nav assertion at line 239 would pass for the live-workout case (verified by the probe), so that anchor is not the issue.
- **`tests/e2e/crud.spec.ts`**: 5 of 6 pass. 1 pre-existing failure at line 150 (`getByPlaceholder("e.g. Chest")`) — the muscles input placeholder no longer exists after the muscles-as-multi-select refactor (commit `b51dd01`). Not caused by this run; unrelated.
- **`tests/e2e/volume-target.spec.ts`**: **all 6 cases pass** (incl. "history detail does NOT render the strip" at line 509).
- **`tests/e2e/remove-exercise.spec.ts`**: **all 2 cases pass**.
- **`tests/e2e/soft-deleted-exercises-in-history.spec.ts`**: **pass** (53s — long but green).

Adjacent e2e summary:
```
14 passed, 1 failed (crud — pre-existing, unrelated)
+ 2 passed / 1 failed in exercise-progress-ia (the 1 failure is a test-regex bug; see above)
```

## Cross-platform
- Web: **fail** — history-detail back-stack bug reproducible deterministically on Playwright Chromium.
- iOS: **not tested** — no simulator/device available in this environment. The design's "Risks > Platform-specific" assumed iOS push/replace would behave like the workout case. Given web-only divergence, an iOS smoke is recommended once a device/simulator is available.
- Android: **not tested** — same reason.

## Test commands
- [x] `npm run typecheck` — `tsc --noEmit` exit 0, no output.
- [x] `npm run lint` — `0 errors, 1 warnings` (the 1 warning is in `router.d.ts` — auto-generated, pre-existing, unrelated).
- [x] `npm run test:unit` — `Test Files 8 passed (8) / Tests 87 passed (87) / Duration 852ms`. All green.
- [x] `npm run test:e2e tests/e2e/exercise-progress-ia.spec.ts` — 2 passed / 1 failed (new arm; the failure is a test-side regex anchor bug, not a product bug; the live-workout product path verified passing via probe).
- [x] Adjacent: `crud.spec.ts` (5/6 — 1 pre-existing unrelated), `volume-target.spec.ts` (6/6), `remove-exercise.spec.ts` (2/2), `soft-deleted-exercises-in-history.spec.ts` (1/1).

## Decision

**fail**

Reasoning:
- **Live workout name tap**: works correctly. Tap navigates, back returns to the workout, state preserved, subtitle inert, accessibility label present. Matches design promises.
- **History detail name tap**: **product regression**. Tap navigates correctly, but `window.history.length` does NOT increment (push behaves as REPLACE), so pressing back from the progress screen lands on `/history` instead of `/history/{sessionId}`. The design explicitly promises back returns to history detail (§Riscos > Back-stack). The user's mental model — "drill into a session, drill into an exercise, back returns to the session" — is broken on web.
- **New e2e arm**: contains a test-side bug. The `$`-anchored URL regex does not account for the `?id={uuid}` suffix expo-router appends on web when navigating to a dynamic `[id]` route from outside the `(app)/exercises/` stack. Even after fixing the test regex, the live-workout arm would pass; but if a sister history-detail arm were added, it would correctly catch the back-stack regression and fail.

**Implementer must address**:
1. **Primary (history-detail back-stack)**: investigate why `router.push("/(app)/exercises/{id}/progress")` from `/history/[id].tsx` does not increment `window.history.length` on web. The same call from `/workout/[sessionId].tsx` does increment. Likely candidates:
   - expo-router web treats the `(app)` route group transition differently when the source is `[id]` within a sibling stack — may need an explicit `href` object, a different push form, or a manual `window.history.pushState` shim.
   - Possible quick mitigation: use `router.navigate(...)` instead of `router.push(...)` on the history callsite; or use the `Href` object form `{ pathname: "/(app)/exercises/[id]/progress", params: { id: ex.id } }` which expo-router's web router resolves through a different code path.
   - Worth a short Discovery pass before edits — this is a routing-layer behavior, not an obvious component fix.
2. **Secondary (test-regex)**: relax the URL regex in `tests/e2e/exercise-progress-ia.spec.ts:233` from `/\/exercises\/[0-9a-f-]+\/progress$/` to `/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/` so the new arm passes once the product bug is fixed; and add a sister arm exercising the history-detail flow so the back-stack regression is permanently guarded.
3. **No DB / RLS / typing / lint regressions** — those gates remain green.
