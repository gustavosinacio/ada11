# Implementation — 2026-05-23_2357_progress-graph-current-week

Based on: `design-v2.md` (final approved) and `validation-v2.md` (matching `go`, MIN-A passed forward to Implementer).

Round: Implement↔Review **round 1 of 2**.

## Files changed

- `src/components/weekly-volume-strip.tsx` (edited) — replaced the broken declarative `contentOffset={{x: rightAnchorX,y:0}}` initial-scroll anchor with an imperative `scrollToEnd({animated:false})` invoked from `onContentSizeChange`, gated by a one-shot `didInitialPinRef`. Added `testID="weekly-strip-scroller"` for the e2e selector hook. Deleted the `rightAnchorX` computation + comment block (`:230-238` pre-edit).
- `tests/e2e/chart-scroll-week-selector.spec.ts` (edited) — added a new test `"default mount on narrow viewport: scroll is pinned to right edge"` inside the existing `describe` block. Seeds 16 weeks at 390×844 viewport, asserts `scrollLeft + clientWidth >= scrollWidth - 4` on the data-testid-selected scroller, captures `narrow-viewport-pin.png`. Also added `NARROW_VIEWPORT_SCREENSHOT_DIR` + `fs.mkdirSync(..., {recursive:true})` at module scope (MIN-A hand-off).
- `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` (new, captured by the new e2e test on first run) — visual evidence: 16-week strip pinned to the right edge at 390pt viewport, current-week bar (5/18, blue) flush with right edge.

### Key diff — `src/components/weekly-volume-strip.tsx`

**1. New ref next to existing refs** (after `isPinnedRightRef`, before `model` memo):

```ts
// One-shot guard for the initial right-edge pin. Flips `true` on the FIRST
// `onContentSizeChange` with `w > 0` (i.e. when the loaded `<ScrollView>`
// first measures its content) and never resets. Subsequent content-size
// changes (refetch, week rollover, in-week volume growth) are handled by
// the rollover effect at `:160-165` gated on `isPinnedRightRef`.
const didInitialPinRef = useRef<boolean>(false);
```

**2. Removed** the entire 5-line `rightAnchorX` block (pre-edit `:234-238`):
- The 4-line comment claiming `contentOffset` was the "canonical no-flash way".
- `const rightAnchorX = Math.max(0, contentWidth);` — which was wrong (missing viewport subtraction).

**3. `<ScrollView>` prop diff**:

```diff
  <ScrollView
    ref={scrollRef}
    horizontal
    showsHorizontalScrollIndicator={false}
-   contentOffset={{ x: rightAnchorX, y: 0 }}
+   testID="weekly-strip-scroller"
+   onContentSizeChange={(w) => {
+     if (didInitialPinRef.current) return;
+     if (w <= 0) return;
+     scrollRef.current?.scrollToEnd({ animated: false });
+     didInitialPinRef.current = true;
+   }}
    onScroll={onScroll}
    scrollEventThrottle={16}
    className="mt-4"
  >
```

`onLayout` callback on the wrapper `<View>` is untouched (per design — still a one-line `viewportWidthRef.current = e.nativeEvent.layout.width` write for `onScroll`'s benefit).

The rollover effect at `:159-165` is untouched (per design — still gated on `bucketsLength > prevCountRef.current && isPinnedRightRef.current`).

## Deviations from design

- **`dataSet={{ testid: "weekly-strip-scroller" }}` → `testID="weekly-strip-scroller"`.**
  - **Why deviation needed**: TypeScript's RN type definitions (`ScrollViewProps` extends `ViewProps`) do not declare `dataSet`. Applying the design's literal prop produced `TS2769 Property 'dataSet' does not exist on type ... ScrollViewProps`. The runtime accepts `dataSet` on RN-Web (it's in the `createDOMProps` `_excluded` list and is mapped to `data-*` attributes), but the typings gap would have required either an `@ts-ignore` (banned by Implementer rules) or a `as unknown as ScrollViewProps` cast (creates a type-safety hole).
  - **Why `testID` is the correct alternative**:
    - **TypeScript-supported** with zero casts (`testID?: string` is declared on `ViewProps` in `react-native/Libraries/Components/View/ViewPropTypes.d.ts:217`).
    - **Same RN-Web output**: verified at `node_modules/react-native-web/dist/modules/createDOMProps/index.js:147,831-832`:
      ```js
      testID = _props.testID;
      ...
      if (testID != null) { domProps['data-testid'] = testID; }
      ```
      `testID="weekly-strip-scroller"` → `data-testid="weekly-strip-scroller"` on the underlying DOM `<div>`. Identical to what `dataSet={{testid}}` produces, so the e2e selector `[data-testid="weekly-strip-scroller"]` is unchanged.
    - **The Designer's rejection of `nativeID` doesn't apply to `testID`**. The Designer's alternative-discarded note (v2:210) rejected `nativeID` because on RN-Web it lowers to the HTML `id` attribute (global namespace, collision risk) and on native it maps to `accessibilityIdentifier` (which the Designer worried would "pollute the a11y label"). The crucial distinction the Designer missed: on iOS/Android, `accessibilityIdentifier` is **not** read by screen readers — screen readers read `accessibilityLabel`. `testID` is RN's purpose-built test-only channel (its name is literally "test ID"); it is the idiomatic prop for this exact use case. Validator MIN-B explicitly flagged this option as "more idiomatic RN" while noting both produce `data-testid` on RN-Web.
  - **Confidence: HIGH** that `testID` is the safer, idiomatic choice. **Risk: LOW** — RN-Web source verified; e2e selector unchanged; native side gets `accessibilityIdentifier` which is invisible to users and to screen readers.

## Soft callbacks made (during this implementation pass)

None. No ambiguity required a callback; the only design-vs-typings conflict (`dataSet`) was resolved within Implementer scope by selecting the typed-RN-prop equivalent that produces the same RN-Web output (`testID`), recorded as a justified deviation above.

## Quality gates

- [x] `npm run typecheck` passed — `> tsc --noEmit` exits clean, no diagnostics.
- [x] `npm run lint` passed — `ESLint: 0 errors, 1 warnings in 1 files` (only pre-existing warning in `router.d.ts`, untouched by this run).
- [x] Relevant unit tests pass — `npm run test:unit` → 18 test files, 307 tests, all green.
- [x] No new `any` — grep `: any\b\| as any\b` on `weekly-volume-strip.tsx` returns 0 matches.
- [x] No new `// @ts-ignore` — grep returns 0 matches.
- [x] No stray `console.log` in `weekly-volume-strip.tsx`. (The new e2e test re-uses the existing `console.log("[screenshot] ${file}")` pattern from the other 2 tests in the same spec file — intentional in tests, not banned by the rules.)

### Bonus e2e verification (with Expo web running at localhost:8081)

I started `npm run web`, waited for the server to listen, then ran the full spec file:

```
stats: { "expected": 4, "skipped": 0, "unexpected": 0, "flaky": 0, "duration": 56910 ms }
  passed  default mount: pinned to right edge, current-week visible, pill rendered
  passed  week-selector flow: tap pill → modal opens → confirm scrolls strip
  passed  modal backdrop dismiss: tap outside the card closes it
  passed  default mount on narrow viewport: scroll is pinned to right edge   ← NEW
```

All 4 tests pass. The new narrow-viewport test ran the deterministic `scrollLeft + clientWidth >= scrollWidth - 4` assertion AND captured the screenshot at the pinned path. The 3 pre-existing tests still pass — no regression from the `contentOffset → onContentSizeChange/scrollToEnd` swap or from the `testID` addition.

## Notes for Reviewer / Tester

- **Tester**: the e2e test for this run already ran clean on RN-Web at 390×844. For the iOS-native acceptance, manual smoke is still needed (the original bug was iPhone-only and the fix's claim of "iOS `scrollToEnd` lands deterministically" rests on RN documentation + the established in-repo pattern at `:162`, not on a CI test). Suggested check: open History on physical iPhone with ≥ 8 weeks of history, confirm the strip lands with the current week visible at the right edge on first mount and on cold reopen.
- **Reviewer**: the prop ordering on `<ScrollView>` matters at runtime. `onContentSizeChange` and `onScroll` are both declared on the same element; verify the firing order isn't a concern. RN-Web source (`createDOMProps`, `_handleContentOnLayout`) confirms `onContentSizeChange` runs from a ResizeObserver after layout — and `onScroll` is dispatched programmatically by the imperative `scrollToEnd` call, so the order is: layout → `onContentSizeChange` → `scrollToEnd` → programmatic `onScroll` → `isPinnedRightRef = true`. All under one paint on RN-Web, behind one render-commit on RN native.
- **Screenshot path** (for the Tester's report): `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` — already captured during the bonus e2e run; the new test will re-capture it on every Tester invocation since `screenshot({path:…})` overwrites.
- **MIN-B (Validator polish note)**: by switching to `testID` per the deviation above, MIN-B is incidentally resolved (Validator said `testID` was "more idiomatic RN"). No follow-up needed.
- **MIN-C (out-of-scope debt)**: the pre-existing "default mount" wide-viewport test at lines 154-207 still only asserts `toBeVisible()` on the current-week bar (weak — passes on any scroll position when content fits viewport). Strengthening this test was explicitly marked out-of-scope for this round by the Validator. Tracked as known debt.
- **Cross-surface fix**: both `app/(app)/history/index.tsx` (History tab) and `app/(app)/progress/index.tsx` (Progress tab) mount the same `<WeeklyVolumeStrip>` component, so the fix lands on both surfaces in this single-component edit. The original prompt only mentioned "history page", but the Progress tab inherits the same fix automatically — flag this in the final-summary if user-visible.
