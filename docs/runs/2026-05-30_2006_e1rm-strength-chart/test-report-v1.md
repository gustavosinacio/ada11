# Test report v1 — 2026-05-30_2006_e1rm-strength-chart

Testing: implementation against `design-v1.md` (Phase 2a e1RM strength chart) + `review-v1.md` hand-off notes T-1..T-4.

Implement↔Test ROUND 1 of 2.

## Verdict

**FAIL** — split-attributed.

- **Feature: PASS.** The e1RM chart works exactly as designed. The new e2e spec is 3/3 green; the SVG line renders and trends UP (proven via a runtime polyline probe + full-page screenshot); the negative bodyweight case is correct (Invariant D). All static gates green (444/444 unit).
- **Adjacent regression: FAIL (1 test).** `progress-page.spec.ts :: 4. per-row navigation` was GREEN at baseline `3c00d8e` and is RED with the feature mounted — **proven via stash-to-baseline replay** (baseline PASS, feature FAIL, reproduced twice). Root cause is a real feature-interaction: the new e1RM legend chip introduces an earlier on-page occurrence of the exercise name, which the test's bare-text `.first()` locator now matches instead of the navigable list row. The fix is a 1-line locator tightening in the **adjacent test** (not the feature code) — empirically verified to pass.

Because a previously-passing adjacent test now fails, the decision is **fail** → return to Implementer for the surgical test-locator fix (recipe + empirical proof below). The feature code itself needs no change.

## Environment
- Run-the-app command: `npm run web` (Expo web / Metro on `http://localhost:8081`, started in background; health-checked between batches — RSS stable, **no OOM cascade this run**).
- E2E runner: `npx playwright test` (Playwright 1.59.1, Chromium, `workers:1`, `fullyParallel:false` per `playwright.config.ts`).
- Browser/device: Chromium headless (web). iOS/Android not exercised (see Cross-platform).
- Test data: fresh confirmed users seeded per-test via the service-role `admin` client; canonical exercises resolved from the LIVE shared catalog (`user_id IS NULL`).
- Supabase env: `.env.local` present with all required keys (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

## Could I run e2e/UI? YES.
Dev server started, all 3 new e1RM tests + 12 adjacent tests + baseline replays executed live with screenshots.

## T-1 — seed-name resolution (CRITICAL pre-check) — RESOLVED, all three present

Ran a read-only probe (admin service-role, throwaway, since removed) against the LIVE canonical catalog that `pickCanonicalExercise` actually queries (`exercises WHERE user_id IS NULL AND deleted_at IS NULL ORDER BY name ASC`). Unlike the Implementer (sandbox-denied), my service-role read succeeded.

```
TOTAL canonical rows: 95
Bench Press        => FOUND id=cc80de23-…  equipment=barbell      (weighted — positive)
Squat (Barbell)    => FOUND id=33cc9ca2-…  equipment=null         (weighted — positive)
Chin-up            => FOUND id=7ae53269-…  equipment=bodyweight   (negative case)
Push-up            => FOUND id=77ad047b-…  equipment=bodyweight   (design's original — also valid)
Pull-up            => MISSING                                     (confirms the prior-run defect)
```

- **All three names the spec uses (`Bench Press`, `Squat (Barbell)`, `Chin-up`) resolve in the live catalog — NO `pickCanonicalExercise` throw.** The Implementer's Dev #1 substitution (Push-up→Chin-up, +confirming Bench/Squat) is fully validated.
- `Pull-up` is MISSING — independently re-confirms the exact defect that cost the prior run an I↔T round. The substitution was the right call.
- Confidence: **HIGH** (direct query of the source of truth, not inference).

## Static gates

| Gate | Command | Observed | Baseline | Result |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit` exit 0, 0 errors | 0 | **pass** |
| Lint | `npm run lint` | 0 errors, 1 warning (`router.d.ts`, auto-generated, pre-existing) | 0 err / 1 warn | **pass** |
| Unit | `npm run test:unit` | **444 passed (444)**, 27 files — incl. `e1rm-strength.test.ts (13 tests)` | 431 + 13 = 444 | **pass** |

Unit suite matches the expected 444 (baseline 431 + 13 new e1RM cases). The e1RM unit suite (Invariants D/E1/LOCF/eligibility/dangling/tie-break) is present and green — this is the correct home for E1/LOCF (T-4: no e2e needed for them).

## Golden path (T-2)

**Spec** (design §5 F5): the "Estimated 1RM per exercise" section renders on the Progress page with a VISIBLE e1RM line; seeding a weighted exercise across ≥2 weeks with increasing weight → the e1RM line trends UP; selectable lines + check-all/uncheck-all work.

**Steps run**:
1. Ran the shipped spec `tests/e2e/e1rm-strength.spec.ts` (3 tests) — 3/3 PASS.
2. Authored a throwaway probe spec (since removed) seeding Bench Press 90kg×5 (week-1-ago, e1RM=105) then 100kg×5 (this week, e1RM=116.67), scrolled the e1RM section into view, and asserted the SVG `<polyline>` element itself — closing the Reviewer's T-2 "legend chip alone doesn't prove the line renders" gap.

**Result**: **pass** (feature).

**Evidence** — shipped spec (re-run after the stash/revert dance, "re-run don't trust"):
```
stats: {"expected":3,"unexpected":0,"flaky":0}
PASS 1. section renders for a populated user with a weighted exercise
PASS 2. per-exercise chip toggle + check-all / uncheck-all
PASS 4. bodyweight-only exercise (weight=0) produces NO e1RM line
```

**Evidence — the LINE actually draws (T-2 close-loop)** — runtime polyline probe:
```
[probe] polyline[stroke=#ef4444] count = 2      ← Bench Press (rank-0 → E1RM_PALETTE[0]=#ef4444) draws as a real SVG <polyline>
[probe] bench polyline points = 64,34 1232,20   ← two week vertices
[probe] firstY=34 lastY=20 (lastY<firstY ⇒ up)  ← SVG y decreases upward → line TRENDS UP (e1RM 105→116.67)
[probe] red dots = 4                             ← 2 dots for the bench series (one per week point)
```
- `count=2` because the adjacent muscle-volume chart's first series ("Chest") is also `#ef4444`; the bench polyline `64,34 1232,20` is confirmed present and upward. The probe parsed the polyline points and asserted `lastY < firstY` — a true upward strength line, the design's "visible upward line proves the feature" intent landing on the SVG, not just the legend.

**Visual evidence**: `docs/runs/2026-05-30_2006_e1rm-strength-chart/screenshots/e1rm-line-fullpage.png` (full-page) shows the "ESTIMATED 1RM PER EXERCISE" section below "WEEKLY VOLUME PER MUSCLE", a red line rising from ~105 kg (18/05) to ~116.7 kg (25/05) with dots at both points, kg y-ticks (116.7/87.5/58.3/29.2/0.0 — `formatWeight` working), the "Bench Press" legend chip, and an "Uncheck all" button.
Also `screenshots/e1rm-section.png` (the spec's own shot; viewport-only so the section sits below the fold — the full-page shot is the load-bearing one).

**Selectable lines + check-all/uncheck-all**: covered by shipped test #2 (PASS) — chip `opacity-40` toggles on/off; "Hide all exercises" ⇄ "Show all exercises" button flips. Two weighted exercises (Bench + Squat) seeded so check-all toggles >1 line.

## Edge cases

### Edge 1 (NEGATIVE / Invariant D end-to-end, T-3): bodyweight-only user → NO e1RM line
**Steps**: shipped test #4 — seed Chin-up (bodyweight) logged with `weight=0`, reps=8, 4 working sets; await the `<StreakCard>` "Streak" hydration anchor; then assert the e1RM header + `Toggle Chin-up` chip both have count 0.
**Expected**: section absent (`return null` when `series.length===0`), no chip.
**Actual**: both `toHaveCount(0)` pass after the page is hydrated.
**Result**: **pass**.
**Evidence**: `PASS 4. bodyweight-only exercise (weight=0) produces NO e1RM line` (above). Invariant D holds end-to-end: a 0-weight set never becomes eligible.

**MAJ-1 teeth (T-3) — empirically grounded, not just static**: the Reviewer's static case (the "Streak" anchor renders ONLY in `streak-card.tsx`'s loaded branch, never the loading skeleton, so it gates on hydration) is sound. The empirical contrast that proves teeth: my golden-path probe seeded a WEIGHTED user and observed the same header + `Toggle <name>` chip + a polyline **present** (count ≥1) — i.e. the exact assertions test #4 demands be 0 are demonstrably ≥1 when a line should render. So `toHaveCount(0)` is a real discriminator, not a vacuous pass: it is 0 for bodyweight and ≥1 for weighted, on a hydrated page. Confidence: **HIGH**.

### Edge 2 (MAX / Invariant E1 + LOCF, T-4): unit-covered by design
**Steps**: confirmed `tests/unit/e1rm-strength.test.ts` (13 cases) ran green — incl. #3/#4 (MAX-not-sum across same-week sessions/sets), #5 (LOCF carry-forward, `values[1]!==0`), #6 (leading flat lead-in), #7/#10 (bodyweight-only excluded from slot), #11 (dangling id skip), #13 (row-order-independent ranking).
**Expected**: peak-metric semantics (MAX), carry-forward not zero-fill, eligibility filter — all pinned.
**Actual**: 13/13 pass within the 444/444 suite.
**Result**: **pass**. Per design + Reviewer T-4, E1/LOCF live in unit (the algorithm's correct home); no e2e needed. I did NOT mark these as "e2e-verified" — they are unit-verified, which is the design intent.

### Edge 3 (seed-name catalog drift, the prior-run failure mode): pre-empted
Covered by T-1 above — directly probed the live catalog; all three names present. This is the edge case that has bitten this pipeline before; it is clean this run.

## Regression check (adjacent Progress-page features)

Ran `weekly-muscle-volume.spec.ts` (4) + `progress-page.spec.ts` (8) in one batch (12 tests), server health-checked (200) before. Result: **11 PASS / 1 FAIL**.

```
PASS  weekly-muscle-volume.spec.ts :: 1. section renders; old per-session chart is gone
PASS  weekly-muscle-volume.spec.ts :: 2. check-all / uncheck-all toggles every muscle line
PASS  weekly-muscle-volume.spec.ts :: 3. per-muscle chip toggles a single line's visibility
PASS  weekly-muscle-volume.spec.ts :: 4. bodyweight exercise feeds the chart via the Phase-0 kernel
PASS  progress-page.spec.ts :: 1. tab visibility
PASS  progress-page.spec.ts :: 2. empty user — day-zero empty states
PASS  progress-page.spec.ts :: 3. populated user mid-week — hero, bars, list, streak all render
FAIL  progress-page.spec.ts :: 4. per-row navigation — tapping a list row routes to /exercises/{id}/progress
PASS  progress-page.spec.ts :: 5. empty current ISO week with prior history
PASS  progress-page.spec.ts :: 6. PR badge — PR pill + accordion celebratory line
PASS  progress-page.spec.ts :: 7. 5-tab regression
PASS  progress-page.spec.ts :: 8. hero accordion — tap count → expand → tap row → routes
```

- **`<WeeklyMuscleVolumeSection>` (the adjacent sibling the e1RM section mounts next to): UNAFFECTED** — 4/4. The hero, weekly strip, empty states, PR badge, tab bar, and the hero-accordion navigation (#8) all still render/behave. Only the single per-row-navigation test #4 broke.

### The 1 failure — `progress-page.spec.ts :: 4` — PROVEN to be a feature-interaction regression (NOT pre-existing)

**Failure**:
```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  280 |       await row.click();
> 282 |       await page.waitForURL(new RegExp(`/exercises/${exerciseId}/progress`), {
```

**Causation proof (stash-to-baseline replay + reproduce)**:
| Tree state | `progress/index.tsx` mounts e1RM? | Test #4 |
|---|---|---|
| Feature (working tree) | yes | **FAIL** (reproduced twice) |
| Baseline (e1RM files stashed) — `git stash push` the 5 feature files; confirmed `grep -c E1rmStrengthSection = 0` | no | **PASS** |
| Feature restored (`git stash pop`) | yes | **FAIL** (re-reproduced) |

This is a textbook before/after toggle: removing the feature makes #4 pass; restoring it makes #4 fail. **Confidence the failure is feature-caused, not pre-existing: HIGH.**

**Root cause** (HIGH confidence — traced + fix-verified):
- Test #4 locates the navigable list row with `page.getByText(exerciseName, { exact: true }).first()` (`progress-page.spec.ts:278`).
- The seeded exercise is `pickCanonicalExercise(admin)` with no preferred name → the first canonical row name-ordered ASC, seeded **weighted** (80kg×5). Being weighted, it is eligible for the e1RM chart → it now renders as a **"Toggle <name>" legend chip** in `<E1rmStrengthSection>`, whose visible text contains the exercise name.
- `<E1rmStrengthSection>` mounts at `progress/index.tsx:75` — BEFORE `<ExercisesThisWeekList>` (`:76`). So the e1RM chip's name text appears EARLIER in DOM order than the list row.
- `.first()` therefore now binds to the **e1RM legend chip** (a non-navigable toggle `Pressable`) instead of the list row. Clicking it toggles line visibility; no navigation occurs → `waitForURL` times out.
- Test #8 (hero-accordion navigation) does NOT break because it uses a SPECIFIC role+label locator `getByRole("button", { name: "<name>, view progress" })` (`:448`), which the e1RM chip (label `"Toggle <name>"`) does not match. That asymmetry confirms the diagnosis.

**This is the same class as the prior-run "Pull-up" issue**: the feature is correct; the defect is a pre-existing **test's fragile locator** that assumed the exercise name was unique-or-first on the page. The e1RM section legitimately adds an earlier occurrence. The fix belongs in the **adjacent test**, NOT in feature code.

**Surgical fix recipe (test-only, empirically verified)** — `tests/e2e/progress-page.spec.ts:278`:
```diff
-      const row = page.getByText(exerciseName, { exact: true }).first();
+      const row = page
+        .getByRole("button", { name: `${exerciseName}, view progress` })
+        .first();
```
- **Sibling precedent (same file)**: test #8 already uses exactly this locator at `:448` — `getByRole("button", { name: `${exerciseName}, view progress` })` — and passed. The list row exposes that label at `src/components/exercises-this-week-list.tsx:121` (`accessibilityLabel={`${row.exerciseName}, view progress`}`).
- **Empirically proven**: I applied this exact one-line edit, re-ran test #4 with the feature mounted → **PASS** (`expected:1, unexpected:0`), then reverted. The fix resolves the regression with zero feature-code change.
- **Confidence**: HIGH on diagnosis (before/after toggle + role-label asymmetry + fix-verified). **Risk: LOW** (test-only locator tightening, sibling precedent in the same file).

## Pre-existing failures (out of scope)
- None observed in the specs I ran. (The historically-known `chart-scroll-week-selector` 2 failures were not in this run's scope; I did not run that spec.) The single failure I found is feature-caused, proven above — not pre-existing.

## Cross-platform
- **Web (Chromium)**: tested — feature works; 1 adjacent test regressed (above). The change is RN-Web-compatible only: pure-TS presenter (`e1rm-strength.ts`, no platform APIs), TanStack hooks, `react-native-svg` `<MultiSeriesChart>` reused as-is (the muscle chart is a working web+native proof on the same path). No native modules touched.
- **iOS**: **not tested** — no native-specific code in the diff; `<MultiSeriesChart>` already ships on native via the muscle section. Risk LOW per design R-5/R-6.
- **Android**: **not tested** — same reasoning as iOS.

(I did not run iOS/Android simulators; per the rules I do not mark them pass. Risk is LOW because the feature is the same component/hook path as the already-shipped muscle chart.)

## Test commands
- [x] `npm run typecheck` — `tsc --noEmit` exit 0, 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing auto-generated warning.
- [x] `npm run test:unit` — 444 passed (444), incl. `e1rm-strength.test.ts (13 tests)`.
- [x] `npm run test:e2e` (scoped) — new spec 3/3 PASS; line-render probe PASS (polyline draws, trends up); adjacent regression 11/12 (1 feature-caused FAIL, proven, fix-verified).

## Decision

**fail**

Reasoning:
- **Feature is correct and shippable on its own merits**: golden path proven end-to-end (the SVG line draws and trends up — runtime polyline probe + full-page screenshot), Invariant D negative case correct with a settle-gate that has empirical teeth, toggles work, T-1 seed names all resolve in the live catalog, all static gates green (444/444). T-1/T-2/T-3/T-4 all addressed.
- **But a previously-passing adjacent test now fails** (`progress-page.spec.ts :: 4`), proven a genuine feature-interaction regression via stash-to-baseline replay (baseline PASS / feature FAIL, reproduced). Per the Tester decision rule, any broken adjacent feature → `fail`.
- **The break is in the adjacent TEST's locator, not the feature code.** The one-line fix (tighten the bare-text `.first()` to the role+label locator the sibling test #8 already uses) is empirically verified to pass. **No feature-code change is required.**

**Recommendation to Conductor: return to Implementer** for the surgical test-only locator fix at `tests/e2e/progress-page.spec.ts:278` (recipe above, fix-verified). This should be a narrow one-token round, not a feature-rework round. Round 2 is the last I↔T round.

---

### Confidence / risk summary (per finding)
- Feature golden path works: **HIGH** (live polyline + screenshot + 3/3 spec).
- T-1 seed names resolve: **HIGH** (direct live-catalog query).
- MAJ-1 teeth: **HIGH** (static + empirical weighted-vs-bodyweight contrast).
- The nav failure is feature-caused (not pre-existing): **HIGH** (before/after stash toggle, reproduced twice).
- Root cause = DOM-order chip collision with `.first()`: **HIGH** (traced + role-label asymmetry vs test #8 + fix-verified).
- Fix recipe correctness: **HIGH** (applied → PASS → reverted). **Risk of the fix: LOW** (test-only, sibling precedent in same file).
