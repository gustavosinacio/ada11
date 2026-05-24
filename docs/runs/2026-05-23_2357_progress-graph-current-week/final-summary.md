# Final summary — 2026-05-23_2357_progress-graph-current-week

## Outcome
- **Feature**: Weekly volume strip now reliably opens at the most recent week on mount across all viewport widths. The strip is mounted on both History and Progress tabs; one shared-component fix corrects both.
- **Pipeline result**: **shipped**
- **Branch / baseline**: `main` / `689256de60a38bb53a964db8b7dfae74d3d83bb5`
- **Files**: 1 source edit + 1 test edit (2 total).

## Root cause and fix

This was a **regression** introduced by the `2026-05-22_1130_chart-scroll-week-selector` run, masked from CI because Playwright's default ~1280pt viewport fits all 16 seeded bars without horizontal scrolling — so the "default position pinned to right edge" assertion was never genuinely tested. On real device widths (390pt iPhone 12, 320pt iPhone SE) the strip opened scrolled to the OLDEST week, opposite the design intent.

The buggy line (`weekly-volume-strip.tsx:238`):
```ts
const rightAnchorX = Math.max(0, contentWidth);  // missing - viewportWidth
```
Fed declaratively to `contentOffset={...}` on the `<ScrollView>`, this `x` value was never the correct right-edge offset. Adding `- viewportWidth` would have been wrong too because the outer wrapper's `onLayout` measures the padded outer width (with `px-4 × 2 = 32pt` overhead), not the ScrollView's inner viewport — caught by Validator MAJ-1 before any code was written.

The fix: delete the declarative path entirely and use `scrollRef.current?.scrollToEnd({ animated: false })` from inside an `onContentSizeChange` callback, gated by a one-shot `didInitialPinRef`. `scrollToEnd` delegates the math to the underlying platform's `scrollWidth - clientWidth` computation, sidestepping both the viewport-read race and the outer-wrapper padding bug. This is the same primitive the existing week-rollover effect uses at line 167; the new code reuses an established in-repo pattern.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (4/4 chart-scroll e2e + 17 adjacent regression all green; pin verified at 390pt and 320pt) |
| Human interventions during run | 0 |
| Total round-trips | 4 (2 D↔V + 1 I↔R + 1 I↔T) |
| Design ↔ Validate rounds | 2 (round 2 → go) |
| Implement ↔ Review rounds | 1 (pass first try) |
| Implement ↔ Test rounds | 1 (pass first try) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~45 min (23:57 → 00:42 BRT) |
| Token cost | n/a |

## Validator catches

### Round 1 (no-go)
- **MAJ-1**: design v1 proposed `x = contentWidth - viewportWidthRef.current` but `onLayout` was attached to the OUTER wrapper with `px-4` padding → over-reports viewport by 32pt → fix would under-scroll by 32pt, leaving the current-week bar inset from the right edge instead of flush. **Same shape of complaint as the original bug, just smaller magnitude.**
- **MAJ-2**: on iOS, `onContentSizeChange` typically fires before the wrapper's `onLayout`, so `viewportWidthRef.current === 0` at first call; the guard would bail without setting `didInitialPinRef`, relying on a recovery path that depended on `model` being captured by the closure.
- Both fixes **collapse to one line**: `scrollRef.current?.scrollToEnd({ animated: false })`. No viewport read, no race, established in-repo pattern.
- Plus 5 minors: helper inlining, redundant dep, coupling, screenshot path, e2e selector.

### Round 2 (go)
- **MIN-A**: new screenshot directory needs `fs.mkdirSync(..., { recursive: true })` before `page.screenshot()` writes to it. Fixed at Implement time.
- **MIN-B**: `testID` is more idiomatic than `dataSet`. Implementer adopted this as a deviation — strictly superior (typed prop, identical `data-testid` on web, maps to `accessibilityIdentifier` on native which screen readers ignore).
- **MIN-C**: wide-viewport existing test (`chart-scroll-week-selector.spec.ts:148-201`) only asserts `toBeVisible()` — still weak post-fix because at 1280pt all bars fit and assertion passes regardless of pin behavior. Tracked as known debt; out of scope this round.

## Files touched

### Edited (source)
- `src/components/weekly-volume-strip.tsx` — deleted `rightAnchorX` const and the declarative `contentOffset` prop; added `didInitialPinRef = useRef(false)`; added `onContentSizeChange` handler that calls `scrollRef.current?.scrollToEnd({animated: false})` once and flips the ref; added `testID="weekly-strip-scroller"` on the `<ScrollView>`. +20/-7 lines net.

### Edited (tests)
- `tests/e2e/chart-scroll-week-selector.spec.ts` — added a 4th test case `default position: narrow viewport (390pt iPhone 12) opens pinned to right edge`, with `page.setViewportSize({width: 390, height: 844})` BEFORE sign-in, deterministic `page.evaluate` asserting `scrollLeft + clientWidth >= scrollWidth - 4`, screenshot capture, and an `fs.mkdirSync` for the new screenshots directory. +86 lines.

### New (artifacts)
- `docs/runs/2026-05-23_2357_progress-graph-current-week/` — full run folder.
- `screenshots/narrow-viewport-pin.png` (390pt History — captured by the canonical e2e).
- `screenshots/progress-narrow-pin.png` (390pt Progress — bonus).
- `screenshots/iphone-se-pin.png` (320pt History — bonus).
- `screenshots/wide-viewport-1280.png` (1280pt History — bonus).

**Diff size**: +99/-7 on source + test files combined; ~99 lines of new artifact docs.

## Quality gates at end of run
- Typecheck: clean (Reviewer + Tester both re-ran).
- Lint: 0 errors, 1 pre-existing warning in `router.d.ts` (unrelated).
- Unit tests: 307/307 pass.
- E2E canonical (`chart-scroll-week-selector.spec.ts`): 4/4 pass including the new narrow-viewport case.
- E2E adjacent regression (17 tests across `weekly-volume-strip.spec.ts` + `progress-page.spec.ts` + `week-drill-down.spec.ts`): all green.
- Visual evidence: 4 screenshots pinned (390pt History, 390pt Progress, 320pt iPhone SE, 1280pt wide).

## Cross-screen behavior verified by Tester
- **History 390pt**: `scrollLeft=372, scrollWidth=730, clientWidth=358, slack=0`.
- **Progress 390pt**: same numbers (shared component).
- **History 320pt iPhone SE**: `scrollLeft=442, scrollWidth=730, clientWidth=288, slack=0`.
- **History 1280pt wide**: `scrollWidth=clientWidth=1248`, no overflow; current-week bar inside scroller bbox.
- **Scroll-left preservation across refetch**: manual scroll to 172, window-focus-triggered react-query refetch, post-refetch `scrollLeft=172`. No yank — `didInitialPinRef` correctly gates re-fire.

## Native caveat
Tester ran on RN-Web only (no simulator/device in the headless environment). The fix uses the same `scrollToEnd({ animated: false })` primitive as the existing rollover effect at line 167 (live in production since the 2026-05-22_1130 run), so cross-platform behavior is supported by an established in-repo pattern. **MEDIUM confidence on iOS/Android native**. Recommend Owner smoke on physical iPhone before merge — though this is the same risk profile as the original chart-scroll-week-selector run.

## Why we stopped
Not escalated — pipeline completed cleanly. Budgets at end: D↔V 1/3, I↔R 1/2, I↔T 1/2, soft-callbacks 2/2.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md) → superseded
- [`validation-v1.md`](./validation-v1.md) → no-go (0 / 2 / 5)
- [`design-v2.md`](./design-v2.md) ← shipped
- [`validation-v2.md`](./validation-v2.md) → go (0 / 0 / 3 polish minors)
- [`implementation.md`](./implementation.md)
- (review-v1 — returned inline by Reviewer; verdict logged to transcript)
- [`test-report-v1.md`](./test-report-v1.md) → pass
- [`transcript.md`](./transcript.md)
- `screenshots/` — 4 visual evidence files

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-23_2357_progress-graph-current-week/` on 2026-05-24.
