# Test report v1 — 2026-06-03_1124_progress-chart-window

Testing: implementation against `design-v1.md` (approved) + `review-v1.md` (PASS, hand-off T-1/T-2/T-3) + `implementation.md`.

## Decision: **PASS**

Golden path proven (the SVG chart geometry redraws on window change — 53→9 polyline points — not just a chip count). All edge cases pass. Invariant W holds end-to-end (4 adjacent specs green at default `windowStartMs=undefined`). Static gates green (typecheck 0 / lint 0+1 pre-existing / unit 485/485). The new e2e is 0-flake (9/9 over `--repeat-each=3`). All three Reviewer hand-off items (T-1/T-2/T-3) resolved with runtime evidence.

Recommendation: **finalize**.

---

## Environment
- Run-the-app command: `npm run web` (Expo web export on `http://localhost:8081`; pid 59543; the e2e harness expects an already-running server per `playwright.config.ts:6-9` / `docs/development.md:67`).
- Browser / device: Playwright Chromium (headless), rn-web 0.21.
- Test data: service-role admin seeds (`createUser` + `sessions`/`sets`) against the LIVE hosted Supabase (`krbgpctbfvndxjnpzrg.supabase.co`); SUT is the signed-in user client. Canonical exercises read from the shared catalog (95 canonical rows).
- Dev server health: HTTP 200 before, between, and after every batch; RSS ~43 MB throughout — **no OOM cascade** this run (partition-and-restart workaround not needed).

---

## Static gates (executed, not read)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| Lint | `npm run lint` | **0 errors / 1 warning** — the warning is the pre-existing auto-generated `.expo/types/router.d.ts` (baseline-unchanged; none of the 11 feature files lint dirty) |
| Unit (FULL) | `npx vitest run --reporter=json` | **485 / 485 pass, 0 fail** (134 suites) — authoritative from the JSON reporter, matches implementation.md's claim exactly |

**Invariant W — the W-cases ran and locked it (parsed from the JSON report):**
- `presentWeeklyVolumeByMuscle > W-0 (Invariant W): windowStartMs:undefined === the no-param call (byte-for-byte)` — **passed** (deep-equal anchor).
- `presentTopExerciseE1rm > W-0 (Invariant W): windowStartMs:undefined === the no-param call (byte-for-byte)` — **passed** (deep-equal anchor).
- Plus W-1 (axis shrink), W-2 (muscle drops out), W-3 (boundary inclusivity `===` IN / `-1ms` OUT) for muscle; W-1, W-4 (top-N recompute), W-5 (LOCF over windowed set) for e1RM — **all passed**.
- (Bonus: the 5 pre-existing cache-buster files also carry a full `windowed-mode regression` block on the `progress-page-math`/PR/volume-target kernels — 20+ cases — all green; that is out-of-run noise but confirms the wider windowing surface is intact.)

Evidence:
```
numTotalTests 485 / numPassed 485 / numFailed 0 / numTotalSuites 134
passed :: presentWeeklyVolumeByMuscle > W-0 (Invariant W): windowStartMs:undefined === the no-param call (byte-for-byte)
passed :: presentTopExerciseE1rm   > W-0 (Invariant W): windowStartMs:undefined === the no-param call (byte-for-byte)
passed :: presentWeeklyVolumeByMuscle > W-1/W-2/W-3 ; presentTopExerciseE1rm > W-1/W-4/W-5
```

---

## Golden path

**Spec** (from design): a page-level discrete weeks selector (`0/10/20/30/40/50` → All/10w/…/50w) on `/progress` that windows BOTH trend charts in lockstep, seeded from the user's `max_volume_window_weeks` pref (ephemeral, view-only). Tapping a shorter window must shrink BOTH charts; tapping "All" restores full history.

**Steps run** (primary spec `tests/e2e/progress-window-selector.spec.ts`, test 1 — and a runtime SVG-geometry probe for T-1):
1. Seed a user: `Bench Press` ~52 weeks ago (pre-window for 10w), `Squat (Barbell)` this week (always in-window). Sign in via UI, navigate to `/progress`.
2. Default seed: a fresh user (no pref) → selector seeds to "All", which carries the active `bg-black` class. Both e1RM chips present (`Toggle Bench Press` count 1, `Toggle Squat (Barbell)` count 1).
3. Tap "10w" → settle-gate waits for the 10w segment to carry `bg-black` AND the in-window `Squat` chip to be present, THEN asserts `Toggle Bench Press` count `0` (MAJ-1 teeth: the OLD-only chip disappears).
4. Tap "All" → `Toggle Bench Press` returns to count 1 (proves the assertion changes with the window, not statically true).

**Result**: **pass** — 3/3 in the shipped spec; **0-flake over 9/9 with `--repeat-each=3`**.

**T-1 — chart ACTUALLY redraws (SVG geometry, not just chip count).** RESOLVED. I wrote a throwaway probe (`tests/e2e/_probe-window-redraw.spec.ts`, since removed) that seeds ONE weighted exercise across W52/W30/W8/W0 (so the series SET is constant — `Toggle Bench Press` stays count 1→1, NO chip change) and reads the rendered `<svg>` `<text>` labels + `<polyline>` point counts at "All" vs "10w":

```
[PROBE all]  x-axis labels start: 02/06/25, 11/08/25, 20/10/25, 29/12/25, 09/03, 18/05, 01/06
[PROBE all]  e1RM polyline point-counts: [53, 53, ...]
[PROBE 10w]  x-axis labels start: 06/04, 13/04, 20/04, 27/04, 04/05, 11/05, 18/05, 25/05, 01/06
[PROBE 10w]  e1RM polyline point-counts: [9, 9, ...]
[PROBE] max polyline points: All=53  10w=9   → expect(maxAll).toBeGreaterThan(max10) PASS
```
The polyline went from **53 points (53-week lifetime axis)** to **9 points (~10-week in-window axis)** with the SAME single series — the old `02/06/25`…`29/12/25` x-labels are GONE at 10w; the axis left edge moved to `06/04` (the first in-window Monday, R-2's both-loops fix). This is geometric redraw, not a legend toggle. The chip-count assertion in the shipped spec is a valid model-derived proxy; this probe is the direct rendered-SVG proof the Reviewer asked for.

**Evidence**: `screenshots/01-all-history.png` (selector with "All" active = `bg-black`, rendered ABOVE "WEEKLY VOLUME PER MUSCLE"), `screenshots/02-window-10w.png` ("10w" active), plus the probe stdout above.

---

## Edge cases

### Edge 1: Empty window keeps the selector mounted (Unknown 6 / R-3)
**Steps**: seed a user whose ONLY data is 40 weeks old; tap "10w" (excludes everything). (Spec test 2.)
**Expected**: both chart sections `return null` (collapse) BUT the page-level selector stays mounted and tappable; "All" brings the charts back.
**Actual**: after the 10w segment goes `bg-black`, both section headers (`Estimated 1RM per exercise`, `Weekly volume per muscle`) have count `0` — sections collapsed; the `Chart window: all history` button is still visible/tappable; tapping it re-renders the e1RM header.
**Result**: **pass** — selector survives both charts going null (it lives at page level above them, F6). `screenshots/03-empty-window.png`.

### Edge 2: Same-series shrink preserves a toggled-off line (MIN-4 / seriesKeysSig stability)
**Steps**: seed one exercise trained both ~8 weeks ago and this week; toggle the `Squat (Barbell)` line OFF (chip gains `opacity-40`); shrink to "10w" (does NOT drop the series). (Spec test 3.)
**Expected**: the series SET is unchanged across the shrink → `seriesKeysSig` stable → the toggled-off line STAYS off (no re-seed to all-on).
**Actual**: after the 10w settle-gate, the `Toggle Squat (Barbell)` chip is still count 1 AND still carries `opacity-40` (off).
**Result**: **pass** — a same-series axis shrink does NOT re-seed visibility (R-4 re-seed only fires when the series SET actually changes, which is intended and covered by W-2/W-4 unit cases).

### Edge 3 (bonus): boundary inclusivity + top-N recompute (unit-level, design edges 1-3)
**Steps**: the W-3 muscle case (`started_at === threshold` IN / `threshold − 1ms` OUT) and the W-4/W-5 e1RM cases (pre-window-only exercise excluded; LOCF lead-in recomputed over the windowed set).
**Result**: **pass** (4 + 4 unit cases green, parsed from the JSON report). These pin the dual-anchor `>=` lower bound and the rank/LOCF recompute that the e2e cannot assert at sub-week granularity.

---

## Regression check (Invariant W end-to-end — the optional param didn't break full-history behavior)

Ran the 4 adjacent specs that touch the same charts/page in one batch (workers:1). All exercise the charts at DEFAULT (`windowStartMs=undefined`):

| Spec | Result | What it proves |
|---|---|---|
| `weekly-muscle-volume.spec.ts` | **4/4 pass** | the per-muscle chart (now receives `windowStartMs` prop) renders full history unchanged at default |
| `e1rm-strength.spec.ts` | **3/3 pass** | the e1RM chart unchanged at default; favorites/pinning intact |
| `progress-page.spec.ts` | **8/8 pass** | the page that now mounts the selector + threads the prop is intact (no DOM-order/locator break) |
| `max-volume-window.spec.ts` | **6/6 pass** | the Profile pref control + the lifted/exported `MAX_VOLUME_WINDOW_LABELS` (F3/F4 dedup) didn't break |

**Total: 21/21, 0 fail, 0 flaky** (`stats: expected 21, unexpected 0, flaky 0`, 115s). Dev server HTTP 200 before and after — no OOM cascade. This is the strongest Invariant-W proof: with the default seed, the two charts and the Profile control behave byte-for-byte as before the feature.

---

## Reviewer hand-off items — all resolved (not handed onward)

- **T-1 (chart actually redraws):** RESOLVED via the SVG-geometry probe — polyline 53→9 points, axis left edge `02/06/25`→`06/04`, same single series (no chip change). Direct rendered-SVG proof. (See Golden path.)
- **T-2 (seed names resolve in the LIVE catalog):** RESOLVED via a service-role probe of `exercises WHERE user_id IS NULL AND deleted_at IS NULL` (95 rows): `Bench Press` FOUND (equipment=barbell, muscles=["Chest"]); `Squat (Barbell)` FOUND (muscles=["Lower back","Legs"]). Both are non-bodyweight → they plot on the e1RM chart (the chips the test asserts on). `pickCanonicalExercise` does NOT throw; the spec ran green without any name substitution. No spec edit needed.
- **T-3 (`bg-black` settle-gate renders on web):** RESOLVED — `toHaveClass(/bg-black/)` resolved correctly on the active segment in every run (3/3 + 9/9 repeat), and `screenshots/01`/`02` show the active segment visibly filled black ("All" then "10w"). rn-web 0.21 emits the NativeWind `bg-black` class on the active `<Pressable>`; the settle-gate locator is sound.

---

## Cross-platform
- **Web**: **pass** — tested via Playwright Chromium (the harness platform). Golden path + 3 edges + 4 regression specs all green; SVG geometry verified.
- **iOS**: **not tested**. Reason: the change is RN-Web-compatible only — two PURE TS presenters gain an optional row-filter param (no I/O, no native API), a stateless `<ProgressWindowSelector>` reusing the Profile segmented-control markup (Profile already ships on iOS/Android), the existing `react-native-svg` `<MultiSeriesChart>` reused as-is, TanStack hooks, and a constant relocation. No native module, no new dependency (design R-5, Risk LOW). The active-state class is the only new visual and it mirrors the verified Profile control idiom.
- **Android**: **not tested** — same reasoning as iOS.

---

## Test commands
- [x] `npm run typecheck` — `tsc --noEmit`, **0 errors**.
- [x] `npm run lint` — **0 errors / 1 warning** (pre-existing `router.d.ts`).
- [x] `npx vitest run` — **485 / 485 pass, 0 fail** (W-0 deepEqual anchors + W-1..W-5 windowing cases all green).
- [x] `npx playwright test progress-window-selector` — **3 / 3 pass**, then **9 / 9 pass** with `--repeat-each=3` (0 flaky).
- [x] `npx playwright test weekly-muscle-volume e1rm-strength progress-page max-volume-window` — **21 / 21 pass, 0 fail** (regression batch).
- [x] (T-1 probe, since removed) SVG-geometry redraw — polyline 53→9 points; passed.

---

## Decision

**PASS**

Reasoning:
- **Golden path proven at the rendered-SVG level**, not just the chip proxy: the e1RM polyline shrinks from 53→9 points and the axis left edge moves from a year ago to ~10 weeks ago on a window change, with the series set held constant. Restoring "All" brings the old chip/data back.
- **All edges pass**: empty-window keeps the selector mounted (R-3), same-series shrink preserves a toggled-off line (MIN-4), boundary inclusivity + top-N/LOCF recompute pinned at the unit level.
- **No regressions**: 21/21 adjacent e2e green at the default window — Invariant W (the load-bearing "looks byte-for-byte like before when `windowStartMs` is undefined") holds both at the unit deepEqual level AND end-to-end through the four sibling specs.
- **Reviewer hand-offs T-1/T-2/T-3 all closed with runtime evidence**; no item left in a `fail`/unverified state.
- Confidence **HIGH** (golden path proven 2 ways — chip proxy + SVG geometry; 0-flake over 12 total runs of the new spec; regression batch clean; T-2 confirmed against the live catalog). Risk **LOW** (presenter changes are skipped-guard-only when `windowStartMs` is absent; the only new UI is a stateless control reusing a verified idiom).

### Untestable / not-covered (explicitly flagged)
- **iOS / Android**: not exercised (web-only harness). Risk LOW per the RN-Web-compatible-only analysis above; not silently marked pass.
- **MIN-1 (W-4 rank-FLIP, two-survivors-swap-order)**: the unit suite proves exclusion + rank-0 recompute (W-4) but does NOT exercise a window where two surviving exercises swap RANK without either dropping. The mechanism (rank recomputes over `byExercise`, built from the guarded loop) is verified-correct; this is a coverage-completeness residual only, flagged by the Reviewer as optional/not-required. Not a defect.
- **R-6 cold-mount seed flicker** (a stored non-zero pref could show "All" for a render until prefs hydrate): not independently reproduced in the e2e (fresh users have no pref → "All" is correct). Accepted-by-design verdict per the Reviewer/Designer; consistent with the page's existing `bestWeekLabel` tolerance. Not a defect.
