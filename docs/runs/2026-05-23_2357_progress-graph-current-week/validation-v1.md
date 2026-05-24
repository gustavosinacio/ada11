# Validation v1 — 2026-05-23_2357_progress-graph-current-week

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verification (10 Conductor checks)

| # | Item | Verdict |
|---|---|---|
| 1 | `onContentSizeChange` timing on RN-Web/iOS/Android | OK with dual-trigger; coupling risk see MAJ-2. |
| 2 | `scrollToEnd` vs `scrollTo({x})` | Design chose manual `scrollTo({x})`. `scrollToEnd` would be simpler AND correct. See MAJ-1. |
| 3 | `didInitialPinRef` one-shot semantic | SAFE against "user scrolled back, refetch arrives". Refetch with same shape (16 buckets) doesn't fire `onContentSizeChange`; rollover (17th bucket) goes through existing `:159-165` effect gated on `isPinnedRightRef.current`. |
| 4 | Existing `useEffect` at `:159-165` interaction | NON-CONFLICTING. `pinRightEdge` doesn't touch `isPinnedRightRef.current`; programmatic `scrollTo` dispatches `onScroll`; existing handler at `:176-177` computes `isPinnedRightRef.current = true` from new `contentOffset`. Verified RN-Web + iOS dispatch programmatic scroll events. |
| 5 | `contentOffset` declarative prop removal | VERIFIED. Keeping it would re-introduce broken math. Imperative path supersedes. |
| 6 | Narrow-viewport e2e | Partial; selector chain unverified — see MIN-1. |
| 7 | No regression on existing wide-viewport test (line 188-193) | VERIFIED. At 1280pt, 16 buckets = 730pt, all bars fit; `pinRightEdge` computes `x=0`; no scroll. `toBeVisible()` passes. |
| 8 | `isPinnedRightRef` flips to true on narrow viewports (side benefit) | VERIFIED. Pre-fix, narrow viewport landed `scrollLeft=0` → `isPinnedRightRef=false`, breaking rollover. Post-fix, imperative pin → dispatch scroll → handler sets `true`. |
| 9 | React 19 strict-mode | SAFE. `useRef` survives double-mount; even if not, second `scrollTo` is idempotent with `animated: false`. |
| 10 | Out-of-scope discipline (per-exercise chart untouched) | VERIFIED. Design line 197 explicitly excludes `app/(app)/exercises/[id]/progress.tsx`. |

## Findings

### Blockers
None.

### Majors

- **MAJ-1 — `viewportWidthRef.current` measures the OUTER wrapper, not the ScrollView's inner viewport (off by `px-4 × 2 = 32pt`).** `onLayout` is attached to the outermost `<View>` at `weekly-volume-strip.tsx:241-244` which has `className="… px-4 py-5 …"`. `e.nativeEvent.layout.width` returns the padded outer width (e.g. 390pt on iPhone 12). The `<ScrollView>` is INSIDE that padding box, so its actual viewport is `outerWidth − 32pt = 358pt`. The design's `pinRightEdge` computes `x = contentWidth − 390 = 340pt`. Correct target is `x = contentWidth − 358 = 372pt`. **Fix under-scrolls by 32pt** — rightmost bar appears inset from the right edge instead of flush. Same shape of complaint as the original bug, smaller magnitude. **Fix**: use `scrollRef.current?.scrollToEnd({ animated: false })` inside `pinRightEdge` — delegates math to the platform, always correct. `scrollToEnd` is already used by the rollover effect at line 162 (established in-repo pattern).

- **MAJ-2 — `onContentSizeChange` vs `onLayout` race; `pinRightEdge` may fire with `viewportWidthRef.current === 0` and silently no-op.** On iOS, `onContentSizeChange` typically fires before the wrapper's `onLayout`. The guard `if (vw <= 0 || cw <= 0) return;` bails without setting `didInitialPinRef.current = true`, depending on the mutated `onLayout` recovery path. Recovery works only if the closure captures fresh `model`. Empty-state → loaded transition relies on `onContentSizeChange` re-firing when content width changes — RN spec says it does, but design doesn't articulate this; a future "first-only" gate would silently break the empty→loaded path. **Fix**: same as MAJ-1 — `scrollToEnd({ animated: false })` removes the viewport-width dependency entirely, making the race vanish.

### Minors

- **MIN-1 — e2e selector chain unverified against actual DOM.** The walk-up loop `while (el && !(el.scrollWidth > el.clientWidth)) el = el.parentElement;` should reach the scroller in ≤3 hops, but no fallback if RN-Web emits unexpected intermediate divs. **Suggest**: add `data-testid="weekly-strip-scroller"` on the `<ScrollView>` for direct targeting, OR use the bar's `getBoundingClientRect` + scroller's rect (more robust).

- **MIN-2 — `pinRightEdge` extraction unnecessary with `scrollToEnd`.** Becomes a 1-liner; inline at the two call sites.

- **MIN-3 — `onLayout` deps `[model, pinRightEdge]` — `pinRightEdge` has `[]` deps and is stable across renders. Redundant.** Drop it from deps; keep `[model]`.

- **MIN-4 — Mutating existing `onLayout` couples two concerns** (viewport-write + initial-pin-trigger). Cleaner: keep `onLayout` as the one-liner that writes viewport, add a separate `useEffect([bucketsLength])` that triggers `pinRightEdge` once both are non-zero. (Becomes moot if MAJ-1 fix is adopted; `scrollToEnd` doesn't need viewport.)

- **MIN-5 — Screenshot evidence absent.** Tester should capture a narrow-viewport screenshot at the new test to make the right-pin visually verifiable.

## Decision

**no-go** (≥2 majors → no-go).

Counts: blockers=0, majors=2, minors=5.

## Recommendation

**Invoke Designer for v2** specifically addressing:

1. **Collapse `pinRightEdge` to `scrollRef.current?.scrollToEnd({ animated: false })`** — resolves BOTH MAJ-1 (off-by-32pt) and MAJ-2 (viewport-read race) in one move. Established in-repo pattern at line 162.
2. **Tighten ordering narrative**: state explicitly that `onContentSizeChange` re-fires on content-width change, covering empty→loaded transition. If `scrollToEnd` is adopted, the mutated `onLayout` fallback may be removable entirely (no closure-over-model needed).
3. **Specify the e2e selector** concretely (data-testid recommended) or document the fallback walk-up loop's behavior against the actual rendered RN-Web DOM.

Confidence: HIGH on MAJ-1 (verified outer-wrapper padding at file:line). MEDIUM on MAJ-2 (race depends on platform; design dual-trigger covers it technically but doesn't articulate). LOW risk of long iteration loop in v2 — both fixes are 1-line `scrollToEnd` swap.

Round 1 of ≤3. After v2 addresses these, expect a fast re-validate.
