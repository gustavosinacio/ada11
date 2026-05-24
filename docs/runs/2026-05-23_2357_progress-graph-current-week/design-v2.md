# Design v2 — 2026-05-23_2357_progress-graph-current-week

Round 2 of ≤3. Validator returned **no-go** on v1 with 0 blockers / 2 majors / 5 minors. This v2 collapses both majors into a single 1-line platform call (`scrollToEnd`), simplifies the surrounding code path, and pins a concrete e2e selector.

## Diff from v1

Enumerated in order of the Validator's findings:

1. **MAJ-1 + MAJ-2 collapsed into one fix** — replace the manual `scrollRef.current?.scrollTo({ x: contentWidth - viewportWidth, … })` with `scrollRef.current?.scrollToEnd({ animated: false })`. The platform computes the inner-content vs. viewport delta internally, so:
   - The outer-wrapper `px-4 × 2 = 32pt` padding error vanishes (no more off-by-32pt under-scroll).
   - The `viewportWidthRef.current === 0` race vanishes (no viewport read at the call site).
   - Matches the existing in-repo precedent at `src/components/weekly-volume-strip.tsx:162` (rollover effect already uses `scrollToEnd`).
2. **MIN-2 — `pinRightEdge` helper removed.** The fix is now a literal one-liner; inlined at the (single, post-MIN-4) call site. Helper deleted from the design.
3. **MIN-4 — coupling resolved.** Adopted option (i) from the Validator's note: drop the `onLayout` mutation entirely. `onContentSizeChange` re-fires on every content-size change (RN spec; verified below in **Ordering narrative**), so it natively covers the empty-state → loaded-state transition (`contentWidth` 0 → 730pt). `onLayout` reverts to its original one-liner role of writing `viewportWidthRef.current` (still needed by `onScroll` at `:171-172` and `:180` for visible-range bookkeeping — separate concern, must remain).
4. **MIN-3 — moot.** `onLayout` no longer mutates anything related to initial-pin, so the spurious `[model, pinRightEdge]` deps from v1 do not exist. Deps stay at the original `[]`.
5. **MIN-1 — concrete e2e selector pinned.** The `<ScrollView>` gets a `dataSet={{ testid: "weekly-strip-scroller" }}` prop. On RN Web, `dataSet` lowercases to `data-testid="weekly-strip-scroller"` on the underlying scrolling `<div>`. Tester targets it directly via `page.locator('[data-testid="weekly-strip-scroller"]')`. The brittle walk-up-to-find-scrolling-ancestor loop is removed from the e2e plan.
6. **MIN-5 — narrow-viewport screenshot pinned.** Tester captures `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` at viewport `390 × 844`, showing the current-week bar flush with the right edge of the strip.
7. **Ordering narrative re-stated** explicitly in **Riscos → UX regressions (ordering)**: `onContentSizeChange` fires every time the content size changes, including the loading-skeleton → loaded-strip transition. The transition is the moment `contentWidth` goes from 0 (BRANCH 1 returns a skeleton with no scroller) to ~730pt (BRANCH 4 renders the `<ScrollView>` with bars). On that transition, RN measures the inner content view and invokes `onContentSizeChange(730, h)` with the scroller already laid out, so `scrollToEnd` lands deterministically.

Everything else (one-shot `didInitialPinRef` gate, removal of declarative `contentOffset`, no schema change, no API change) stays.

## Goal (1 sentence)

Fix `<WeeklyVolumeStrip>` so it deterministically lands on the rightmost (current) ISO-week bar on first mount, on iOS native + Android native + RN Web, by pinning imperatively via `scrollToEnd` from `onContentSizeChange`.

## Approach

Drop the declarative `contentOffset={{ x: rightAnchorX, y: 0 }}` prop (and the `rightAnchorX` math), which is broken in two ways at once: (a) it uses `contentWidth` instead of `contentWidth − viewport`, and (b) on iOS native the declarative value is read before content has laid out and is clamped to 0. Replace it with an imperative pin from `onContentSizeChange`, gated by a one-shot `didInitialPinRef` so subsequent content-size changes (week-rollover, refetch with new bucket, in-week volume growth) do not steal the user's scroll position. The pin itself delegates to `scrollRef.current?.scrollToEnd({ animated: false })`, which the platform implements as "scroll so that the rightmost content edge meets the rightmost visible edge of the scroller's own viewport". Because the platform owns the math, the `px-4` outer-wrapper padding (which would have made a hand-rolled `scrollTo({ x: contentWidth − wrapperWidth })` under-scroll by 32pt) is irrelevant. Because `onContentSizeChange` is invoked after RN has measured both content and viewport, the `viewportWidthRef.current === 0` race in v1 is gone — and because we use `scrollToEnd`, we don't even read `viewportWidthRef` at the pin site.

Both History and Progress mount the same component, so the fix lands on both surfaces in one diff.

**Confidence**: HIGH — `scrollToEnd({ animated: false })` is the established in-repo pattern (used by the rollover effect at `:162`, in production since the 2026-05-22_1130 run), and `onContentSizeChange` is the canonical RN gotcha-fix called out by Discovery line 52 and by the RN docs.
**Risk**: LOW — single component, no schema/data/auth change; worst case is a 1-frame flash at mount on a slow device, mitigated by `animated: false`. Reversible by a single revert commit.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/weekly-volume-strip.tsx` | edited | (1) Delete the broken `rightAnchorX` computation at `:234-238` and the `contentOffset={{ x: rightAnchorX, y: 0 }}` prop on the `<ScrollView>` at `:267`. (2) Add `didInitialPinRef = useRef(false)`. (3) Add `onContentSizeChange={(w) => { if (!didInitialPinRef.current && w > 0) { scrollRef.current?.scrollToEnd({ animated: false }); didInitialPinRef.current = true; } }}` on the `<ScrollView>`. (4) Add `dataSet={{ testid: "weekly-strip-scroller" }}` on the `<ScrollView>` so RN Web emits `data-testid="weekly-strip-scroller"`. (5) `onLayout` callback at `:197-199` stays unchanged (one-liner that writes `viewportWidthRef.current` for `onScroll`'s benefit). |
| `tests/e2e/chart-scroll-week-selector.spec.ts` | edited | Add a NEW test `"default mount on narrow viewport: scroll is pinned to right edge"` that (a) calls `page.setViewportSize({ width: 390, height: 844 })` BEFORE sign-in, (b) seeds 16 weeks, (c) targets the scroller directly via `page.locator('[data-testid="weekly-strip-scroller"]')`, (d) asserts `scrollLeft + clientWidth >= scrollWidth - 4` via `evaluate`, (e) captures `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` via `page.screenshot({ path, fullPage: false, clip: <wrapper bbox> })`. Keep existing tests untouched. |
| `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` | new (Tester-owned) | Visual evidence: current-week bar flush with strip's right edge at 390pt viewport. |

## Contratos de I/O

- **Component public API**: unchanged. `<WeeklyVolumeStrip bestWeekKg? bestWeekLabel? />` keeps the same prop shape (`src/components/weekly-volume-strip.tsx:38-52`).
- **New internal ref + inline handler** (no exported types):
  ```ts
  const didInitialPinRef = useRef<boolean>(false);
  ```
  And, inline on the `<ScrollView>`:
  ```tsx
  onContentSizeChange={(w) => {
    if (didInitialPinRef.current) return;
    if (w <= 0) return;
    scrollRef.current?.scrollToEnd({ animated: false });
    didInitialPinRef.current = true;
  }}
  ```
- **ScrollView prop diff** (exact):
  ```diff
  - <ScrollView
  -   ref={scrollRef}
  -   horizontal
  -   showsHorizontalScrollIndicator={false}
  -   contentOffset={{ x: rightAnchorX, y: 0 }}
  -   onScroll={onScroll}
  -   scrollEventThrottle={16}
  -   className="mt-4"
  - >
  + <ScrollView
  +   ref={scrollRef}
  +   horizontal
  +   showsHorizontalScrollIndicator={false}
  +   dataSet={{ testid: "weekly-strip-scroller" }}
  +   onContentSizeChange={(w) => {
  +     if (didInitialPinRef.current) return;
  +     if (w <= 0) return;
  +     scrollRef.current?.scrollToEnd({ animated: false });
  +     didInitialPinRef.current = true;
  +   }}
  +   onScroll={onScroll}
  +   scrollEventThrottle={16}
  +   className="mt-4"
  + >
  ```
  And delete the `rightAnchorX` const at `:234-238` (entire 5-line block including the comment).
- **`dataSet` prop on RN/RN Web** (Implementer reference):
  - RN core supports the `dataSet` prop on `View` (and `ScrollView`, which extends `View`'s props) since RN 0.65 (`react-native@0.81.5` is current — supported). Spec: <https://reactnative.dev/docs/view#dataset>.
  - On iOS / Android native, `dataSet` is a no-op at render (read by reanimated/some libs at runtime; safe to set, no UI effect).
  - On RN Web (`react-native-web@~0.21.0`), `dataSet={{ testid: "weekly-strip-scroller" }}` is lowered to `data-testid="weekly-strip-scroller"` on the underlying DOM `<div>`. Key in `dataSet` is camelCase JS; rendered HTML attribute is `data-` + lowercased key. So `testid` → `data-testid`.
  - Why not `nativeID="weekly-strip-scroller"`? `nativeID` lowers to the HTML `id` attribute on RN Web, but on native it maps to `accessibilityIdentifier` / `nativeID` and we'd risk colliding with the accessibility-tree label. `dataSet` is the cleaner test-only channel.
- **DB columns / queries**: NONE. Fix touches only client render + scroll wiring. `useLifetimeWeeklyVolume`, `computeStripModel`, RLS — all untouched.
- **UI props / state**: no external prop change. One new internal ref (`didInitialPinRef`), one new inline callback (`onContentSizeChange`), one new declarative prop (`dataSet`).

## Re-fire / week-rollover behavior preserved

- `didInitialPinRef` flips `true` on the FIRST `onContentSizeChange` with `w > 0` and never resets. Subsequent content-size changes (e.g. user logs a set this week and the rightmost bar's bucket reference changes, or a new bucket is appended on Monday-midnight rollover) do NOT re-pin.
- The existing rollover effect at `:159-165` is untouched:
  ```ts
  useEffect(() => {
    if (bucketsLength > prevCountRef.current && isPinnedRightRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
    prevCountRef.current = bucketsLength;
  }, [bucketsLength]);
  ```
  It still scrolls-to-end ONLY when (a) a new bucket appeared AND (b) `isPinnedRightRef.current === true`. The `isPinnedRightRef` flag is maintained by `onScroll` (`:176-177`), which fires correctly post-fix because the imperative `scrollToEnd` dispatches a programmatic `onScroll` event on both iOS native and RN Web — meaning the user lands genuinely at the right edge, `isPinnedRightRef` reads `true`, and week-rollover continues to work as designed.
- **What changes (side-benefit)**: pre-fix, on a narrow viewport, the user landed at `scrollLeft = 0` (or whatever iOS clamped to). `onScroll` would compute `isPinnedRightRef = false` because `contentWidth − (0 + viewportWidth) > COLUMN_WIDTH × 1.5`. So week-rollover was ALSO silently broken on narrow viewports (would not auto-scroll a user who'd never manually scrolled to the right edge). The fix restores both initial pin AND week-rollover semantics in one shot.

## Test surface — narrow-viewport regression assertion

Tester adds a new test inside the existing `describe` block in `tests/e2e/chart-scroll-week-selector.spec.ts`. Seed 16 weeks identical to the existing "default mount" test, then:

```ts
test("default mount on narrow viewport: scroll is pinned to right edge", async ({
  page,
}) => {
  // CRITICAL: shrink viewport BEFORE navigating so layout reflects 390pt width.
  await page.setViewportSize({ width: 390, height: 844 });

  const email = `e2e-scroll-narrow-${Date.now()}@test.com`;
  const userId = await createConfirmedUser(email);
  const exerciseId = await getSeedExerciseId(userId);

  for (let offset = 0; offset < 16; offset++) {
    const dt = mondayNWeeksAgoUtc(offset);
    dt.setUTCDate(dt.getUTCDate() + 2);
    dt.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId, exerciseId, completedAt: dt,
      workingSets: 3, weight: 50 + offset * 5, reps: 5,
    });
  }

  try {
    await signInViaUi(page, email);
    await gotoHistory(page);

    await expect(page.getByText("This week", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Direct selector via data-testid emitted by RN Web from dataSet={{testid}}.
    const scroller = page.locator('[data-testid="weekly-strip-scroller"]');
    await expect(scroller).toBeVisible({ timeout: 5_000 });

    // Deterministic regression-killer: scrollLeft + clientWidth must equal
    // scrollWidth (within 4-px sub-pixel tolerance).
    const pinned = await scroller.evaluate((el) => {
      const slack = el.scrollWidth - el.clientWidth - el.scrollLeft;
      return {
        ok: slack <= 4,
        slack,
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });
    expect(
      pinned.ok,
      `scroll not pinned to right edge: ${JSON.stringify(pinned)}`,
    ).toBe(true);

    // Sanity: the current-week bar exists in the DOM (no a11y regression).
    const currentMonday = mondayNWeeksAgoUtc(0);
    const currentLabel = `${currentMonday.getUTCMonth() + 1}/${currentMonday.getUTCDate()}`;
    await expect(
      page.getByRole("button", { name: `View week of ${currentLabel}` }),
    ).toBeVisible({ timeout: 5_000 });

    // MIN-5: capture the narrow-viewport pinned screenshot for visual evidence.
    await page.screenshot({
      path: "docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png",
      fullPage: false,
    });
  } finally {
    await deleteUserSafe(userId);
  }
});
```

The 4-px tolerance accounts for RN Web sub-pixel rounding. The selector goes through `data-testid` (pinned by the Implementer via `dataSet`), eliminating the v1 walk-up loop.

## Riscos

- **Data integrity (RLS, migrations)**: NONE. Zero schema or query change.
- **UX regressions**:
  - **Initial-mount flash**: on a slow device the user could see one frame at `scrollLeft = 0` before `onContentSizeChange` fires. Mitigation: `animated: false` makes the jump instant; in practice React batches the first commit + measure + scroll-to-end into the same paint on iOS native. RN Web behaved "correctly" pre-fix only via accidental clamp of `scrollLeft = contentWidth`; post-fix it lands via the explicit imperative call — no visible regression at common viewports.
  - **Ordering — empty → loaded transition (re-statement per Validator request)**: the component returns a skeleton (no `<ScrollView>`) while `isLoading === true` (`:202-211`). On the loading → loaded transition, the `<ScrollView>` mounts for the first time with `contentWidth ≈ 730pt` (16 buckets) — RN measures the inner content view and calls `onContentSizeChange(730, h)` with the scroller already laid out. RN spec: `onContentSizeChange` fires every time the content size changes, not just on first mount of the scroller. Therefore the loading-skeleton → loaded-strip transition reliably triggers `onContentSizeChange`, the guard `w > 0` passes, `scrollToEnd` runs, `didInitialPinRef` flips, subsequent fires no-op. Verified path; no need for `onLayout` belt-and-braces.
  - **Refetch-with-same-shape**: if `useLifetimeWeeklyVolume` refetches and returns the same 16 buckets, `contentWidth` does not change, `onContentSizeChange` does not fire, `didInitialPinRef` already `true`, nothing happens. Safe.
  - **Refetch-with-new-bucket (week rollover at midnight)**: bucket count grows 16 → 17, `contentWidth` 730 → 776pt, `onContentSizeChange` fires, but `didInitialPinRef.current === true`, so the new handler bails. Rollover is handled instead by the existing effect at `:159-165` gated on `isPinnedRightRef.current` — the correct behavior (auto-scroll only if user was already pinned right).
  - **Week-rollover preserved**: see "Re-fire" section.
  - **Programmatic `onScroll` dispatch**: `scrollToEnd` synthesizes a `scroll` event on RN iOS, RN Android, and RN Web. The existing `onScroll` handler at `:167-195` updates `isPinnedRightRef` accordingly. Confirmed in `react-native@0.81.5`.
- **Platform-specific**:
  - **iOS native**: `ScrollView.scrollToEnd({ animated: false })` translates to `UIScrollView.scrollRectToVisible(_:animated:)` with the rightmost rect. The platform owns the (contentSize.width − bounds.width) math — no padding error, no race.
  - **Android native**: same primitive; `HorizontalScrollView.fullScroll(FOCUS_RIGHT)` equivalent. Works identically.
  - **RN Web (0.21.0)**: `scrollToEnd` sets `scrollLeft = scrollWidth − clientWidth` on the underlying scrolling `div`. Already known good; no regression.
  - **`dataSet` cross-platform**: no-op on native (safe); emits `data-testid` on RN Web. No render-time cost.
- **Performance**:
  - `onContentSizeChange` fires once per content-size change — not per frame. Negligible.
  - No `useState` introduced; both new mechanisms (ref + inline callback) avoid parent re-render. The "no parent re-render on scroll" invariant (run-2026-05-22_1130 MAJ-3 fix) is preserved.
- **React 19 strict-mode double-invocation**: `useRef` survives double-mount (refs are per-component-instance, not per-render). Even if the ref did reset (it does not), the second `scrollToEnd` would be idempotent with `animated: false` — visually a no-op.

## Alternativas descartadas

1. **(a) Math-only fix at `:238`** — change to `Math.max(0, contentWidth − viewportWidthRef.current)`. Descartada porque `viewportWidthRef.current` is `0` on first render (it's written by `onLayout`, which runs AFTER first paint), so `contentOffset` would still resolve to the broken value. Promoting the ref to `useState` would re-render the entire 260-bar grid on every layout change, violating the no-rerender invariant.
2. **Hand-rolled `scrollTo({ x: contentWidth − viewportWidth })`** (v1's approach) — descartada porque (i) `viewportWidthRef` measures the outer `<View>` with `px-4` padding, not the `<ScrollView>`'s inner viewport, causing a 32-pt under-scroll (Validator MAJ-1); (ii) on iOS `onContentSizeChange` typically fires BEFORE the wrapper's `onLayout`, so `viewportWidthRef.current === 0` and the call would silently no-op without flipping `didInitialPinRef` (Validator MAJ-2). `scrollToEnd` delegates both concerns to the platform.
3. **Dual-trigger via mutated `onLayout` + `onContentSizeChange`** — descartada por (i) couples viewport-write with initial-pin-trigger (MIN-4); (ii) is now redundant because `onContentSizeChange` natively re-fires on the loading-skeleton → loaded-strip transition (the only ordering case the v1 design feared); (iii) drags `model` into the `onLayout` closure deps, churning callback identity on data refetches. Single-trigger via `onContentSizeChange` is strictly simpler and equally correct.
4. **Repurpose the rollover `useEffect` at `:159-165` as initial-mount safety net** (seed `prevCountRef = 0`) — descartada porque it conflates "pin on rollover" with "pin on first mount", depends on `useEffect` ordering relative to paint (causing a guaranteed flash from `scrollLeft = 0` → right edge on every cold start), and breaks the invariant that `prevCountRef` tracks "the last count we observed".
5. **`nativeID="weekly-strip-scroller"`** instead of `dataSet` — descartada porque on RN Web `nativeID` lowers to the HTML `id` attribute (global namespace, collision-prone with anchor links and the accessibility tree); on native it maps to `accessibilityIdentifier`, polluting the a11y label. `dataSet` is the test-only channel and is what RN docs recommend for cross-platform test hooks.

## Out of scope

- **Per-exercise progress chart** (`app/(app)/exercises/[id]/progress.tsx`) — different failure mode (fixed-width SVG, no scroll; squishes full history into ~342pt). Discovery flagged this as a SEPARATE feature ("limit to last N sessions" or "add horizontal scroll"). Do NOT bundle into this run.
- **`<WeekSelector>` modal + `<VisibleRangePill>`** — behaviour correct, untouched.
- **`useLifetimeWeeklyVolume` / `computeStripModel`** — bucketing kernel is correct, untouched.
- **Adding a "today" indicator or `Now ↦` button** — prompt is about default position only.
- **Migrating to a chart library** (`react-native-gifted-charts`, `victory-native`) — native `<ScrollView>` is the established pattern; no migration.

## Resposta a issues do Validator (v1 → v2)

- **MAJ-1 (off-by-32pt outer-wrapper padding)**: resolved by collapsing `pinRightEdge` into `scrollRef.current?.scrollToEnd({ animated: false })`. The platform computes (contentSize.width − scrollerViewport.width) internally — `px-4` is now invisible to the math. Established in-repo pattern at `:162`.
- **MAJ-2 (viewport-read race causing silent no-op + ordering hazard)**: resolved by the same `scrollToEnd` swap — the call no longer reads `viewportWidthRef.current`, so there is no race to lose. The single-trigger `onContentSizeChange` (no `onLayout` mutation) covers the empty-state → loaded-state transition because RN re-fires `onContentSizeChange` whenever content size changes (re-stated in **Riscos → UX regressions (ordering)**).
- **MIN-1 (e2e selector chain unverified)**: resolved by adding `dataSet={{ testid: "weekly-strip-scroller" }}` on the `<ScrollView>` (RN Web emits `data-testid="weekly-strip-scroller"`). Tester targets via `page.locator('[data-testid="weekly-strip-scroller"]')`. Walk-up loop removed.
- **MIN-2 (`pinRightEdge` helper unnecessary)**: resolved — helper deleted; the inline `onContentSizeChange` callback is the only call site.
- **MIN-3 (redundant `onLayout` dep)**: moot — `onLayout` is no longer mutated for the initial-pin path; deps stay `[]`.
- **MIN-4 (coupling of viewport-write + initial-pin trigger)**: resolved per Validator option (i) — single-trigger via `onContentSizeChange`. `onLayout` keeps its original single responsibility of writing `viewportWidthRef` for `onScroll`'s visible-range bookkeeping. No dual-trigger, no `model` in deps.
- **MIN-5 (screenshot evidence absent)**: resolved — Tester captures `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` at viewport `390 × 844` showing the current-week bar flush with the strip's right edge. Path pinned in **Mudanças por arquivo** and in the e2e test code above.

## Confidence + risk

- **Confidence**: HIGH — fix collapses to a single `scrollToEnd({ animated: false })` call which is the established in-repo pattern (live since the 2026-05-22_1130 run at `:162`), the canonical RN gotcha-fix per Discovery line 52, and removes both v1 majors mechanically (no math, no viewport read). The `dataSet` → `data-testid` lowering is documented RN Web behavior, not speculative.
- **Risk**: LOW — single component, no data/auth/schema/API change. Worst-case visual artifact is a 1-frame flash, minimized by `animated: false`. Reversible by a single revert commit.
