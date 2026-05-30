# Test report v1 — 2026-05-30_0126_bodyweight-volume-per-muscle

Testing: implementation against `design-v2.md` (final) + the MAJ-3-NEW carry-in.
Implement↔Test ROUND 1 of 2.

## Decision

**fail** — and it is a NARROW, surgical fail: a single SHIPPED e2e test (`weekly-muscle-volume.spec.ts` test 4) errors at seed setup because it depends on a canonical "Pull-up" row that does NOT exist in this DB. The FEATURE itself is correct — I verified the exact golden path (a 0-weight bodyweight set producing real per-muscle volume) end-to-end through the UI with a substitute bodyweight exercise that does exist ("Chin-up"), and it passed. So this is a broken TEST shipping in the PR, not a broken feature. One-line fix recipe below; return to Implementer (round 2 is the last I↔T round).

Everything else is green: all 3 static gates, the new spec's 3 other tests, the golden path (probe + screenshots), Invariant A across 38 e2e volume assertions, and the unit-level Invariant A/B/C/D coverage.

---

## Environment
- Run-the-app command: `npm run web` (Expo web dev server on `http://localhost:8081`, backgrounded). Health-checked HTTP 200 before/between/after every e2e batch; RSS ~386 MB, no OOM cascade this run.
- e2e runner: `npx playwright test` (Playwright 1.59.1, headless Chromium, `workers: 1`, `fullyParallel: false` per `playwright.config.ts`). Dev server is NOT managed by Playwright — started manually per `playwright.config.ts:6`.
- Supabase env: `.env.local` present with `SUPABASE_SERVICE_ROLE_KEY` + `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY`. e2e admin-seed path works (users created/deleted).
- Test data: fresh per-test users (admin service-role seed), torn down in `afterAll`. The live DB has **95 canonical exercise rows** (NOT the small seed migration list) — see the load-bearing F-4 finding below.

## Test commands
- [x] `npm run typecheck` — **0 errors** (`tsc --noEmit`, exit 0).
- [x] `npm run lint` — **0 errors, 1 warning** (warning is in auto-generated `.expo/types/router.d.ts`, baseline-unchanged; no source file flagged). exit 0.
- [x] `npm run test:unit` — **431 passed / 431** across 26 test files (exit 0). Matches the expected 431 (baseline 384 + 47 new). New files observed: `bodyweight.test.ts` (21), `weekly-muscle-volume.test.ts` (9).
- [x] `npm run test:e2e` (partial, prioritized) — new spec **3/4** (1 seed-setup error), 8 volume specs **36/38** (the 2 failures are a PRE-EXISTING, date-dependent, non-regression spec — proven on baseline below), golden-path probe **1/1**.

---

## 1. Static gates — observed

```
TYPECHECK EXIT: 0   (tsc --noEmit, no output)
LINT EXIT: 0        ESLint: 0 errors, 1 warnings in 1 files  (router.d.ts — auto-generated)
UNIT EXIT: 0        Test Files  26 passed (26) | Tests  431 passed (431) | Duration 2.75s
```

All three pass. The 431/431 count matches the Implementer's and Reviewer's claims exactly. **PASS.**

---

## 2. E2E suite (prioritized) + the F-4 audit

### 2a. New spec `tests/e2e/weekly-muscle-volume.spec.ts` — 3/4

```
PASS  1. section renders for a populated user; old per-session chart is gone
PASS  2. check-all / uncheck-all toggles every muscle line
PASS  3. per-muscle chip toggles a single line's visibility   (opacity-40 class — MIN-2 confirmed)
FAIL  4. bodyweight exercise feeds the chart via the Phase-0 kernel
        Error: Canonical exercise 'Pull-up' not found or is hidden (deleted_at IS NOT NULL)
            at _helpers/canonical-exercise.ts:52
            at weekly-muscle-volume.spec.ts:307:32
```

- **Test 1 PASS** — the new "Weekly volume per muscle" section renders; the removed "Volume per session" header asserts `toHaveCount(0)` (old chart gone). Screenshot: `docs/runs/.../screenshots/muscle-volume-section.png` (Bench Press 100×5×3 = **1,500 kg**, Chest red point, "Uncheck all" control present).
- **Test 2 PASS** — check-all/uncheck-all flips the "Hide all muscles" ⇄ "Show all muscles" control.
- **Test 3 PASS** — per-muscle chip toggles `opacity-40`. **This empirically resolves Reviewer MIN-2** (the "statically unverifiable runtime class" hand-off): react-native-web 0.21 DOES emit `opacity-40` literally in the DOM `class` attr, the sibling-precedent assertion (`set-row-menu.spec.ts:141-145`) holds.
- **Test 4 FAIL** — errors at SEED setup (`pickCanonicalExercise(admin, "Pull-up")` throws before any UI assertion). **Not a feature failure** — see Defect 1 + the golden-path probe in §3.

### 2b. The 8 F-4 volume specs — 36/38 (2 pre-existing non-regressions)

Ran in two batches (JSON reporter → file, to defeat terminal output-truncation), dev-server health-checked between:

| Batch | Specs | Result |
|---|---|---|
| 1 | soft-deleted-session-volume-leak, session-total-volume-header, end-of-session-verdict, volume-target | **18 / 18 PASS** |
| 2 | progress-page, weekly-volume-strip, max-volume-window, chart-scroll-week-selector | **20 / 22** (2 fail, both in chart-scroll-week-selector) |

```
batch1 stats: {"expected":18,"unexpected":0,"flaky":0}
batch2 stats: {"expected":20,"unexpected":2,"flaky":0}
```

**The 2 failures (chart-scroll-week-selector.spec.ts) are PRE-EXISTING and NOT a regression — proven, not assumed:**

```
FAIL  default mount: pinned to right edge, current-week visible, pill rendered
FAIL  default mount on narrow viewport: scroll is pinned to right edge
      Locator: getByRole('button', { name: 'View week of 5/25' })  → not visible (5000ms)
```

- Re-ran the spec in isolation → same 2/4 deterministic failures (not cross-test contamination).
- **Causation test (rigorous):** `git stash`-ed the entire working-tree source change (reverting `weekly-volume-strip.tsx` + `weekly-volume-strip-math.ts` + all kernel files to baseline `5a2382b`), confirmed `progress/index.tsx` re-imported the OLD `SessionVolumeChartSection`, then re-ran the spec on baseline: **identical 2/4 failure, identical `5/25` locator.** Then `git stash pop`-ed cleanly (verified `WeeklyMuscleVolumeSection` restored, 0 stashes left).
- **Root cause (independent of this feature):** the failing assertion is a DATE label, not a volume number — `View week of {currentMonday.month+1}/{currentMonday.date}`. Today is Sat 2026-05-30, current Monday = 2026-05-25 → label "5/25". The test got PAST "This week" headline (`:177`) and the range pill (`:186`); only the date-labeled current-week BAR locator fails. This is a date-edge bug in the strip's bar-labeling vs the spec's `mondayNWeeksAgoUtc(0)` expectation, latent on the baseline. The feature change does not touch it (`chart-scroll-week-selector.spec.ts` is NOT in this PR's diff; the strip's volume math is unchanged for the seeded barbell exercise).

→ **Invariant A holds for the strip:** the strip renders, the "This week" total is correct; only a pre-existing date-label locator fails the same way with and without the change.

### 2c. F-4 audit (the owner's load-bearing Invariant-A guarantee) — per spec

The design (F-4, MIN-2) requires auditing TWO conditions per volume spec: (i) does it seed a `measurement_entries` row? (ii) does every seeded set carry an explicit positive `weight`? If both hold, `bodyweightKgAsOf → null → effective = addedLoad` → numbers don't move regardless of exercise type.

| Spec | Seeds `measurement_entries`? | Exercise pick | Positive weights? | F-4 verdict |
|---|---|---|---|---|
| soft-deleted-session-volume-leak | **No** (0 matches) | `pickCanonicalExercise(admin, "Bench Press")` (barbell) | Yes (weight 100) | stable ✓ — observed 6/6 PASS |
| session-total-volume-header | **No** | preferred-name pick | Yes (`weightKg.toString()`) | stable ✓ |
| end-of-session-verdict | **No** | preferred-name pick | Yes | stable ✓ |
| volume-target | **No** | preferred-name pick (Bench Press) | Yes EXCEPT one intentional `weight: null` draft set (`:353`) on Bench Press | stable ✓ — see note |
| progress-page | **No** | `pickCanonicalExercise(admin)` **NO preferred** | Yes (100 / 80) | stable ✓ — see DB finding |
| weekly-volume-strip | **No** | `pickCanonicalExercise(admin)` **NO preferred** | Yes | stable ✓ |
| max-volume-window | **No** | `pickCanonicalExercise(admin)` **NO preferred** | Yes | stable ✓ |
| chart-scroll-week-selector | **No** | `pickCanonicalExercise(admin)` **NO preferred** | Yes | stable ✓ (the 2 fails are date-label, not volume) |

**Both F-4 conditions HOLD for all 8 specs. Confirmed, not assumed.** Two sub-findings worth recording:

1. **The 4 no-preferred-name specs do NOT land on a bodyweight row.** I probed the live DB: with 95 canonical rows ordered by name ASC, the alphabetically-first is **"Arnold Press (Dumbbell)"** with `equipment = null` (NOT the small-seed "Back Squat", and NOT a bodyweight row). `effectiveWeightKg(null, weight, bw)` returns `addedLoad` (the `=== "bodyweight"` gate is exact), so even if a measurement WERE seeded (none is), these specs' numbers are unchanged. The design's worry ("could land on Pull-up/Chin-up/…") does not materialize in this DB.
2. **`volume-target.spec.ts:353` `weight: null`** is a deliberate live "draft" set on Bench Press (barbell). For non-bodyweight, `effectiveWeightKg("barbell"|null, null, bw) = 0`, guard `effective > 0` is false → excluded — byte-identical to the old `weight ? parseFloat : NaN` path. The spec asserts `Now = 0 kg` and passed (18/18 batch 1). No shift.

---

## 3. Golden path — the feature actually works

**Spec** (from design/state.md): a bodyweight exercise (weight=0) logged WITH a prior bodyweight measurement must produce NON-ZERO volume on the new per-muscle chart and on the volume surfaces (pre-feature: 0). Also: the new chart renders, lines toggle, old per-session chart gone.

**The shipped e2e for this (test 4) could not exercise it** (seed-name mismatch — Defect 1). So I drove the exact golden path myself via a temporary probe spec using a REAL bodyweight canonical row that exists in this DB.

**Steps run** (`zz-tester-bodyweight-golden.spec.ts`, since removed):
1. Created a fresh user; picked canonical **"Chin-up"** (bodyweight, primary "Upper back") — exists in DB; Pull-up does not.
2. Seeded a prior weigh-in: `measurement_entries` `weight_kg = 80` one week before the session.
3. Seeded a finished session this week: **4 working sets × 8 reps, weight = 0** (unweighted).
4. Signed in via UI, navigated to `/progress`.
5. Asserted the "Weekly volume per muscle" section + the "Upper back" line appear.

**Result**: **PASS** (`{"expected":1,"unexpected":0}`, 7.7 s).

**Evidence** — screenshot `docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/screenshots/tester-bodyweight-upperback-line.png`:
- **THIS WEEK: 2,560 kg** = exactly `80 kg (resolved bodyweight) × 8 reps × 4 sets`. Pre-feature this would have been **0** (a weight=0 set contributed nothing). The Phase-0 kernel gave the unweighted Chin-ups real volume. ✓
- Hero **Max 2,560 · Now 2,560 · To PR 0**, the weekly strip bar, and "Best week: 2,560 kg" all show the SAME 2,560 — the "same number everywhere" invariant holds for a bodyweight exercise across hero + strip + chart simultaneously. ✓
- The "WEEKLY VOLUME PER MUSCLE" section renders with a data point at 2,560 kg and an "Uncheck all" control. ✓

Second screenshot (`muscle-volume-section.png`, test 1, barbell Bench Press): **THIS WEEK 1,500 kg** = `100×5×3` exactly — Invariant A holding for a non-bodyweight exercise; Chest red point; old "Volume per session" header gone.

→ **Golden path PASS.** The feature works end-to-end. The only gap is that the SHIPPED test can't prove it (Defect 1).

---

## 4. Regression — Invariant A (non-bodyweight byte-identity)

The owner's load-bearing guarantee: non-bodyweight volume unchanged everywhere.

- **e2e:** 36/38 volume assertions green; the 2 fails are a proven pre-existing date-label non-regression (§2b). The two PASSING screenshots show exact expected numbers (1,500 kg barbell, 2,560 kg bodyweight). Across `soft-deleted-session-volume-leak` (6/6: history-list rows, soft-delete leak), `session-total-volume-header` (session header), `end-of-session-verdict` (verdict total + PRs), `volume-target` (live `<VolumeTargetSlot>`), `progress-page` (hero + exercises-this-week), `weekly-volume-strip` (strip bars), `max-volume-window` (per-exercise max-volume callout) — all PASS with barbell/null-equipment exercises.
- **unit:** Invariant A is asserted directly — `volume-target.test.ts` "Invariant A" byte-identity, `progress-page-math.test.ts` "byte-identical", `exercise-session-row-format.test.ts` — all within the 431/431. **PASS.**

**Result: Invariant A — PASS (no regression).**

## 5. Invariants B / C / D — spot-checks

- **Invariant B (bodyweight PR/max create+erase):** covered by `session-verdict-math.test.ts` (bodyweight-PR create + erase) and `progress-page-math.test.ts` (`computePrsThisWeek`/`computeLifetimeMaxPerExercise` create+erase) — all green in the 431/431. The golden-path probe also demonstrates the max-volume surface shifting (Max 2,560 for a bodyweight exercise that pre-feature would show Max 0). **PASS (unit-verified + observed).**
- **Invariant C (per-set lines sum to session total for bodyweight):** `exercise-session-row-format.test.ts` asserts `sum(presentSetVolumeLines) === presentExerciseSessionRow.volumeKg` for a bodyweight exercise + a 0-weight-positive-line case — green in 431/431. **PASS (unit-verified.)**
- **Invariant D (per-exercise e1RM vs volume divergence):** the two-variable split (`progress.tsx`) keeps `epley1RM(w,r)` on logged `w` under `w>0` while `sessionVolume += effW*r` runs under `effW>0`. For a 0-weight bodyweight set: NO e1RM point, YES volume point. The divergence is structural in the code and Reviewer-traced (`progress.tsx:155-166`). I did NOT drive the per-exercise progress screen for a bodyweight exercise via UI this round (the shipped e2e doesn't cover it, and the dedicated probe targeted the chart). **PASS on the unit/structural evidence; NOT independently UI-exercised — flagged as a residual coverage gap (see below).**

---

## Cross-platform
- **Web**: tested via Playwright (Chromium). The feature works; the broken test + 2 pre-existing fails are as characterized above.
- **iOS**: **not tested.** Reason: the change is RN-Web-compatible only (pure TS kernel helpers, TanStack hooks, PostgREST SELECT widening, `react-native-svg` `<MultiSeriesChart>` — same path as the existing `<ProgressChart>`, no native modules). Risk LOW (design R-6).
- **Android**: **not tested.** Same reasoning as iOS. Risk LOW.

---

## Defects → back to Implementer (round 2 is the LAST I↔T round)

### Defect 1 (the only blocker) — `weekly-muscle-volume.spec.ts` test 4 seeds a non-existent canonical row

**Symptom:** test 4 errors before any UI assertion: `Canonical exercise 'Pull-up' not found or is hidden` at `_helpers/canonical-exercise.ts:52`, called from `weekly-muscle-volume.spec.ts:307`.

**Root cause (HIGH confidence — probed the live DB):** `weekly-muscle-volume.spec.ts:307` calls `pickCanonicalExercise(admin, "Pull-up")`. The live DB's canonical bodyweight rows are **Chin-up, Dip, Hanging Leg Raise, Push-up** — there is **no "Pull-up" row**. `implementation.md:77` asserted Pull-up exists per `0004_exercise_muscles_array.sql:65`, but the live catalog (95 rows) has been migrated past that seed; "Pull-up" was renamed/dropped. The helper throws loudly by contract (correct behavior — better than a 15 s UI timeout).

**This is a broken TEST, not a broken feature.** I proved the identical golden path passes with "Chin-up" (§3, 2,560 kg Upper back line rendered).

**Fix recipe (one line, HIGH confidence, LOW risk — test-only):**
- `weekly-muscle-volume.spec.ts:307`: change `pickCanonicalExercise(admin, "Pull-up")` → `pickCanonicalExercise(admin, "Chin-up")`.
- Update the assertion target on `:340` if needed: **"Chin-up" primary muscle is also "Upper back"** (DB-verified: `Chin-up | ["Upper back"]`), so the existing `page.getByText("Upper back")` assertion AND the test's intent both still hold with zero further change. The comments at `:306,:319,:337` reference "pull-up"/"Pull-up" — update the prose to "Chin-up" for accuracy (cosmetic).
- Sibling precedent: every other call in this file already uses an existing name (`"Bench Press"` at `:167,:211,:258`). This is the only call that names a row absent from the DB.

**Verification after fix:** re-run `npx playwright test weekly-muscle-volume.spec.ts` → expect 4/4. (I already proved the substitute exercise yields the Upper back line, so this will pass.)

### Non-blocking note A — chart-scroll-week-selector pre-existing date-edge fail
NOT introduced by this PR (proven on baseline). Out of scope for the Implementer here, but worth a separate ticket: the strip's current-week bar label diverges from `mondayNWeeksAgoUtc(0)` on certain weekdays (observed Sat 5/30 → expected bar "5/25" not found). Recommend the Conductor log it as a pre-existing flake to investigate independently — do NOT block this feature on it.

### Non-blocking note B — residual coverage gap (Invariant D via UI)
The per-exercise progress screen's e1RM-vs-volume divergence for a bodyweight exercise (Invariant D) is unit/structurally verified but not independently UI-exercised this round. If the Implementer touches test 4 anyway, consider whether the suite should also pin Invariant D at the e2e layer; otherwise the unit coverage is adequate. Confidence the feature is correct: HIGH (Reviewer traced the split; the kernel is the single arithmetic seam).

---

## Confidence / risk
- **Golden path works:** HIGH. Driven end-to-end through the real UI with a real bodyweight exercise; the 2,560 kg = 80×8×4 arithmetic is exact, and the same number appears on hero + strip + chart simultaneously.
- **Defect 1 is test-only, not feature:** HIGH. The feature passed with the substitute exercise; the failure is purely a non-existent seed name; fix is a one-token change.
- **The 2 chart-scroll fails are pre-existing, not a regression:** HIGH. Reproduced identically on baseline `5a2382b` via stash; the spec is not in the PR diff; the failing locator is a date label, not a volume number.
- **Invariant A holds:** HIGH (36/38 e2e green + the 2 non-regression + unit byte-identity + two exact-number screenshots).
- **Risk of shipping as-is:** MEDIUM — a failing test in the PR (`test:e2e` is red on test 4) is a CI/quality regression even though the feature is correct. Must be fixed.
