# Design v1 — 2026-05-23_2357_progress-graph-current-week

## Goal (1 sentence)

Fix `<WeeklyVolumeStrip>` so it deterministically lands on the rightmost (current) ISO-week bar on first mount, on iOS native + Android native + RN Web, without re-pinning after user scrolls.

## Approach

The bug at `src/components/weekly-volume-strip.tsx:238` (`rightAnchorX = Math.max(0, contentWidth)` instead of `contentWidth - viewportWidth`) cannot be repaired by math alone, because `viewportWidthRef.current` is `0` on the first render — `onLayout` writes to it AFTER first paint, but `contentOffset` is read DURING first render and never re-evaluated. The robust primitive is to drop the broken declarative `contentOffset` and pin the scroll position imperatively from `onContentSizeChange`, which is guaranteed to fire once both content width and layout width are known (RN measures the inner content view before invoking it). To avoid re-pinning when the user has scrolled away and a new bar appears later (week-rollover, set logged this week), we gate the imperative pin on a `didInitialPinRef` boolean — fired exactly once when both `contentWidth > 0` and `viewportWidthRef.current > 0`. The existing week-rollover `useEffect` at `:159-165` keeps its semantics (auto-scroll on bucket-count growth WHEN user was pinned right) — the new initial-pin path runs orthogonal to it. Both History and Progress mount the same component, so the fix lands on both surfaces in a single diff.

**Confidence**: HIGH (root cause verified by Discovery; fix primitive is the canonical RN `onContentSizeChange + scrollTo` pattern called out by Discovery line 52).
**Risk**: LOW (one component, no schema/data/auth change; worst case is a 1-frame flash at mount on slow devices, mitigated by `animated: false`).

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/weekly-volume-strip.tsx` | edited | (1) Remove the broken `contentOffset={{ x: rightAnchorX, y: 0 }}` prop and the `rightAnchorX` computation at `:234-238`. (2) Add `didInitialPinRef = useRef(false)`. (3) Extract a `pinRightEdge()` helper that reads `contentWidth` + `viewportWidthRef.current` and calls `scrollRef.current?.scrollTo({ x: Math.max(0, contentWidth - viewportWidthRef.current), y: 0, animated: false })`. (4) Add `onContentSizeChange={(w) => { if (!didInitialPinRef.current && w > 0 && viewportWidthRef.current > 0) { pinRightEdge(w); didInitialPinRef.current = true; } }}` on the `<ScrollView>`. (5) Augment the existing `onLayout` on the outer `<View>` to also call `pinRightEdge(contentWidth)` once if `!didInitialPinRef.current && contentWidth > 0` — covers the "layout fires AFTER `onContentSizeChange`" order on some platforms. |
| `tests/e2e/chart-scroll-week-selector.spec.ts` | edited | Add a NEW test case `"default mount on narrow viewport: scroll is pinned to right edge"` that calls `page.setViewportSize({ width: 390, height: 844 })` before sign-in, then asserts via `page.evaluate` that the strip's scroll container satisfies `scrollLeft + clientWidth >= scrollWidth - 4` (4-px tolerance for sub-pixel rounding). Keep existing tests untouched. (Tester owns the implementation; Designer specifies the exact assertion below.) |

## Contratos de I/O

- **Component public API**: unchanged. `<WeeklyVolumeStrip bestWeekKg? bestWeekLabel? />` still has the same prop shape (`src/components/weekly-volume-strip.tsx:38-52`).
- **New internal refs / handlers** (all local, no exported types):
  ```ts
  const didInitialPinRef = useRef<boolean>(false);

  const pinRightEdge = useCallback((contentWidth: number) => {
    const vw = viewportWidthRef.current;
    if (vw <= 0 || contentWidth <= 0) return;
    const x = Math.max(0, contentWidth - vw);
    scrollRef.current?.scrollTo({ x, y: 0, animated: false });
  }, []);

  const onContentSizeChange = useCallback((w: number /*, h: number */) => {
    if (didInitialPinRef.current) return;
    if (w <= 0 || viewportWidthRef.current <= 0) return;
    pinRightEdge(w);
    didInitialPinRef.current = true;
  }, [pinRightEdge]);
  ```
  The existing `onLayout` (`:197-199`) keeps writing to `viewportWidthRef`, and ALSO becomes a fallback initial-pin trigger:
  ```ts
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewportWidthRef.current = e.nativeEvent.layout.width;
    if (!didInitialPinRef.current) {
      // contentWidth is in lexical scope from the render body; closure ok since
      // onLayout fires per render of the parent View. If contentWidth is still 0
      // (no buckets yet) the guard inside pinRightEdge bails.
      const cw =
        (model?.buckets.length ?? 0) * BAR_WIDTH +
        Math.max(0, (model?.buckets.length ?? 0) - 1) * BAR_GAP;
      if (cw > 0) {
        pinRightEdge(cw);
        didInitialPinRef.current = true;
      }
    }
  }, [model, pinRightEdge]);
  ```
  Note: `onLayout` deps include `model` now, because the closure reads `model.buckets.length`. This is fine — `model` is memoized on `data` (`:93-96`), so the callback identity changes only when data changes (rare), not per render.
- **ScrollView prop diff**:
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
  +   onContentSizeChange={onContentSizeChange}
  +   onScroll={onScroll}
  +   scrollEventThrottle={16}
  +   className="mt-4"
  + >
  ```
- **DB columns / queries**: NONE. The fix touches only client render + scroll wiring. `useLifetimeWeeklyVolume` and `computeStripModel` untouched.
- **UI props / state**: no external prop change. Two new refs (`didInitialPinRef`) and one new callback (`onContentSizeChange`) internal to the component.

## Re-fire / week-rollover behavior preserved

- `didInitialPinRef` flips `true` on the FIRST initial pin and never resets — subsequent `onContentSizeChange` calls (e.g. when the user logs a set this week and the rightmost bar's height grows, or when a new bucket is appended via week-rollover) do NOT re-pin.
- The existing rollover effect at `:159-165` is untouched:
  ```ts
  useEffect(() => {
    if (bucketsLength > prevCountRef.current && isPinnedRightRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
    prevCountRef.current = bucketsLength;
  }, [bucketsLength]);
  ```
  It still scrolls-to-end ONLY when (a) a new bucket appeared AND (b) `isPinnedRightRef.current === true`. The `isPinnedRightRef` is maintained by `onScroll` (`:176-177`), which now fires correctly because the initial pin is real — meaning the user lands genuinely at the right edge, `isPinnedRightRef` reads `true`, and week-rollover continues to work as designed.
- **What changes**: before this fix, on a narrow viewport, the user landed at `scrollLeft=0` (or whatever iOS clamped to). `onScroll` would compute `isPinnedRightRef = false` because `contentWidth - (0 + viewportWidth) > COLUMN_WIDTH * 1.5`. So week-rollover was ALSO silently broken on narrow viewports (would not auto-scroll a user who'd never manually scrolled to the right edge). The fix restores both initial pin AND week-rollover semantics in one shot.

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

    // The current-week bar must be visible at 390pt — with 16 bars * 46pt =
    // 736pt of content vs ~358pt of inner viewport, the strip MUST be scrolled
    // to the right or the rightmost bar will be offscreen.
    const currentMonday = mondayNWeeksAgoUtc(0);
    const currentLabel = `${currentMonday.getUTCMonth() + 1}/${currentMonday.getUTCDate()}`;
    await expect(
      page.getByRole("button", { name: `View week of ${currentLabel}` }),
    ).toBeVisible({ timeout: 5_000 });

    // Stronger pin: the scroll container's scrollLeft must equal
    // scrollWidth - clientWidth (within sub-pixel tolerance). This is the
    // deterministic regression-killer assertion.
    const pinned = await page.evaluate(() => {
      // The horizontal ScrollView renders as a div with overflow-x: scroll on
      // RN Web. Find it by walking up from a known bar button.
      const bar = document.querySelector('[aria-label^="View week of"]');
      if (!bar) return { ok: false, reason: "no bar" } as const;
      let el: HTMLElement | null = bar.parentElement;
      while (el && !(el.scrollWidth > el.clientWidth)) el = el.parentElement;
      if (!el) return { ok: false, reason: "no scroller" } as const;
      const slack = el.scrollWidth - el.clientWidth - el.scrollLeft;
      return {
        ok: slack <= 4,
        slack,
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      } as const;
    });
    expect(pinned.ok, `scroll not pinned to right edge: ${JSON.stringify(pinned)}`).toBe(true);
  } finally {
    await deleteUserSafe(userId);
  }
});
```

The 4-px tolerance accounts for RN Web sub-pixel rounding. The `walk-up-to-find-scrolling-ancestor` pattern avoids brittle selectors against RN Web's generated class names.

## Riscos

- **Data integrity (RLS, migrations)**: NONE. Zero schema or query change.
- **UX regressions**:
  - **Initial-mount flash**: on a slow device, the user could see one frame at `scrollLeft=0` before `onContentSizeChange` fires. Mitigation: `animated: false` makes the jump instant; in practice React batches the first commit + measure + scroll into the same paint on iOS native. RN Web behaved correctly before (via clamp on `scrollLeft = contentWidth`); after the fix it still receives the correct target via the imperative call, no regression.
  - **Week-rollover preserved**: see "Re-fire" section above — explicit gate on `bucketsLength > prevCountRef.current && isPinnedRightRef.current` is untouched.
  - **Imperative-pin re-fire on data change**: if the user is mid-scroll and `useLifetimeWeeklyVolume` refetches and adds a bucket, `onContentSizeChange` fires again. `didInitialPinRef.current === true` guards against re-pin. Confirmed safe.
- **Platform-specific**:
  - **iOS native**: `ScrollView.scrollTo({ x, animated: false })` translates to `UIScrollView.setContentOffset(_:animated:)` which IS the canonical fix per RN docs and Discovery line 52.
  - **Android native**: same `scrollTo` primitive; works identically.
  - **RN Web (0.21.0)**: `scrollTo` sets `scrollLeft` on the underlying `div`. Already known good.
  - **`onContentSizeChange` vs `onLayout` ordering**: not guaranteed by RN. On iOS, content size is typically known before layout; on Android, layout often comes first. The dual-trigger design (both callbacks try to pin if `!didInitialPinRef.current`) covers both orderings deterministically.
- **Performance**:
  - `onContentSizeChange` fires once per content-size change — not per frame. Negligible.
  - `onLayout`'s deps now include `model`; the callback is recreated when data refetches. `<View>` re-receives a new `onLayout` reference, but RN does not refire `onLayout` on prop-identity change — only on actual layout change. Safe.
  - The strip's "no parent re-render on scroll" invariant (run-2026-05-22_1130 MAJ-3) is preserved: no `useState` is introduced; both new mechanisms write to refs only.
- **React 19 strict-mode double-invocation**: `useEffect` and `useRef` initializers run twice in dev. `didInitialPinRef.current` is a mutable ref, not state — it does not reset between strict-mode mount cycles within the same component instance, so the second strict-mode mount sees `true` and bails. If it DID reset (impossible, but worth noting), the only consequence would be a second `scrollTo` to the same offset — a no-op visually.

## Alternativas descartadas

1. **(a) Math-only fix at `:238`** (change to `Math.max(0, contentWidth - viewportWidthRef.current)`) — descartada porque `viewportWidthRef.current` is `0` on first render (it's written by `onLayout`, which runs AFTER first paint). The `contentOffset` prop is read during first render, so the read returns `Math.max(0, contentWidth - 0) = contentWidth`, which is the EXACT broken value we have today. Promoting the ref to `useState` would re-render the entire 260-bar grid on every layout change, violating the no-rerender invariant.
2. **(c) Dual callback with `<ScrollView onLayout>` capturing viewport + `onContentSizeChange` capturing content** — Discovery's first-choice recommendation. Descartada por (de facto adotada parcialmente) porque the existing outer `<View onLayout={onLayout}>` already captures viewport width into `viewportWidthRef`, so adding a SECOND `onLayout` on the `<ScrollView>` is redundant. The chosen design uses `onContentSizeChange` as the primary trigger and the existing outer `onLayout` as the fallback (mutating it to also call `pinRightEdge`). This is functionally option (c) without the duplicate handler.
3. **Repurpose the rollover `useEffect` as an initial-mount safety net** (seed `prevCountRef = 0`) — descartada porque it conflates two semantics in one effect ("pin on rollover" vs "pin on first mount"), depends on `useEffect` ordering relative to paint (causing a guaranteed flash from `scrollLeft=0` → right edge on every cold start), and breaks the existing invariant that `prevCountRef` tracks "the last count we observed". One-line change, but worse semantics than `onContentSizeChange`.

## Out of scope

- **Per-exercise progress chart** (`app/(app)/exercises/[id]/progress.tsx`) — different failure mode (fixed-width SVG, no scroll; squishes full history into ~342pt). Discovery flagged this as a SEPARATE feature ("limit to last N sessions" or "add horizontal scroll"). Do NOT bundle into this run.
- **`<WeekSelector>` modal + `<VisibleRangePill>`** — behaviour correct, untouched.
- **`useLifetimeWeeklyVolume` / `computeStripModel`** — bucketing kernel is correct, untouched.
- **Adding a "today" indicator or `Now ↦` button** — prompt is about default position only.
- **Migrating to a chart library** (`react-native-gifted-charts`, `victory-native`) — native `<ScrollView>` is the established pattern; no migration.

## Confidence + risk

- **Confidence**: HIGH — fix primitive is the canonical RN gotcha (declarative `contentOffset` before layout) named in RN docs and confirmed by Discovery's reading. Both the bug location (`:238`) and the test gap (wide-viewport e2e at `:148-201` masked the regression) are verified by Discovery against source.
- **Risk**: LOW — single component, no data/auth/schema/API change. Worst-case visual artifact is a 1-frame flash, which `animated: false` minimizes. Reversible by a single revert commit.
