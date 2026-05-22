# Test report v1 — 2026-05-22_1130_chart-scroll-week-selector

Testing: implementation against `design-v2.md` (chart horizontal scrolling + week selector).

## Environment

- Commands used to run app: `npm run test:unit`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`. The Playwright config boots Expo web automatically; no manual `npm run web` needed.
- Browser / device: Chromium (Playwright default), web.
- Test data: per-test seeded users (E2E specs spin up Supabase auth users + sessions via service role).

## Test commands

- [x] `npm run typecheck` — clean (no output, exit 0).
- [x] `npm run lint` — 0 errors, 1 warning (`router.d.ts`, pre-existing per implementation.md/review-v1).
- [x] `npm run test:unit` — **208 passed / 208** (matches Implementer's 201 → 208 claim; +7 net new across `dates.test.ts` and `weekly-volume-bucketing.test.ts`).
- [x] `npm run test:e2e tests/e2e/chart-scroll-week-selector.spec.ts` — 3/3 passed (new feature spec).
- [x] `npm run test:e2e tests/e2e/weekly-volume-strip.spec.ts` — 4/4 passed (regression).
- [x] `npm run test:e2e tests/e2e/progress-page.spec.ts` — 7/7 passed (regression).
- [x] `npm run test:e2e tests/e2e/week-drill-down.spec.ts` — **3/5 passed, 2 failed** (regression).
- [x] `npm run test:e2e tests/e2e/volume-target.spec.ts` — 6/7 in batch; 1 failure (`golden path`) reproduced as a **flake** (passed in isolated rerun). Not attributable to this diff.

## Golden path

**Spec** (from design): Both weekly-volume strips (History mini + Progress) become horizontally scrollable across the user's lifetime ISO-week history, default-pinned to the right edge; a week-selector pill above the strip opens a bottom-sheet (year/month picker) that scrolls the strip to the chosen week; lifetime-best overlay stays anchored to lifetime max regardless of scroll; ISO-week boundary semantics unchanged.

**Steps run**: `npm run test:e2e tests/e2e/chart-scroll-week-selector.spec.ts` — three cases that seed 16 weeks of data, mount the History route, and exercise (1) default mount + pill render + current-week bar visible, (2) tap pill → modal opens → Jump dismisses cleanly, (3) backdrop-tap dismisses modal.

**Result**: **pass**.

**Evidence**:

```
Running 3 tests using 1 worker
[screenshot] /Users/gustavoinacio/github/ada11/docs/runs/2026-05-22_1130_chart-scroll-week-selector/screenshots/scroll-default-mount.png
  ✓  1 tests/e2e/chart-scroll-week-selector.spec.ts:148:7 › default mount: pinned to right edge, current-week visible, pill rendered (19.5s)
[screenshot] /Users/gustavoinacio/github/ada11/docs/runs/2026-05-22_1130_chart-scroll-week-selector/screenshots/scroll-selector-flow.png
  ✓  2 tests/e2e/chart-scroll-week-selector.spec.ts:203:7 › week-selector flow: tap pill → modal opens → confirm scrolls strip (16.7s)
  ✓  3 tests/e2e/chart-scroll-week-selector.spec.ts:268:7 › modal backdrop dismiss: tap outside the card closes it (7.1s)
  3 passed (44.0s)
```

Screenshots at `docs/runs/2026-05-22_1130_chart-scroll-week-selector/screenshots/scroll-default-mount.png` and `scroll-selector-flow.png`.

## Edge cases

### Edge 1: default mount lands at right edge (most recent week visible)

**Steps**: Test #1 of `chart-scroll-week-selector.spec.ts` seeds 16 weeks of data, mounts History, asserts the current-week bar (latest Monday) is visible without any user-initiated scroll. The test asserts the pill renders ("Visible range" label) and the rightmost bar is present.

**Expected**: Right edge anchored on mount.

**Actual**: Pass — current-week bar visible immediately; pill shows current-window label.

**Result**: **pass**.

**Evidence**: Test #1 output above (✓ 19.5s). Screenshot: `scroll-default-mount.png`.

### Edge 2: week selector modal opens and Jump confirms cleanly

**Steps**: Test #2 of `chart-scroll-week-selector.spec.ts`: tap the pill → modal slides up; year/month chips render; tap Jump → modal dismisses without crashing.

**Expected**: Modal opens, year/month chips render, Jump dismisses cleanly.

**Actual**: Pass.

**Result**: **pass** (with documented coverage caveat from review-v1 MIN-4 / implementation.md Deviations #3: the modal closes cleanly, but the spec does NOT assert that the strip's `contentOffset.x` actually shifted after Jump. This is a known coverage gap, not a bug surfaced by my testing.).

**Evidence**: Test #2 output above (✓ 16.7s). Screenshot: `scroll-selector-flow.png`.

### Edge 3: modal dismisses via backdrop tap

**Steps**: Test #3 of `chart-scroll-week-selector.spec.ts`: tap pill → modal opens → tap backdrop outside the card → modal dismisses.

**Expected**: Backdrop-tap closes the modal.

**Actual**: Pass.

**Result**: **pass**.

**Evidence**: Test #3 output above (✓ 7.1s).

### Edge 4: lifetime-best overlay anchored at lifetime max (independent of scroll)

**Steps**: Implementer claim (`weekly-volume-strip.tsx:305-313`) — overlay is positioned INSIDE the ScrollView, spanning the full content width at the lifetime-max Y. Reviewer verified the DOM structure (`review-v1.md` row "Lifetime-best overlay inside the scroller: yes").

**Expected**: Overlay y-position constant under horizontal scroll.

**Actual**: Not asserted by an explicit Playwright assertion in `chart-scroll-week-selector.spec.ts`. The overlay rendering is confirmed by the strip golden path passing (`weekly-volume-strip.spec.ts` 4/4 green), and the code/review trace supports the placement, but no test exercises a multi-week scroll that visually verifies the y-pin under translation.

**Result**: **not directly tested** (coverage gap inherited from the new spec's scope). Code-side evidence + review concurrence is the only signal.

**Evidence**:

```
  ✓  1 tests/e2e/weekly-volume-strip.spec.ts:152:7 › golden path: strip renders with header, bars, and labels for seeded data (9.8s)
  4 passed (31.1s)
```

`review-v1.md:30` (table row "Lifetime-best overlay inside the scroller: yes").

### Edge 5: new-week roll-over re-pins to right edge (MIN-5)

**Steps**: Implementer claim (`weekly-volume-strip.tsx:147-153`) — `useEffect` re-pins to right edge when `buckets.length` grows AND `isPinnedRightRef.current === true`. Reviewer verified at `review-v1.md:24`.

**Expected**: When the user is pinned right and the bucket count increases (new ISO week), auto-scroll re-pins.

**Actual**: Not directly exercised by any spec. The unit-test layer covers the bucket model (`weekly-volume-bucketing.test.ts` 7 cases), but the React side-effect that re-pins on bucket growth is not behaviour-tested.

**Result**: **not directly tested** (coverage gap; relies on code review).

**Evidence**: `weekly-volume-strip.tsx:147-153` per `review-v1.md:24`.

### Edge 6: cold-start latency on populated user (Implementer claim: ≈ 3s)

**Steps**: Test #1 of `chart-scroll-week-selector.spec.ts` seeds 16 weeks (~16 finished sessions) and asserts the strip renders. Wall-clock time end-to-end: 19.5s. This includes sign-in (~1.5s), navigation, and strip render — strip-specific paint time is not extracted, but the overall pipeline completes well under any pathological budget.

**Expected**: ~3s for the lifetime weekly-volume query on a 16-week seed; document if >5s.

**Actual**: Indirect signal only — the test completes in 19.5s total including all steps. No standalone latency probe was added.

**Result**: **not directly measured** (no perf benchmark in spec). No subjective lag observed.

**Evidence**: Test #1 timing (19.5s end-to-end).

## Regression check

### `tests/e2e/weekly-volume-strip.spec.ts` — **pass** (4/4)

The strip's core render/empty-state/warmup-only/refetch paths still work after wrapping in a horizontal ScrollView.

```
  ✓ 1 golden path: strip renders with header, bars, and labels for seeded data (9.8s)
  ✓ 2 empty state: brand-new user shows 'No sessions yet' and no strip (5.0s)
  ✓ 3 warmup-only user: strip returns null but sessions list still renders (6.6s)
  ✓ 4 refetch path: clearing the persisted TanStack cache + reload yields new total (9.1s)
  4 passed (31.1s)
```

### `tests/e2e/week-drill-down.spec.ts` — **fail** (3/5)

Two real regressions introduced by this diff. The Implementer reported updating this file ("repurposed the out-of-window case"), but only the 1 case at `:319-378` was updated. Two other cases now break under the new dynamic-bucket model and the new pill label.

**Failure A: `golden path: tap current-week bar, headline matches, list renders` (`:160`).**

```
Error: expect(locator).toBeVisible() failed
Locator: getByText(/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/)
Error: strict mode violation: getByText(/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/) resolved to 2 elements:
    1) <div … class="… text-xs …">Apr 13 – May 18, 2026</div>
    2) <div … class="… text-2xl …">May 18 – May 24</div>
```

**Root cause**: The new `<VisibleRangePill>` renders text like `"Apr 13 – May 18, 2026"` on the History page. Expo Router on web keeps the previous History route in DOM (display:none) after navigation to `/history/week/:isoWeek`, so the page-level `getByText(/.../)` call now matches BOTH the residual pill AND the new per-week body header (`"May 18 – May 24"`). The test was written under the assumption that ONE element matches this regex on the whole DOM at this point. Reproduced deterministically in isolated rerun.

**Failure B: `empty week: tap a zero-volume bar lands on empty state` (`:254`).**

```
Error: expect(locator).toBeVisible() failed
Locator: getByRole('button', { name: 'View week of 4/27' })
Timeout: 5000ms
Error: element(s) not found
```

**Root cause**: The pre-2026-05-22 strip used a fixed 8-week window, so a user who seeded only the current week would still see 7 "rest week" bars (zero-volume) at offsets 1..7. The test seeds 1 session in current week and then taps the 3-weeks-ago rest bar. Under the new dynamic-bucket model (`computeStripModel` at `src/utils/weekly-volume-strip-math.ts:47-92`), `firstSessionMonday === currentMonday`, so `isoWeeksBetween` returns a 1-element array — the strip renders exactly ONE bar (current week only). The 3-weeks-ago rest bar no longer exists, so the locator times out. Reproduced deterministically in isolated rerun.

Both failures are direct consequences of in-scope changes (the pill is new; the dynamic-bucket model replaces the 8-week fixed window). The Implementer's note "repurposed the `out-of-window` case" addressed only the case at `:319-378`. The two cases at `:160` and `:254` were not adapted.

### `tests/e2e/progress-page.spec.ts` — **pass** (7/7)

```
  ✓ 1 tab visibility — Progress tab renders on the bottom bar (4.2s)
  ✓ 2 empty user — day-zero empty states render without crashing (6.3s)
  ✓ 3 populated user mid-week — hero, bars, list, streak all render (8.0s)
  ✓ 4 per-row navigation — tapping a list row routes to /(app)/exercises/{id}/progress (7.5s)
  ✓ 5 empty current ISO week with prior history — list shows empty copy, hero/bars still render (6.5s)
  ✓ 6 PR badge — a row that beats its lifetime best this week renders the PR pill (9.1s)
  ✓ 7 5-tab regression — History, Progress, Profile labels coexist on the bar (2.8s)
  7 passed (45.1s)
```

### `tests/e2e/volume-target.spec.ts` — **pass with one flake** (6/7 + 1 retry green)

The batch run had 1 failure on `golden path: chasing copy + reps clause across multiple seeded sets` (`:209`) — the running-volume "Now" did not update from 500 kg → 980 kg after seeding set #2 via REST and re-navigating. Re-run in isolation: **green** (18.9s, 1/1). The diff under test does not touch the live-session/volume-target code path; the failure is consistent with a cache-refresh race in the test harness, not a feature regression. Logged for awareness, not a blocker for this run.

```
# isolated rerun:
  ✓  1 tests/e2e/volume-target.spec.ts:209:7 › golden path: chasing copy + reps clause across multiple seeded sets (18.9s)
  1 passed (19.6s)
```

## Cross-platform

- Web (Chromium / Playwright): **pass for new feature; fail for `week-drill-down` regression**.
- iOS: not tested — no iOS spec in the repo; no native code touched per implementation.md, so no native-specific risk. Manual native smoke deferred.
- Android: not tested — same rationale as iOS.

## Decision

**fail**

Reasoning:

- The new feature (`chart-scroll-week-selector.spec.ts`) passes 3/3 — golden path, modal flow, and backdrop dismiss all green.
- The `weekly-volume-strip` and `progress-page` regression specs pass (4/4 and 7/7).
- Unit suite green (208/208, matches implementer claim).
- **However**, `tests/e2e/week-drill-down.spec.ts` regresses 2 cases (`:160` golden path, `:254` empty-week). Both are deterministic, both are caused by in-scope changes from this run:
  - `:160` — `<VisibleRangePill>` label `"Apr 13 – May 18, 2026"` shares regex `/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/` with the per-week body header on the post-navigation DOM (Expo Router web keeps the previous route mounted). The implementer updated one case at `:319-378` but missed `:160` and `:254`.
  - `:254` — the test seeds 1 current-week session and expects a 3-weeks-ago "rest week" bar to exist. Under the new dynamic-bucket model (`firstSessionMonday → currentMonday`), only 1 bar exists. The test must either seed an older session (to push `firstSessionMonday` back ≥4 weeks) or be repointed to a within-range zero-volume week.

What the Implementer must address (round 2):

1. **`tests/e2e/week-drill-down.spec.ts:236`** — narrow the regex (e.g. scope to the per-week page container, or change the regex to require the no-year variant `"MMM d – MMM d"` only). The pill text always includes a year (`"MMM d, yyyy"` or `"MMM d, yyyy – MMM d, yyyy"`), so a year-anchored regex on the pill would also resolve it.
2. **`tests/e2e/week-drill-down.spec.ts:254`** — update the seed plan: seed an older session ≥6 weeks back so the dynamic-bucket model produces ≥7 buckets; then the 3-weeks-ago bar exists as a zero-volume rest week.

These are both test-side adaptations — the underlying product behaviour matches the design (lifetime-bucket model + visible-range pill are both spec-mandated). No design re-open is required. Implementer round 2 should be ≤2 small edits in `tests/e2e/week-drill-down.spec.ts`. After fix, re-run `week-drill-down.spec.ts` (full file, not just the failing cases) and the rest of the regression set is expected to remain green.

**Recommendation**: return to Implementer for the two test-file fixes.
