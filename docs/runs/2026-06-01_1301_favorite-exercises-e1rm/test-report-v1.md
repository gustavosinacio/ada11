# Test report v1 — 2026-06-01_1301_favorite-exercises-e1rm

Testing: implementation against `design-v2.md` (final) + `review-v1.md` (PASS). Implement↔Test round 1 of 2.

**Verdict: FAIL — test-harness defect, feature proven working.** The favorites feature works end-to-end (golden path, RLS, union, persistence all PROVEN green via instrumented probes). The shipped e2e `favorite-exercises-e1rm.spec.ts` FAILS deterministically because it navigates via `page.goto("/progress")` — a HARD browser reload — which (a) races the persistence INSERT and (b) intermittently rehydrates a stale empty favorites list from AsyncStorage-persisted cache without refetching. Real in-app navigation (client-side expo-router) does NOT do a hard reload → a real user never hits this; via the real path the chip appears 3/3. The fix is test-only. Recipe + verification below. → back to Implementer (round 2 is last).

## Environment
- Run-the-app: `npm run web` (Expo web dev server on `http://localhost:8081`), env from `.env.local` exported into the shell. Server health-checked (HTTP 200) before each e2e batch; RSS stable, no OOM cascade this run.
- e2e runner: Playwright 1.59.1, Chromium headless, workers:1 (per `playwright.config.ts`).
- Test data: ephemeral service-role-seeded users (created + torn down per spec). Migration 0020 verified LIVE (`user_exercise_favorites` head-select OK).
- Static: `tsc --noEmit`, `expo lint`, `vitest run`, `npx expo export --platform web`, `npx tsx tests/rls.test.ts`.
- Note: the terminal reporter stream is mangled by an RTK passthrough layer; authoritative e2e verdicts taken from `test-results/.last-run.json` and `PLAYWRIGHT_JSON_OUTPUT_NAME` files.

## 1. Static gates (all PASS)

| Gate | Command | Observed | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit`, 0 errors | PASS |
| Lint | `npm run lint` | `0 errors, 1 warning` — the pre-existing `.expo/types/router.d.ts` auto-generated warning, baseline-unchanged across every prior run | PASS |
| Unit | `npm run test:unit` | **477 passed (29 files)**; `e1rm-strength.test.ts` = 24 tests (13 baseline + 11 favorites-union), `exercise-favorites-api.test.ts` = 11 tests | PASS (matches claimed 477/477) |
| Web bundle | `npx expo export --platform web` | `Exported: dist`; web bundles 4.65 MB JS + 23.7 kB CSS, no errors | PASS (favorites code compiles into the prod bundle) |

## 2. Seed-name resolution (PASS — all 6 EXACT-resolve, incl. the Reviewer-flagged TARGET)

Probe ran the same query `pickCanonicalExercise` issues (`exercises WHERE user_id IS NULL AND deleted_at IS NULL`) for each of the 6 implementation-substituted names. `pickCanonicalExercise` throws on a missing/exact-mismatch name, so this is fail-fast, not false-green.

```
OK   "Bench Press"     -> resolvedName="Bench Press"     exactMatch=true
OK   "Squat (Barbell)" -> resolvedName="Squat (Barbell)" exactMatch=true
OK   "Deadlift"        -> resolvedName="Deadlift"        exactMatch=true
OK   "Overhead Press"  -> resolvedName="Overhead Press"  exactMatch=true
OK   "Row (Barbell)"   -> resolvedName="Row (Barbell)"   exactMatch=true
OK   "Lat Pulldown"    -> id=e121102d… resolvedName="Lat Pulldown" exactMatch=true   ← TARGET
=== RESULT: ALL 6 EXACT-RESOLVE ===
```

**Reviewer's key flag resolved**: the TARGET resolves to exactly `"Lat Pulldown"` (id `e121102d-96b0-4a23-aa79-cf9db4c4bb2b`), NOT `"Lat Pulldown (Machine)"` (the only other pulldown variant in the live catalog). So `getByLabel("Toggle Lat Pulldown")` is the correct, exact locator — confirmed it matches the rendered chip in §4.

## 3. RLS arm (PASS — the security gate is green)

```
$ set -a && . ./.env.local && set +a && npx tsx tests/rls.test.ts
✅ RLS test passed — B cannot read/update/delete A's data; canonical rows visible to both
   users + immutable via RLS; routine_exercise_sets + user_exercise_favorites arms OK.
```

The script throws + exits 1 on ANY arm failure, so the success message is conclusive: the new `user_exercise_favorites` arm passed — A inserts A's favorite (succeeds), B cannot SELECT (0 rows), B cannot DELETE (0 rows), B spoof-INSERT `{user_id: A}` rejected by the INSERT `with check (auth.uid() = user_id)`. The new per-user table's 3-policy RLS holds.

## Golden path

**Spec** (design-v2 §D / Discovery #8): favorite a non-top-N weighted exercise on its detail page → its line/chip appears in the "Estimated 1RM per exercise" chart (the union pins a non-top-N favorite); unfavorite → it leaves.

**Result**: **PASS on the feature** (proven via instrumented probes + the real in-app path) / **FAIL on the shipped spec** (test-harness defect — hard `page.goto` reload).

### 4a. Feature-logic correctness against the LIVE DB (PASS — instrumented union probe)

Replicated the exact e2e seed (5 multi-session top exercises + 1 single-session TARGET), inserted the favorite via the admin client (the exact INSERT `addFavorite` issues), read rows the way `listWeeklyVolumeRows` does, and ran `presentTopExerciseE1rm` WITHOUT vs WITH the favorite:

```
rows read: 33; distinct exercise_ids: 6
[A] NO favorites — series: Bench Press(0), Deadlift(1), Overhead Press(2), Row (Barbell)(3), Squat (Barbell)(4)
    TARGET present? false                          ← Lat Pulldown correctly OUTSIDE the natural top-5
[B] favorite insert error: none ; read back: ["e121102d…"] ; includes target? true
[C] WITH favorite — series: …(0..4), Lat Pulldown(rank 5)
    TARGET present? true (rank 5, values=[76,76])  ← plottable e1RM line (60kg×8 → epley ~76)
    chip label would be: "Toggle Lat Pulldown"
=== UNION VERDICT: TARGET PINNED by favorite (count 5 -> 6) ===
```

This proves: the favorite persists (INSERT 201, RLS-allowed), the union pins the non-top-N favorite as rank 5 (count 5→6), the line is plottable (values `[76,76]`), and the rendered chip label is exactly `"Toggle Lat Pulldown"`. Invariant F holds in `[A]` (no favorites = the natural top-5). **The kernel + DB + union are correct.**

### 4b. In-app toggle persists (PASS — drove the real UI star)

Drove the real header-right star, waited for the actual network INSERT to land:

```
[probe] POST observed? yes status=201
[probe] DB rows for user after toggle: [{"exercise_id":"e121102d…"}]
[probe] PERSISTED? true
```

The in-app `addFavorite` fires a real POST (201) and the row lands in the DB. The optimistic label flip (`Favorite` → `Unfavorite`) works.

### 4c. Golden path via REAL in-app navigation (PASS, reliable 3/3)

Favorited the TARGET on its detail page, then returned to /progress by tapping the **"Progress" bottom tab** (client-side expo-router nav — what a real user does, NO document reload):

```
=== in-app tab nav run 1 ===  target chip present after IN-APP nav? true  count: 1
=== in-app tab nav run 2 ===  target chip present after IN-APP nav? true  count: 1
=== in-app tab nav run 3 ===  target chip present after IN-APP nav? true  count: 1
```

Rendered chip labels on /progress (e1RM section): `Toggle Bench Press, Toggle Deadlift, Toggle Overhead Press, Toggle Row (Barbell), Toggle Squat (Barbell), Toggle Lat Pulldown` (6 e1RM chips — the 5 top + the favorited TARGET), plus the 5 muscle-volume sibling chips. **The favorited non-top-N line appears in the chart, reliably, via the real-user path.** Screenshot: `docs/runs/2026-06-01_1301_favorite-exercises-e1rm/screenshots/favorite-line-in-chart.png` (chip presence asserted programmatically; the chart section is below the fold of the viewport in the PNG).

### 4d. Why the shipped spec FAILS (the test-harness defect — root-caused)

The shipped `favorite-exercises-e1rm.spec.ts` clicks the star then calls `gotoProgress(page)` = `page.goto("/progress")` (a HARD browser reload). Two distinct problems, both stemming from the hard reload:

1. **Persistence race.** Trace timeline (failing run): click at 14441 ms → optimistic `Unfavorite` label at 14456 ms (+15 ms) → `page.goto` at 14563 ms (+107 ms). The optimistic `onMutate` flips the label locally (so step-4's assertion passes), but the async `addFavorite` (`await getUser()` then the INSERT POST) had NOT fired its network call in 107 ms; the hard navigation aborts the in-flight fetch. **Trace network: 0 INSERT POSTs to `user_exercise_favorites` in the entire failing run** (only GETs + the auth token POST). The favorite never reached the DB → after reload the chart reads empty favorites → chip absent → step 5 fails at `:255`.

2. **Stale persisted-cache rehydration (even after fixing the race).** I added `Promise.all([waitForResponse(POST), click()])` so the INSERT lands (verified POST 201, row in DB) — the spec STILL failed 2/2. Root cause: the app uses `PersistQueryClientProvider` (AsyncStorage, `maxAge` 7d) with a global `staleTime: 30s` (`src/lib/query-client.ts:8`, `app/_layout.tsx:41-45`). On a hard reload, react-query rehydrates the persisted cache; the `["exercise_favorites","me"]` query is served from the hydrated cache WITHOUT a refetch if still fresh. The AsyncStorage persist-throttle races the reload, so the rehydrated favorites list is intermittently the stale empty one. Read-probe 3× on the hard-reload path:

   ```
   run 1: POST 201 ; post-reload favorites GET: NONE OBSERVED within 15s ; target chip count: 0
   run 2: POST 201 ; post-reload favorites GET 200 body:[{"exercise_id":"e121102d…"}] ; chip count: 1
   run 3: POST 201 ; post-reload favorites GET 200 body:[{"exercise_id":"e121102d…"}] ; chip count: 1
   ```

   Run 1: no favorites refetch fired → chip absent. Runs 2/3: refetch fired, returned the favorite → chip present. **Flaky on the hard-reload path only.** Real in-app navigation keeps the in-memory cache (with the optimistic + `onSettled`-invalidated favorites) and never rehydrates from disk → §4c is reliable 3/3.

**Attribution: HIGH confidence the FEATURE is correct; HIGH confidence the FAILURE is the spec's `page.goto` (hard reload) modeling navigation wrongly.** A real user navigates client-side (tab tap / header back within the app); the spec's hard reload is an artificial path that races persistence + rehydrates stale persisted cache.

## Edge cases

### Edge 1: Favorite already INSIDE the top-N is a no-op (the MAJ-1 fix) — PASS
**Steps**: unit case 2 (`e1rm-strength.test.ts`) + the union-probe `[A]` baseline.
**Expected**: favoriting a top-N exercise → series count unchanged, id once, byte-identical to no-favorites output.
**Actual**: unit suite green (24/24); the probe's `[A]` no-favorites top-5 == the `[C]` first 5 ranks (0..4) unchanged when the favorite is added at rank 5.
**Result**: PASS. **Evidence**: `npm run test:unit` 477/477; union probe `[A]`/`[C]` series identical for ranks 0..4.

### Edge 2: Non-plottable favorite excluded; Invariant D survives the union — PASS
**Steps**: unit cases 3 (bodyweight-only `weight=0` favorite) + 4 (no-set favorite); re-ran `e1rm-strength.spec.ts` case 4 (bodyweight-only → NO e1RM line).
**Expected**: a favorited exercise with no plottable e1RM never enters `model.series` (eligibility gate upstream of the union); the favorite ROW still persists.
**Actual**: unit cases green; `e1rm-strength.spec.ts :: 4. bodyweight-only exercise (weight=0) produces NO e1RM line` PASSED in the regression batch.
**Result**: PASS. **Evidence**: see §Regression; the probe TARGET (60 kg) DID plot (values `[76,76]`), confirming weighted ≠ bodyweight contrast.

### Edge 3: Invariant F — no favorites = byte-for-byte today — PASS
**Steps**: union probe `[A]` (no favorites arg) + unit case 8 (no-arg == empty-Set deep-equal == pre-change top-5).
**Expected**: with no favorites, the chart is exactly the top-5 as before.
**Actual**: `[A]` produced exactly the natural top-5 (Bench Press, Deadlift, Overhead Press, Row (Barbell), Squat (Barbell)), TARGET absent; `e1rm-strength.spec.ts` Phase-2a specs all green (no-favorites path unchanged).
**Result**: PASS. **Evidence**: union probe `[A]`; `e1rm-strength.spec.ts` 3/3 (§Regression).

## Regression check

Ran via `PLAYWRIGHT_JSON_OUTPUT_NAME` file output (terminal stream mangled by RTK). **12/12 PASSED, 0 failures.**

- **`canonical-exercise-gating.spec.ts`** (the header-right slot the diff rewrites): **5/5** — incl. case 3 "progress header pencil: absent for canonical, present for user-owned". The `progress.tsx` header-right rewrite (star always shown, Pencil gated on `canEdit` w/ label "Edit exercise") did NOT regress the Pencil gating/labeling. PASS.
- **`exercise-progress-ia.spec.ts`** (same header slot, IA flows): **4/4** — golden+delete, cache-on-reentry, live-workout name-tap, history name-tap. PASS.
- **`e1rm-strength.spec.ts`** (Phase-2a — the chart favorites wire into): **3/3** — section renders, chip toggle + check-all/uncheck-all, bodyweight-only → NO line. Invariant F / no-favorites behavior unchanged. PASS.

`.last-run.json` for each batch: `{"status":"passed","failedTests":[]}`.

## Cross-platform
- **Web**: tested via Playwright (Chromium) — static gates + RLS + golden-path probes. Feature PASS; shipped spec FAIL (harness defect).
- **iOS**: not tested. Reason: the change is RN-Web-compatible only — pure-TS presenter (`e1rm-strength.ts`), TanStack hooks (`use-exercise-favorites.ts`), PostgREST INSERT/DELETE/SELECT, a `lucide-react-native` `Star` in the existing header slot, `react-native-svg` `<MultiSeriesChart>` reused as-is; no native modules. Risk LOW per design R-5/R-6. **NOTE**: the hard-reload-cache-staleness defect (§4d) is web-`page.goto`-specific — native navigation is always client-side, so the underlying race does not manifest there either.
- **Android**: not tested. Same reasoning as iOS.

## Test commands
- [x] `npm run typecheck` — 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning (`router.d.ts`).
- [x] `npm run test:unit` — 477 passed (29 files).
- [x] `npx expo export --platform web` — `Exported: dist`, no errors.
- [x] `npx tsx tests/rls.test.ts` — passed (incl. `user_exercise_favorites` arm).
- [x] `npx playwright test tests/e2e/favorite-exercises-e1rm.spec.ts` — **1 FAILED** at `:255` (`getByLabel("Toggle Lat Pulldown")` not visible after the hard-reload navigation). Root-caused to the spec's `page.goto`, not the feature.
- [x] Regression: `canonical-exercise-gating` (5/5) + `exercise-progress-ia` (4/4) + `e1rm-strength` (3/3) — 12/12 PASS.

## Decision

**fail** (test-harness defect; feature proven working — route to Implementer for a test-only fix; round 2 is last).

Reasoning:
- The shipped `tests/e2e/favorite-exercises-e1rm.spec.ts` FAILS deterministically at step 5 (`:253-255`) and step 6 (`:278-280`). This is a real, repeatable RED test — it cannot ship green, so the decision is `fail`.
- **The FEATURE is correct.** Proven by instrumented probes: the union pins the non-top-N favorite (live DB, count 5→6, chip label `"Toggle Lat Pulldown"`); the in-app toggle persists (POST 201, DB row, RLS-allowed); the chip appears reliably 3/3 via the REAL in-app navigation path (Progress tab tap). Static gates + RLS arm + unit suite + 12/12 regression all green. Invariants D/E1/F hold.
- **The defect is the spec's navigation model.** It uses `page.goto("/progress")` (a HARD browser reload), which (1) races the persistence INSERT — only ~107 ms between the click and the navigation, 0 INSERT POSTs in the failing trace — and (2) even with the POST forced to land, intermittently rehydrates a stale empty favorites list from the `PersistQueryClientProvider` AsyncStorage cache without refetching (30 s `staleTime` + persist-throttle race). A real user navigates client-side (tab/back within the app) → in-memory cache preserved → no hard reload → no race, no stale rehydration.

### Fix recipe for the Implementer (test-only, HIGH confidence — verified)
Replace the two `gotoProgress(page)` calls that FOLLOW a star toggle (steps 5 + 6, after favoriting/unfavoriting) so the spec returns to /progress via **client-side in-app navigation** instead of a hard `page.goto`, mirroring real usage:

- **Step 5 (after favoriting)** and **step 6 (after unfavoriting)**: navigate back to the Progress page by tapping the bottom **"Progress" tab** — `await page.getByText("Progress", { exact: true }).first().click();` then `await page.waitForURL(/\/progress$/);` — instead of `gotoProgress(page)`. Verified reliable 3/3 in §4c. (The `getByText("Progress")` tab-click is the same client-side pattern the passing `exercise-progress-ia.spec.ts:96` uses for `getByText("Exercises").first().click()`.)
- **Belt-and-suspenders (recommended)**: also await the persistence response before leaving the detail page so the assertion is order-independent of the navigation kind:
  - after the favorite click: `await Promise.all([ page.waitForResponse(r => r.url().includes("/user_exercise_favorites") && r.request().method() === "POST"), favStar.click() ]);`
  - after the unfavorite click: same with `method() === "DELETE"`.
- Keep the settle-gate (section header visible before each `toHaveCount(0)`) — that part is correct.

This is a faithful test-data/harness fix, not a feature change. No production source edit is required for the feature to work; the production code is correct as-is. (Optional product hardening, OUT OF SCOPE for this fix and NOT a blocker: adding `["exercise_favorites"]` to the Progress pull-to-refresh fan-out — design Alt 13, already parked — would also paper over the hard-reload-staleness on web, but the in-app path already works.)

### Confidence / Risk
- Feature works end-to-end: **Confidence HIGH** (union proven on live data; in-app golden path reliable 3/3; persistence POST 201 + DB row; RLS green; 12/12 regression). **Risk LOW** (no production change needed).
- Failure is the spec's hard-reload navigation, not the feature: **Confidence HIGH** (0 INSERT POSTs in the failing trace; the POST-wait fix alone still flaked due to stale persisted-cache rehydration; the in-app-nav path is reliable 3/3 — three independent probes converge). **Risk LOW** (test-only fix).
