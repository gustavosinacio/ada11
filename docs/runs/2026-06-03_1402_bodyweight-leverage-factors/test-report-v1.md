# Test report v1 — 2026-06-03_1402_bodyweight-leverage-factors

## DECISION: **PASS**

Golden path (leverage factor applied end-to-end on the live migrated DB) passes; both
hand-off live checks (T-A string/number-shape, T-B retroactive appearance) pass with the
exact leveraged numbers; backfill sanity (T-C) re-confirmed clean; 52/52 regression e2e
across 12 specs, 0 flaky; Invariant L (non-bodyweight byte-for-byte) and Invariant D (e1RM
unchanged) both confirmed dynamically. Static gates green at **505/505**.

Testing: implementation against `design-v2.md` + the Reviewer's 5-item Tester hand-off
(`review-v1.md:118-124`).

---

## Environment
- Run-the-app command: `npm run web` (Expo web, Metro bundler, http://localhost:8081 — HTTP 200 throughout; no OOM cascade this run).
- Unit runner: `npx vitest run` (custom reporter prints `PASS (n) FAIL (n)`; per-test detail via `--reporter=json --outputFile`).
- E2E runner: `npx playwright test` (Chromium, headless, workers=1; clean JSON via `PLAYWRIGHT_JSON_OUTPUT_NAME` to dodge the dotenvx stdout banner).
- DB: live project `ykrbgpctbfvndxjnpzrg`, migration 0021 **already applied** (per brief; NOT re-applied by me). Read/seed via the service-role admin client, system-under-test via the user (anon) client + UI sign-in — the standard sibling-spec harness.
- Test data: fresh confirmed users seeded per probe + the canonical catalog; all probe users cleaned up by `afterAll` (verified 0 leftover).

---

## Static gates (all green)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **0 errors** (clean exit, no output) |
| Lint | `npm run lint` (`expo lint`) | **0 errors, 1 warning** — the pre-existing `router.d.ts` auto-generated warning (baseline-unchanged); exit 0 |
| Unit | `npx vitest run` | **PASS (505) FAIL (0)** — matches baseline 485 + 20 new (bodyweight leverage block +13, volume-target-factor +7) |

The exact 505 = 485 baseline + 20 new is consistent with the Implementer/Reviewer claims; I re-ran the FULL suite (not spot), and it returned `PASS (505) FAIL (0)`.

---

## The new cross-surface unit test — verified NOT a false-green

`tests/unit/volume-target-factor.test.ts` — JSON breakdown (all 7 RUN, none skipped):
```
numTotalTests 7 passed 7 failed 0
passed :: ROW path: row.exercises.bodyweight_factor = '0.64' ⇒ 512
passed :: MAP path: factorByExerciseId Map([['pushup', 0.64]]) ⇒ 512
passed :: prop path: presentSetVolumeLines({ factor: '0.64' }) ⇒ 512
passed :: verdict/live-header path: computeCurrentSessionVolumeByExercise ⇒ 512
passed :: all four surfaces return the SAME number (512)
passed :: a 0-logged-weight bodyweight set produces NO e1RM point regardless of factor
passed :: a weighted bodyweight set derives e1RM from the logged weight only (factor-independent)
```

I confirmed the **teeth** with a throwaway runtime probe (since removed) driving the REAL kernels with the STRING `"0.64"`, and contrasting against the full-BW (bug) number:
```
seam('bodyweight','0',80,'0.64') = 51.2   (leveraged; full-BW would be 80)
seam WITHOUT factor (v1 bug shape) = 80    (full-BW — the un-leveraged number)
prop path total = 512                      (expect 512; full-BW=800)
MAP path total = 512                       (expect 512)
MAP path, factor MISSING from map (un-wired desync) = 800  (the test WOULD catch a desync)
```
So the cross-surface `512` assertion is genuinely load-bearing: a string-drop seam → 800, an un-wired surface → 800. The 512-vs-800 gap (288 kg) makes both failure modes loud. The MAP/prop/verdict surfaces thread the string end-to-end; the ROW surface threads `row.exercises.bodyweight_factor = "0.64"` through `bucketLifetimeWeeklyVolumes`. NOT a false-green.

> **Caveat on the e1RM unit cases (matches Reviewer MIN-1):** the two "e1RM unchanged" cases (`:206-222`) assert tautologies — `expect(0 > 0).toBe(false)` and `expect(epley1RM(20,5)).toBe(epley1RM(20,5))` — they DOCUMENT Invariant D but do not drive the production e1RM reduce with-vs-without a factor, so they wouldn't catch a future factor-leak into the e1RM branch. I closed this dynamically instead: Invariant D is proven LIVE by `e1rm-strength.spec.ts` 3/3 (below) + static read of `progress.tsx:198-209` (separate `w = parseFloat(set.weight)` variable). The VOLUME cross-surface cases (surfaces 1-4) DO have teeth.

---

## Live close-loop (the point of applying the migration)

### Golden path / T-A — string-shape live: the factor is APPLIED end-to-end ✅ PASS
**Spec:** a Push-up (`bodyweight_factor = 0.64`) bodyweight set must contribute `bodyweight × 0.64 × reps`, NOT full bodyweight, on a real rendered surface fed by real PostgREST data.

**Steps:** seeded a fresh user with an 80 kg weigh-in (prior) + a live workout session with one CHECKED Push-up working set (weight 0, reps 10), signed in via the UI, purged the persisted cache, navigated to the live session, asserted the `<SessionHeader>` total-volume a11y label.

**Expected:** `Session total volume: 512 kg` (= 80 × 0.64 × 10). Full-BW bug would show `800 kg`.

**Result:** **pass** — header rendered **512 kg**; the `800 kg` label count was 0.

**Evidence:**
```
PASS :: T-A: Push-up (0.64) renders leveraged 512 kg, NOT full-BW 800 kg
stats: {"expected":2,"unexpected":0,"flaky":0}
```
Screenshot `docs/runs/2026-06-03_1402_bodyweight-leverage-factors/screenshots/ta-pushup-leveraged-512.png` — header reads **Volume 512 kg** for "Push-up · Bodyweight", set weight blank (0), Reps 10. This is the runtime proof the factor seam works on the live `numeric` column (a `number`-only OR string-dropping seam would have shown 800).

This exercises **builder #1** (`app/(app)/workout/[sessionId].tsx`, a MAJ-1 site) — the live session-header total — through the parallel `factorByExerciseId` map fed to `sumLiveVolume`.

> **Notable finding (not a defect):** this PostgREST instance returns `bodyweight_factor` (and the sibling `sets.weight`) as a JSON **`number`** (`typeof=number`, e.g. `0.64`), NOT a string — contradicting the design's MAJ-2 premise ("`numeric` reads back as a STRING") and the documented `db/types.ts:93-95` convention. **The feature is correct regardless** because the seam handles BOTH (`typeof factor === "string" ? parseFloat(factor) : factor`), which the design itself called "strictly safer with zero downside." So the string-aware shape was conservative-safe, not wrong. T-A's `512 kg` is the empirical close: the actual live value flows through the seam correctly whatever its JSON type. (Confidence HIGH — observed directly via two read-only probes on `exercises.bodyweight_factor` and `sets.weight`.)

### T-B — R-1 retroactive appearance of reclassified movements ✅ PASS
**Spec:** the 3 reclassified movements (Pull Up, Chest Dip, Hanging Knee Raise) now count bodyweight volume where they counted ZERO before.

**Steps:** seeded a fresh user with an 80 kg weigh-in + a live session with one CHECKED Pull Up working set (weight 0, reps 8), signed in, navigated, asserted the header.

**Expected:** `Session total volume: 640 kg` (= 80 × 1.0 × 8). Pre-migration `equipment=NULL` ⇒ `0 kg`.

**Result:** **pass** — header rendered **640 kg**; the `0 kg` label count was 0.

**Evidence:**
```
PASS :: T-B: reclassified Pull Up (1.0) now contributes 640 kg (was 0 pre-migration)
```
Screenshot `screenshots/tb-pullup-reclassified-640.png` — header reads **Volume 640 kg**; the exercise card subtitle reads "Upper back, Arms · **Bodyweight**", confirming the `equipment=null → bodyweight` reclassification took effect (the Bodyweight tag now shows AND the set carries volume). This is the "newly APPEARS" behavior the design flagged (MIN-4 / R-1) — a NEW contribution, not just a shifted number.

### T-C — backfill sanity (read-only live query) ✅ PASS
Re-confirmed the 7 canonical rows via a read-only service-role query (NO mutation, NO `db:push`):
```
rows returned: 7 (expect 7)
OK  Push-up              equipment=bodyweight  bodyweight_factor=0.64  (typeof=number)
OK  Dip                  equipment=bodyweight  bodyweight_factor=1     (typeof=number)
OK  Chin-up              equipment=bodyweight  bodyweight_factor=1     (typeof=number)
OK  Pull Up              equipment=bodyweight  bodyweight_factor=1     (typeof=number)
OK  Chest Dip            equipment=bodyweight  bodyweight_factor=1     (typeof=number)
OK  Hanging Leg Raise    equipment=bodyweight  bodyweight_factor=0.5   (typeof=number)
OK  Hanging Knee Raise   equipment=bodyweight  bodyweight_factor=0.5   (typeof=number)

T-C RESULT: PASS — all 7 rows backfilled + bodyweight
```
All 7 present, all `equipment='bodyweight'` (incl. the 3 reclassified: Pull Up / Chest Dip / Hanging Knee Raise), all factors exact (Push-up 0.64; four 1.0; two 0.50). No drift since the Conductor/Implementer/Validator checks.

---

## Edge cases (beyond the golden path)

### Edge 1: Dip at factor 1.0 == today (full BW, no magnitude change) — pass
**Covered by** `bodyweight.test.ts` cases 3/4 (`"1.0"` ⇒ 80; weighted dip `"30",80,"1.0"` ⇒ 110, belt unscaled) + the live `session-total-volume-header.spec.ts` 5/5 (non-bodyweight Bench Press 100×5 = **500 kg** byte-for-byte unchanged — the f=1/absent identity on a real surface). Only Push-up (0.64) and the two 0.50 movements change magnitude; the four 1.0 movements are identical to pre-feature. **pass**.

### Edge 2: Coalesce-to-1.0-NEVER-0 / non-finite + NULL factor ⇒ 1.0 (Invariant L safety) — pass
**Covered by** `bodyweight.test.ts` cases 6-9 (NULL ⇒ 80, undefined ⇒ 80, `"abc"`/NaN/±Infinity ⇒ 80, stored `"0"` honored ⇒ 80×0+10 = 10). Re-confirmed by the runtime probe (`seam WITHOUT factor = 80`). A coalesce to 0 would zero all bodyweight volume — it does not. **pass**.

### Edge 3: addedLoad NEVER scaled (weighted bodyweight) — pass
`effectiveWeightKg("bodyweight","10",80,"0.64") === 61.2` (= 80×0.64 + 10), NOT `(80+10)×0.64 = 57.6`. The belt/vest load is leveraged at 1.0. **pass** (`bodyweight.test.ts` case 2; runtime probe consistent).

### Edge 4 (bonus): un-wired-surface desync would be caught — pass
The runtime probe showed a MAP with the factor MISSING returns 800 (full-BW). Because `factorByExerciseId` is REQUIRED on `SetBodyweightInput`, the passing typecheck (0 errors) independently proves all 6 builders are wired; the live T-A/T-B + the 4-surface unit case provide the dynamic confirmation. **pass**.

---

## Regression check — 52/52, 0 flaky (12 specs, 3 batches)

Server health-checked `200` before each batch; partitioned to avoid the OOM-cascade pattern flagged in prior runs (it did NOT recur — server stable throughout).

| Batch | Spec | Result | Why it's the regression surface |
|---|---|---|---|
| 1 | `weekly-muscle-volume.spec.ts` | **4/4** | per-muscle chart shares `effectiveWeightKg` (Phase-0 bodyweight kernel) |
| 1 | `e1rm-strength.spec.ts` | **3/3** | **Invariant D** — e1RM must be unchanged; the chart sits next to the factor reduce |
| 1 | `progress-page.spec.ts` | **8/8** | Progress page totals + the ROW-fed `use-progress-page` site |
| 2 | `max-volume-window.spec.ts` | **6/6** | PR / max-volume window over the volume kernel |
| 2 | `progress-window-selector.spec.ts` | **3/3** | windowed re-compute over the same charts |
| 2 | `end-of-session-verdict.spec.ts` | **2/2** | builder #2 — verdict total + PR detection (`computeCurrentSessionVolumeByExercise`) |
| 2 | `week-drill-down.spec.ts` | **5/5** | history-week ROW-fed reduce (`history/week/[isoWeek]`) |
| 3 | `weekly-volume-strip.spec.ts` | **4/4** | the strip ROW-fed reduce |
| 3 | `volume-target.spec.ts` | **7/7** | builder #5 — `<VolumeTargetSlot>` + `computeVolumeTarget` |
| 3 | `session-total-volume-header.spec.ts` | **5/5** | builder #1 — live header; **Invariant L** on non-bodyweight (Bench Press 500/600 kg byte-for-byte) |
| 3 | `read-only-history.spec.ts` | **5/5** | History session-detail (builder #3) read path |

Batch stats: `{"expected":15,"unexpected":0,"flaky":0}` + `{"expected":16,"unexpected":0,"flaky":0}` + `{"expected":21,"unexpected":0,"flaky":0}` = **52 expected / 0 unexpected / 0 flaky**.

- **Invariant L (non-bodyweight + NULL-factor byte-for-byte):** confirmed live — `session-total-volume-header` (Bench Press 100×5=500, 120×5=600), `max-volume-window`, `volume-target`, `progress-page` all show today's exact barbell numbers; the new 4th arg coalesces to 1.0 for non-bodyweight (never read off the bodyweight branch).
- **Invariant D (e1RM unchanged):** confirmed live — `e1rm-strength.spec.ts` 3/3; the factor never touches `epley1RM` (`progress.tsx` uses a separate logged-weight variable; `e1rm-strength.ts` not in the diff).
- **6-builder coverage proven live:** builder #1 (T-A/T-B + session-header), #2 (verdict), #3 (read-only-history), #5 (volume-target) all exercised; #4 is type-only (forwards opaquely); #6 is unit-covered (prop path, surface 3).

---

## Cross-platform
- **Web:** pass — tested via Playwright Chromium (the harness platform) + Expo web.
- **iOS:** not tested — reason: the change is RN-Web-compatible only and platform-agnostic by construction. The seam is pure arithmetic (`effectiveWeightKg`), the threading is TanStack hooks + PostgREST `select`/Map builds, the migration is SQL; no native module, no SVG, no platform API, no new dependency (design R-6: "no iOS/Android/web divergence"). Risk LOW.
- **Android:** not tested — same reasoning as iOS. Risk LOW.

---

## Test commands
- [x] `npm run typecheck` — 0 errors.
- [x] `npm run lint` — 0 errors, 1 pre-existing `router.d.ts` warning.
- [x] `npm run test:unit` (`vitest run`) — **505/505**; new cross-surface file 7/7 (JSON-verified, not skipped).
- [x] `npm run test:e2e` (subset, 12 specs, 3 batches) — **52/52, 0 flaky**.
- [x] Live close-loop probe (throwaway spec, since removed) — T-A 512 kg + T-B 640 kg, both pass; screenshots saved.
- [x] Live read-only backfill query (throwaway tsx, since removed) — T-C 7/7 rows.

---

## Untestable / not-covered (flagged, NOT marked pass)
- **iOS / Android runtime** — web-only harness; reasoning above (Risk LOW, pure-arithmetic + column-read change).
- **e1RM unit-case teeth (Reviewer MIN-1)** — the two `volume-target-factor.test.ts` e1RM cases assert tautologies, not the production reduce. Invariant D is instead proven dynamically (`e1rm-strength.spec.ts` 3/3) + statically (`progress.tsx:198-209` separate variable). Residual: a future factor-leak into the e1RM branch would NOT be caught by THOSE two unit cases (it would be caught by the e1rm-strength e2e if it changed a rendered point). Coverage residual, not a defect.
- **Other reclassified movements live (Chest Dip, Hanging Knee Raise)** — T-B proved Pull Up; the other two share the identical reclassify mechanism + were confirmed `equipment='bodyweight'` with correct factors in T-C, but I did not drive them through a rendered surface individually (same code path as Pull Up). Confidence HIGH they behave identically; not independently UI-exercised.

---

## Decision

**PASS** — recommend **finalize**.

Reasoning:
- Golden path (T-A): the leverage factor is applied end-to-end on the live migrated DB — a Push-up renders **512 kg** (leveraged), not 800 kg (full-BW). The string→number seam works on real PostgREST data; screenshot evidence.
- T-B: the reclassified Pull Up renders **640 kg** where it was 0 pre-migration; the Bodyweight tag now shows. R-1 retroactive appearance confirmed.
- T-C: all 7 canonical rows backfilled + `bodyweight`, exact factors, no drift.
- Static gates green (505/505 unit, 0 typecheck/lint errors); the cross-surface unit case has empirically-proven teeth (512 vs 800).
- 52/52 regression e2e, 0 flaky; Invariant L (non-bodyweight byte-for-byte) and Invariant D (e1RM unchanged) both confirmed dynamically.
- The one notable finding (live DB returns the factor as a JS `number`, not a string) is NOT a defect — the seam handles both, so the feature is correct; it just means the design's string-aware shape was conservative rather than load-bearing for THIS instance. No production-code change warranted.

Confidence HIGH on the golden path + invariants (live rendered numbers + 52/52 regression + 505 unit). Risk LOW on shipping. No I↔T round-2 needed.
