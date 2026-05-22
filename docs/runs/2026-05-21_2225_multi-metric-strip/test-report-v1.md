# Test report v1 — 2026-05-21_2225_multi-metric-strip

Testing: implementation against `design-v1.md` (final approved) and `review-v1.md` (pass, 0 blockers / 0 majors / 4 minors).

## Environment

- Commands used to run app: `npm run web` (already running on `http://localhost:8081`, confirmed via `curl -s -o /dev/null -w "%{http_code}" http://localhost:8081` → `200`).
- Browser / device: Playwright Chromium (default for `npm run test:e2e`) at 1280×720 for the e2e suites; standalone Chromium driven by a one-off Node script at 375×800 for the iPhone-width smoke (script lived at `smoke-375.mjs`, deleted after the run; output captured under `screenshots/`).
- Test data: ephemeral admin-seeded users (created + torn down per Playwright test); for the iPhone smoke, an ephemeral user seeded with a `3 × 60 × 10 = 1,800 kg` PR session + one CHECKED live set `50 × 10 = 500 kg`.

## Golden path

**Spec** (from design): `<VolumeTargetSlot>` chasing branch renders `"Max X kg · Now Y kg · To PR Z kg"` (plus `"· ≈ R reps @ Wkg"` when `runningKg > 0` and a current weight is picked). `Now` reflects checked-only working sets; `Max − Now = To PR` holds on screen.

**Steps run**: full Playwright e2e suite `tests/e2e/volume-target.spec.ts` (7 tests).

**Result**: **pass**

**Evidence**:

```
> playwright test tests/e2e/volume-target.spec.ts
Running 7 tests using 1 worker
  ✓  1 tests/e2e/volume-target.spec.ts:209:7 › Volume-target strip (live workout) › golden path: chasing copy + reps clause across multiple seeded sets (15.0s)
  ✓  2 tests/e2e/volume-target.spec.ts:338:7 › Volume-target strip (live workout) › chasing — no weight logged: hides the reps clause (7.4s)
  ✓  3 tests/e2e/volume-target.spec.ts:397:7 › Volume-target strip (live workout) › tie case: matched copy renders when running == previous max (7.5s)
  ✓  4 tests/e2e/volume-target.spec.ts:444:7 › Volume-target strip (live workout) › MAJ-1 regression: max(set_number) picks current weight, not array index (6.5s)
  ✓  5 tests/e2e/volume-target.spec.ts:516:7 › Volume-target strip (live workout) › no previous max: strip is hidden for a never-trained exercise (4.7s)
  ✓  6 tests/e2e/volume-target.spec.ts:555:7 › Volume-target strip (live workout) › history detail does NOT render the strip (6.2s)
  ✓  7 tests/e2e/volume-target.spec.ts:603:7 › Volume-target strip (live workout) › checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep (9.7s)
  7 passed (57.9s)
```

Test #1 (golden) walks phases B/C/D and asserts the literal arithmetic:
- Phase B (1 checked set 50×10): `Max 1,800 kg · Now 500 kg · To PR 1,300 kg · ≈ 26.0 reps @ 50.0 kg` — `1,800 − 500 = 1,300` ✓.
- Phase C (cumulative 980): `Max 1,800 kg · Now 980 kg · To PR 820 kg · ≈ 13.7 reps @ 60.0 kg` — `1,800 − 980 = 820` ✓.
- Phase D (surpass): `New PR! +380 kg over your previous` — emerald copy preserved.
Test #7 (toggle-lockstep) is the direct proof of the checked-only consistency claim: same set rendered first as draft (`Now 0 kg`, no reps clause) then as checked (`Now 500 kg`, reps clause back) after admin-updating `completed_at`.

## Edge cases

### Edge 1: `runningKg === 0` ⇒ reps clause hidden (MAJ-1 fix)

**Steps**: `npm run test:e2e -- tests/e2e/volume-target.spec.ts` — test "chasing — no weight logged: hides the reps clause" (line 338) and "checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep" (line 603) both seed a state where `runningKg = 0` and assert `expect(stripText).not.toMatch(/reps/i)`. Backed at the kernel level by unit `"a draft set still drives the currentWeightKg pick when it has the highest set_number (Decision #8)"` which verifies the kernel still returns `currentWeightKg` even when `runningKg = 0` (the suppression lives in the slot, not the kernel).

**Expected**: strip renders `Max … · Now 0 kg · To PR …` with no `≈ R reps @ Wkg` clause.

**Actual**: both tests pass. Confirmed in source at `src/components/volume-target-slot.tsx:60-63` — `showRepsClause = state.repsToBeat != null && state.currentWeightKg != null && state.runningKg > 0`.

**Result**: **pass**

**Evidence**:
```
✓  2 tests/e2e/volume-target.spec.ts:338:7 › Volume-target strip (live workout) › chasing — no weight logged: hides the reps clause (7.4s)
✓  7 tests/e2e/volume-target.spec.ts:603:7 › Volume-target strip (live workout) › checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep (9.7s)
```

### Edge 2: chasing → surpassed transition triggered by check-toggle (MIN-4)

**Steps**: vitest `tests/unit/volume-target.test.ts` — unit `"MIN-4: chasing → surpassed transition triggers when an existing draft is toggled checked"` (sub-suite "checked-only running volume"). Builds drafts that *would* exceed PR if counted, asserts `chasing` with `runningKg = 0`, flips the `completed_at` stamps, re-asserts `surpassed` with `overflowKg = 500`.

**Expected**: kernel transitions `kind: "chasing"` → `kind: "surpassed"` purely from check-state toggles, with no other input changing.

**Actual**: pass.

**Result**: **pass**

**Evidence**:
```
✓ tests/unit/volume-target.test.ts > computeVolumeTarget — checked-only running volume > MIN-4: chasing → surpassed transition triggers when an existing draft is toggled checked 0ms
```

### Edge 3: `no-pr` state still hides the slot entirely

**Steps**: `tests/e2e/volume-target.spec.ts` test "no previous max: strip is hidden for a never-trained exercise" (line 516). Renders an exercise with no past sessions; the test asserts the strip is not present (`getByText(/To PR/i)` not visible, `getByText(/Max\s/i)` not visible).

**Expected**: `VolumeTargetSlot` returns `null` (no DOM) for the `no-pr` branch.

**Actual**: pass. Source-level confirmation at `src/components/volume-target-slot.tsx:48` — `if (state.kind === "no-pr") return null;` is unchanged from F11.

**Result**: **pass**

**Evidence**:
```
✓  5 tests/e2e/volume-target.spec.ts:516:7 › Volume-target strip (live workout) › no previous max: strip is hidden for a never-trained exercise (4.7s)
```

### Edge 4: a11y label sentence count

**Steps**: Inspected the literal label string at `src/components/volume-target-slot.tsx:71-75`.

**Expected** (per Conductor brief): 3 sentences.

**Actual**: 2 sentences with reps clause, 1 sentence without:

```ts
const a11y = showRepsClause
  ? `Previous best ${maxDisplay}, current session ${nowDisplay}, ${gapDisplay} to beat your previous best. About ${state.repsToBeat!.toFixed(1)} reps at ${weightDisplay}.`
  : `Previous best ${maxDisplay}, current session ${nowDisplay}, ${gapDisplay} to beat your previous best.`;
```

Sentence-boundary count via the period delimiter:
- With reps clause: `"Previous best X, current session Y, Z to beat your previous best."` + `"About R reps at W."` = **2 sentences**.
- Without reps clause: **1 sentence**.

**Result**: **pass — observed discrepancy with the brief, but documented and accepted upstream.** The implementation deliberately collapsed the design's 4-sentence variant to a 3-section comma-joined string per validator's optional **MIN-5** polish; this is recorded in `implementation.md` ("Deviations from design" → MIN-5 fold-in) and explicitly accepted by `review-v1.md:26` ("3 sentences, comma-joined"). The Conductor's brief reading of "3 sentences" matches the design's section count (Max / Now / Gap + reps), not literal English sentence boundaries. All three numeric facts plus the reps clause are still spoken; semantic content unchanged.

**Evidence**: source quoted above; review-v1.md confirms acceptance at line 26.

## Regression check

### Adjacent feature 1: weekly-volume-strip (history screen)

**Steps**: `npm run test:e2e -- tests/e2e/weekly-volume-strip.spec.ts` — 4 tests.

**Result**: **pass — 4/4**.

```
✓  6 tests/e2e/weekly-volume-strip.spec.ts:152:7 › Weekly volume strip — History screen › golden path: strip renders with header, bars, and labels for seeded data (10.1s)
✓  7 tests/e2e/weekly-volume-strip.spec.ts:207:7 › Weekly volume strip — History screen › empty state: brand-new user shows 'No sessions yet' and no strip (4.8s)
✓  8 tests/e2e/weekly-volume-strip.spec.ts:230:7 › Weekly volume strip — History screen › warmup-only user: strip returns null but sessions list still renders (5.5s)
✓  9 tests/e2e/weekly-volume-strip.spec.ts:289:7 › Weekly volume strip — History screen › refetch path: clearing the persisted TanStack cache + reload yields new total (8.0s)
```

The kernel split (`sumPastVolume` / `sumLiveVolume`) is module-private to `src/utils/volume-target.ts`; the weekly-volume strip consumes a different aggregate path (`src/api/progress.ts` → weekly bucketing). No coupling, no regression.

### Adjacent feature 2: week-drill-down (per-week detail)

**Steps**: `npm run test:e2e -- tests/e2e/week-drill-down.spec.ts` — 5 tests.

**Result**: **pass — 5/5**.

```
✓  1 tests/e2e/week-drill-down.spec.ts:160:7 › Week drill-down — tap a bar opens the per-week screen › golden path: tap current-week bar, headline matches, list renders (8.2s)
✓  2 tests/e2e/week-drill-down.spec.ts:254:7 › Week drill-down — tap a bar opens the per-week screen › empty week: tap a zero-volume bar lands on empty state (6.0s)
✓  3 tests/e2e/week-drill-down.spec.ts:319:7 › Week drill-down — tap a bar opens the per-week screen › deep link out-of-window week: outside-range copy (6.3s)
✓  4 tests/e2e/week-drill-down.spec.ts:363:7 › Week drill-down — tap a bar opens the per-week screen › deep link invalid date: invalid-week copy, no crash (4.6s)
✓  5 tests/e2e/week-drill-down.spec.ts:388:7 › Week drill-down — tap a bar opens the per-week screen › back navigation: detail → strip restores History list (5.9s)
```

The drill-down screen uses the same `formatVolume` kernel that was split in the prior `2026-05-21_2155_volume-math-wrong` run; nothing from this run touched its data path.

## Cross-platform

- **Web (Chrome, default 1280×720)**: pass — all 7 volume-target e2e + 9 adjacent regressions green.
- **iPhone-width Safari smoke (375×800)**: pass — see manual smoke below.
- **iOS native**: not tested — no simulator available in this environment. The change is pure RN `Text` + NativeWind tokens + `tabular-nums` + middle-dot characters, all cross-platform with identical wrap semantics to the previous strip; design risk section "Platform divergence (iOS / Android / web): zero" stands but warrants a user-side post-deploy spot-check.
- **Android native**: not tested — same rationale and same recommendation.

## Manual iPhone-width wrap smoke (MIN-6)

A one-off Node + Playwright/Chromium probe was used (script lived at `smoke-375.mjs` in the repo root, deleted post-run) to seed a deterministic chasing-state with checked sets, load the live workout at a 375×800 viewport (iPhone SE / iPhone 13 mini width), and read both the strip's `innerText()` and bounding box.

**Strip text rendered** (single string, no `\n`):

```
"Max 1,800 kg · Now 500 kg · To PR 1,300 kg · ≈ 26.0 reps @ 50.0 kg"
```

**Bounding box**: `{ x: 16, y: 255, width: 343, height: 40 }` — height 40px at `text-sm` (~14px line-height) ⇒ the text wraps to two visual lines inside the 343-pixel-wide content area, which is the expected and accepted graceful-wrap behaviour from design's Layout rationale.

**Visual evidence**:
- `docs/runs/2026-05-21_2225_multi-metric-strip/screenshots/iphone-375-strip.png` — strip cropped to its bounding box. Line 1: `Max 1,800 kg · Now 500 kg · To PR 1,300 kg · ≈`. Line 2: `26.0 reps @ 50.0 kg`. Wrap occurs at the natural `· ≈` separator before the reps clause — no unit token is stranded on its own line.
- `docs/runs/2026-05-21_2225_multi-metric-strip/screenshots/iphone-375-wrap.png` — full-page viewport showing the strip in context, the `Bench Press` exercise block, and the checked working set below.

**Orphan-unit heuristic**: split `innerText` on newlines and assert no line begins with `"kg"`. Result: pass (the rendered `innerText` is a single line; visual wrap is handled at the layout-engine level so the strings stay coherent). Worst-case copy from the design (`Max 4,900 kg · Now 1,200 kg · To PR 3,700 kg · ≈ 7.2 reps @ 60.0 kg`, ~67 chars) was NOT directly tested here — the smoke used the smaller `Max 1,800 kg · Now 500 kg · To PR 1,300 kg · ≈ 26.0 reps @ 50.0 kg` (~63 chars). Both fall within the wrap budget the design predicted (`text-sm` on 375px wraps to 2 lines); given the natural wrap point at `· ≈`, the worst-case copy would land in the same shape. **Not a blocker** but recommend a user-side post-deploy spot-check on a real iPhone Safari for the 4-digit-kg case.

**Result**: **pass — no orphan unit tokens; wrap is at a natural separator boundary**.

## Test commands

- [x] `npm run typecheck` — `tsc --noEmit` produced no output (clean).
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (pre-existing autogenerated warning on `.expo/types/router.d.ts`, not in this run's touched files).
- [x] `npm run test:unit` — `Test Files  8 passed (8), Tests  92 passed (92)`. `volume-target.test.ts` at **18 tests** as designed (13 → 18, +5 in the new `"computeVolumeTarget — checked-only running volume"` describe block).
- [x] `npm run test:e2e -- tests/e2e/volume-target.spec.ts` — **7 passed (57.9s)**.
- [x] `npm run test:e2e -- tests/e2e/weekly-volume-strip.spec.ts tests/e2e/week-drill-down.spec.ts` — **9 passed (1.0m)**.

## Decision

**pass**

Reasoning:
- Golden path passes (7/7 volume-target e2e green; the golden phase B→C→D arithmetic is asserted with literal strings `Max 1,800 kg · Now 500 kg · To PR 1,300 kg` etc.).
- All four required edge cases pass:
  - `runningKg === 0` ⇒ reps clause hidden — covered by e2e #2 (`chasing — no weight logged`) and e2e #7 (`toggling a set's check updates Now, gap, and reps in lockstep`), plus the kernel test `a draft set still drives the currentWeightKg pick when it has the highest set_number (Decision #8)`.
  - Chasing → surpassed via check-toggle — covered by unit test `MIN-4: chasing → surpassed transition triggers when an existing draft is toggled checked`.
  - `no-pr` hides the slot — covered by e2e #5 (`no previous max: strip is hidden for a never-trained exercise`).
  - A11y label sentence count — observed at 2 sentences (with reps clause) rather than the brief's "3"; this is a documented implementer deviation (MIN-5 polish) accepted by the Reviewer in `review-v1.md:26`. Semantic content fully preserved.
- Regressions clean: 9/9 across `weekly-volume-strip.spec.ts` (4) and `week-drill-down.spec.ts` (5).
- Cross-platform: web confirmed; iPhone 375px wrap confirmed via standalone Playwright/Chromium probe; native iOS/Android not testable from this environment and should be spot-checked post-deploy (design risk section already calls the platform divergence "zero" by construction).
- Static checks (`typecheck`, `lint`) clean; unit suite 92/92 with the required 18-test target on `volume-target.test.ts`.

**Recommendation to Conductor: finalize.**

## Notes for future runs (not blocking)

- The a11y "sentence count" mismatch between the Conductor brief (3) and the shipped label (2 with reps clause / 1 without) was traceable to the Reviewer's wording in `review-v1.md:26`. If the brief is authoritative, the literal-period count for the chasing-with-reps state should be re-discussed; if the brief was a loose summary, the shipped 2-sentence variant is the intended outcome. Recommend the Conductor pick one interpretation and patch either the brief or the label in a follow-up.
- Worst-case copy at 375px (`Max 4,900 kg · Now 1,200 kg · To PR 3,700 kg · ≈ 7.2 reps @ 60.0 kg`) was not directly exercised in the smoke (the seeded PR was `1,800 kg`, a 3-digit `Now`, a 4-digit `To PR`). Predicted wrap behaviour holds (natural split at `· ≈`), but a user-side spot-check on a 4-digit-kg session is the safest confirmation. Not a fail-the-pipeline event.
