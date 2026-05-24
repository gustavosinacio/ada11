# Test report v1 — 2026-05-23_2357_progress-graph-current-week

Testing: `implementation.md` against `design-v2.md`. Round 1 of ≤2.

## Environment
- Commands used to run app: `npm run web` (Expo web on `http://localhost:8081`), then `npx playwright test ...`
- Browser / device: Playwright headless Chromium (RN Web build)
- Test data: fresh per-test users created via Supabase admin API, seeded with 16 weekly sessions, deleted in `afterAll`
- iOS native: NOT tested — see Cross-platform section. The fix delegates to platform-native `scrollToEnd({ animated: false })` which is the established in-repo pattern (rollover effect at `:167-171`), so the cross-platform claim has reasonable supporting evidence even without a device test.

## Golden path

**Spec** (from design): `<WeeklyVolumeStrip>` must deterministically land on the rightmost (current) ISO-week bar on first mount on RN Web (and by design, iOS native + Android native), via imperative `scrollToEnd` from `onContentSizeChange`, gated by a one-shot `didInitialPinRef`.

### Golden 1 — History tab @ 390×844 (iPhone 12 preset)

**Steps**:
1. Seed user with 16 weekly sessions.
2. `page.setViewportSize({ width: 390, height: 844 })` BEFORE sign-in.
3. Sign in, navigate to `/history`.
4. Wait for "This week" header.
5. Query `[data-testid="weekly-strip-scroller"]`, evaluate `scrollLeft + clientWidth >= scrollWidth - 4`.
6. Screenshot to `screenshots/narrow-viewport-pin.png`.

**Result**: **pass**

**Evidence** (from the in-tree e2e `tests/e2e/chart-scroll-week-selector.spec.ts:326`):
```
PASS (4) FAIL (0)
Time: 55300ms
```
Screenshot: `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` — visually confirms: 8 bars visible (3/30 → 5/18), current-week bar (5/18, blue) flush with right edge.

### Golden 2 — Progress tab @ 390×844

**Steps**:
1. Same seed.
2. Viewport 390×844 before sign-in.
3. Navigate to `/progress`.
4. Same scroller assertion.

**Result**: **pass**

**Evidence** (one-shot probe spec):
```
[probe-progress-narrow] {"ok":true,"slack":0,"scrollLeft":372,"scrollWidth":730,"clientWidth":358}
✓ Progress tab @ 390pt: strip is pinned to right edge (19.3s)
```
`372 + 358 = 730 = scrollWidth` → pinned right, zero slack.

Screenshot: `screenshots/progress-narrow-pin.png` — Progress page with the strip pinned right, current-week bar (5/18, blue) at the right edge.

### Golden 3 — Wide viewport @ 1280×800

**Steps**:
1. Same seed.
2. Viewport 1280×800.
3. Navigate to `/history`. Confirm all 16 bars fit without horizontal scrolling. Current-week bar visible.

**Result**: **pass**

**Evidence**:
```
[probe-wide] {"scrollWidth":1248,"clientWidth":1248,"scrollLeft":0}
✓ History @ 1280pt wide: current-week visible, no overflow (14.6s)
```
`scrollWidth === clientWidth → no overflow`. Plus a bounding-box probe confirming the current-week bar lies inside the scroller's visible viewport box.

Screenshot: `screenshots/wide-viewport-1280.png` — all 16 bars (2/2 → 5/18) visible with no scroll, current-week bar (5/18, blue) at the right.

### Golden 4 — Scroll-left preservation across refetch

**Steps**:
1. Seed + 390×844 + sign in + go to `/history`.
2. Programmatically set `scrollLeft = scrollWidth - clientWidth - 200` (scroll left 200 px from the pinned right edge).
3. Bounce away (`/workout`) then back (`/history`) to force re-mount.
4. Confirm the post-remount fresh pin behaves correctly (this IS expected to re-pin on fresh mount — the one-shot `didInitialPinRef` is per-mount).
5. On the now-mounted strip, manually scroll left again to 172.
6. Trigger `window.dispatchEvent(new Event("focus"))` — react-query refetches `["stats"]` on focus by default; the strip stays mounted; `useLifetimeWeeklyVolume` re-fetches with the same data shape.
7. Confirm `scrollLeft` unchanged.

**Result**: **pass**

**Evidence**:
```
[probe-preserve] manual scroll → {"scrollLeft":172,"max":372}
[probe-preserve] after remount → {"scrollLeft":372,"slack":0}
[probe-preserve] before refetch → {"scrollLeft":172}
[probe-preserve] after refetch → {"scrollLeft":172}
✓ Scroll-left preservation across navigation refetch (20.9s)
```

Two key facts here:
- After a fresh re-mount, the strip re-pins (`slack: 0`). That's by design — `didInitialPinRef` resets on un-mount and the one-shot fires on the next `onContentSizeChange`.
- After a window-focus-triggered same-mount refetch, `scrollLeft` is unchanged (172 → 172). The user's scroll survives. This matches the design's "subsequent content-size changes... do NOT re-pin" claim and the explicit removal of any `useEffect` that would yank the user back.

### Golden 5 — Week-rollover behavior preserved

This is tested implicitly via the existing rollover effect at `src/components/weekly-volume-strip.tsx:167-171`, which was not touched by this change. I did not synthesize a brand-new week-rollover scenario (would require date/clock-manipulation hooks the test infra doesn't expose); the design's argument that `isPinnedRightRef` is correctly maintained post-fix (because `scrollToEnd` dispatches a programmatic `onScroll` that flips the flag back to `true`) is structurally sound and survives static review. **Confidence: MEDIUM**. **Flagged as not exercised dynamically** in this round.

## Edge cases

### Edge 1 — iPhone SE viewport (320×568)

**Steps**: same as Golden 1 but `page.setViewportSize({ width: 320, height: 568 })`.

**Expected**: strip still pinned right; only ~6-7 bars fit.

**Actual**:
```
[probe-history-se] {"ok":true,"slack":0,"scrollLeft":442,"scrollWidth":730,"clientWidth":288}
✓ History @ 320pt iPhone SE: pinned to right edge (15.5s)
```

`442 + 288 = 730 = scrollWidth` → pinned right, slack 0.

**Result**: **pass**

Screenshot: `screenshots/iphone-se-pin.png` — 6 bars visible (4/13 → 5/18) at 320pt, current-week bar (5/18, blue) flush right.

### Edge 2 — Scroll-left + same-mount refetch (no yank)

Already covered as Golden 4. Result: **pass**. Critical because the v1 design (with a re-firing `useEffect`-driven pin) would have failed this case; the v2 single-shot `didInitialPinRef` design holds.

### Edge 3 — TypeScript-vs-design `dataSet` deviation (Implementer call)

**Steps**: confirm `npm run typecheck` clean despite the deviation from `dataSet` to `testID`.

**Expected**: zero diagnostics; e2e selector `[data-testid="weekly-strip-scroller"]` still matches because RN-Web maps `testID` to `data-testid` identically.

**Actual**:
```
> tsc --noEmit
(no output, exit 0)
```
And the four chart-scroll e2e tests passed, including the one using exactly that selector.

**Result**: **pass**

## Regression check

- **`tests/e2e/chart-scroll-week-selector.spec.ts` (4 tests, 3 pre-existing + 1 new)**: `PASS (4) FAIL (0)`, 55.3 s. No regression in the existing wide-viewport / selector-modal / backdrop-dismiss flows.
- **`tests/e2e/weekly-volume-strip.spec.ts` + `tests/e2e/progress-page.spec.ts` + `tests/e2e/week-drill-down.spec.ts` (17 tests combined)**: `PASS (17) FAIL (0)`, 102 s. The directly adjacent surfaces (the strip's host pages and the week-drill-down route the bars link to) are clean.

## Cross-platform

- **Web (RN Web 0.21)**: **pass** — all 4 e2e tests in the canonical spec, all 4 probe tests, all 17 adjacent-regression tests.
- **iOS native**: **not tested — no device / simulator available in this headless environment**. The design claim ("`scrollToEnd({ animated: false })` on iOS translates to `UIScrollView.scrollRectToVisible` and lands deterministically") rests on RN documentation + the established in-repo pattern at line 167 (rollover effect, in production since 2026-05-22_1130). Risk is low but not zero. Recommend Owner smoke on a physical iPhone before merge.
- **Android native**: **not tested — same reason**. Same reasoning as iOS; risk arguably lower because Android `HorizontalScrollView.fullScroll` is the platform equivalent and has identical semantics.

## Test commands

- [x] `npm run typecheck` — `> tsc --noEmit` exit 0, no diagnostics.
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (only pre-existing `router.d.ts` warning, untouched by this run).
- [x] `npm run test:unit` — `Test Files 18 passed (18) · Tests 307 passed (307)` in 1.58 s.
- [x] `npm run test:e2e` (scoped) — chart-scroll spec `PASS (4) FAIL (0)` in 55.3 s; adjacent sweep `PASS (17) FAIL (0)` in 102 s; total 21 tests green.

## Decision

**pass**

Reasoning:
- Golden path: pinned to right edge on `/history` at 390pt (canonical e2e green, visual screenshot confirms current-week bar 5/18 blue, flush right).
- Cross-surface: Progress tab inherits the fix automatically (probe green).
- Edge 1 — iPhone SE 320pt: pinned right (probe green, screenshot confirms).
- Edge 2 — wide viewport 1280pt: all 16 bars fit, current-week bar visible inside scroller bbox (probe green, screenshot confirms).
- Edge 3 — scroll-left preserved across same-mount refetch (probe green): user's scroll is not yanked back, confirming the one-shot `didInitialPinRef` gate works as designed.
- Regression sweep: 21 tests across 4 specs all green; no breakage in adjacent flows.
- Quality gates: typecheck, lint, 307/307 unit tests, all green.
- Implementer's `dataSet → testID` deviation: justified, type-safe, and verified by the very e2e selector it had to keep working.

Caveat (not blocking): iOS / Android native not exercised. Recommend Owner smoke on a physical iPhone before merge.

Recommendation: **finalize**.
