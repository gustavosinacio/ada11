# Validation v2 — 2026-05-23_2357_progress-graph-current-week

Round: Design↔Validate round 2 of ≤3.
Reviewing: `design-v2.md` vs `validation-v1.md` + repo + RN-Web source.

## Round-1 issue resolution

| v1 Issue | v2 Resolution | Verified? |
|---|---|---|
| MAJ-1 off-by-32pt outer-wrapper padding | `scrollRef.current?.scrollToEnd({animated: false})` — no viewport read | YES. Verified at `react-native-web/dist/exports/ScrollView/index.js:219-231` — reads `scrollWidth` directly off underlying node, no caller math. |
| MAJ-2 viewport-read race / silent no-op | Same `scrollToEnd` swap; ordering re-stated | YES. RN-Web `_handleContentOnLayout:232-237` invokes `onContentSizeChange(w, h)` on first mount AND on size change. Skeleton→loaded triggers fresh mount → fires with `w=730pt`. |
| MIN-1 concrete e2e selector | `dataSet={{testid: "weekly-strip-scroller"}}` → `data-testid` | YES. `createDOMProps/index.js:756-767` + `hyphenateString:23-25` confirm `testid` (no uppercase) stays `testid`, becomes `data-testid` on RN-Web; ignored on native (forwarded via `forwardedProps`, no warning). |
| MIN-2 `pinRightEdge` helper | Removed; inlined at single call site | YES. |
| MIN-3 redundant `onLayout` dep | `onLayout` reverts to original `[]`-deps one-liner | YES. |
| MIN-4 dual-trigger coupling | Option (i): single-trigger via `onContentSizeChange` | YES. No `onLayout` mutation. |
| MIN-5 screenshot evidence | Path pinned: `screenshots/narrow-viewport-pin.png` | YES. |

All 7 round-1 issues resolved.

## Conductor's 10 checks

| # | Item | Verdict |
|---|---|---|
| 1 | `scrollToEnd` swap; no viewport read | YES — platform owns math; established in-repo pattern at `weekly-volume-strip.tsx:162`. |
| 2 | Loading→loaded covered by `onContentSizeChange` re-fire | YES — RN-Web source verified. |
| 3 | `dataSet` → `data-testid` on RN-Web; safe on native | YES. |
| 4 | `pinRightEdge` removed | YES. |
| 5 | `onLayout` deps `[]` | YES. |
| 6 | Single-trigger only | YES. |
| 7 | Screenshot path pinned | YES. |
| 8 | Ordering narrative | YES (v2 line 189). |
| 9 | `didInitialPinRef` reset on screen-away/back | YES — natural component remount creates new ref initialized to `false`. Expo Router unmounts the screen on route change, destroying the strip instance. |
| 10 | Per-exercise progress chart untouched | YES (v2 line 214). |

## New findings

### Blockers
None.

### Majors
None.

### Minors

- **MIN-A — Screenshot directory may not be auto-created.** The new test writes to `docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots/narrow-viewport-pin.png` without a matching `fs.mkdirSync`. Existing test at `tests/e2e/chart-scroll-week-selector.spec.ts:36-39` declares `SCREENSHOT_DIR` for the OLD run folder (`2026-05-22_1130_…`). **Fix at Implementer time**: add `fs.mkdirSync("docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots", { recursive: true })` next to the existing line, OR Implementer flags it as a Tester instruction.

- **MIN-B — Idiomatic `testID` vs `dataSet` choice.** Both produce `data-testid` on RN-Web. `testID` is more idiomatic RN; `dataSet` is more verbose but Designer's rationale (test-only channel) is internally consistent. Not a defect — opinion.

- **MIN-C — Wide-viewport existing test is still weak** (`chart-scroll-week-selector.spec.ts:148-201` only asserts `toBeVisible()`; post-fix on 1280pt viewport, all bars fit, so assertion passes regardless of pin behavior). **Optional improvement** (out-of-scope this round): strengthen with the same `scrollLeft+clientWidth >= scrollWidth - 4` assertion. Tracked as known debt.

## Decision

**go**

Counts: blockers=0, majors=0, minors=3 (all polish).

Confidence: **HIGH** — all claims verified against repo source AND RN-Web source.
Risk: **LOW** — single component edit; no schema/auth/data; one new e2e test; reversible.

## Recommendation

**Invoke Implementer**. Pass MIN-A hand-off (`fs.mkdirSync` for new screenshot dir) to the Implementer.
